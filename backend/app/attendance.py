"""Attendance marking, history queries, statistics and CSV export."""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from .db import WebStore
from .errors import ApiError
from .timeutil import Clock

log = logging.getLogger(__name__)

_SELECT = """
SELECT a.id, a.person_id, a.date, a.time, a.status, a.method, a.similarity, a.marked_by, a.created_at,
       p.full_name, p.department, p.class_name,
       COALESCE(json_extract(p.metadata_json, '$.type'), 'student') AS person_type
FROM attendance a JOIN persons p ON p.person_id = a.person_id
"""


def record_out(r) -> dict[str, Any]:
    return {
        "id": r["id"], "person_id": r["person_id"], "full_name": r["full_name"],
        "person_type": r["person_type"], "department": r["department"], "class_name": r["class_name"],
        "date": r["date"], "time": r["time"], "status": r["status"], "method": r["method"],
        "similarity": None if r["similarity"] is None else round(r["similarity"], 3),
        "marked_by": r["marked_by"],
    }


def _parse_date(value: str | None, field: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ApiError(422, f"{field} must be a date (YYYY-MM-DD)", "invalid_input") from exc


class AttendanceService:
    def __init__(self, store: WebStore, clock: Clock, late_after: time | None):
        self.store = store
        self.clock = clock
        self.late_after = late_after

    # ---------- marking ----------
    def _status_for(self, t: time) -> str:
        return "late" if self.late_after and t > self.late_after else "present"

    def mark(self, person_id: str, method: str, similarity: float | None = None,
             marked_by: str | None = None, on: date | None = None, at: time | None = None,
             status: str | None = None) -> tuple[dict[str, Any], bool]:
        """Insert today's (or the given day's) record. Returns (record, created).

        The UNIQUE(person_id, date) constraint makes this race-free: two cameras confirming
        the same person at the same moment still produce exactly one row.
        """
        now = self.clock.now()
        day = on or now.date()
        t = at or now.time().replace(microsecond=0)
        st = status or self._status_for(t)
        cur = self.store.execute(
            "INSERT INTO attendance(person_id, date, time, status, method, similarity, marked_by, created_at) "
            "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(person_id, date) DO NOTHING",
            (person_id, day.isoformat(), t.isoformat(), st, method, similarity, marked_by,
             datetime.now(timezone.utc).isoformat(timespec="seconds")))
        created = cur.rowcount == 1
        row = self.store.query_one(_SELECT + " WHERE a.person_id=? AND a.date=?", (person_id, day.isoformat()))
        if created:
            log.info("Attendance %s: %s on %s at %s (%s)", st, person_id, day, t, method)
        return record_out(row), created

    def delete(self, record_id: int) -> None:
        row = self.store.query_one("SELECT person_id, date FROM attendance WHERE id=?", (record_id,))
        if row is None:
            raise ApiError(404, "Attendance record not found", "not_found")
        self.store.execute("DELETE FROM attendance WHERE id=?", (record_id,))
        self.store.repo.audit("attendance_deleted", row["person_id"], row["date"])

    # ---------- queries ----------
    def _filters(self, date_from: str | None, date_to: str | None, search: str | None,
                 person_type: str | None, status: str | None, method: str | None) -> tuple[str, list]:
        where, params = [], []
        df, dt = _parse_date(date_from, "date_from"), _parse_date(date_to, "date_to")
        if df and dt and df > dt:
            raise ApiError(422, "Start date must be on or before end date", "invalid_input")
        if df:
            where.append("a.date >= ?"); params.append(df.isoformat())
        if dt:
            where.append("a.date <= ?"); params.append(dt.isoformat())
        if search and search.strip():
            like = f"%{search.strip()}%"
            where.append("(a.person_id LIKE ? OR p.full_name LIKE ? OR p.department LIKE ? OR p.class_name LIKE ?)")
            params += [like] * 4
        if person_type in ("student", "employee"):
            where.append("COALESCE(json_extract(p.metadata_json, '$.type'), 'student') = ?")
            params.append(person_type)
        if status in ("present", "late"):
            where.append("a.status = ?"); params.append(status)
        if method in ("face", "manual"):
            where.append("a.method = ?"); params.append(method)
        return (" WHERE " + " AND ".join(where)) if where else "", params

    def list(self, page: int = 1, page_size: int = 25, **filters) -> dict[str, Any]:
        clause, params = self._filters(**filters)
        total = self.store.scalar(
            "SELECT COUNT(*) FROM attendance a JOIN persons p ON p.person_id=a.person_id" + clause, params)
        page_size = max(1, min(page_size, 200))
        page = max(1, page)
        rows = self.store.query(_SELECT + clause + " ORDER BY a.date DESC, a.time DESC LIMIT ? OFFSET ?",
                                params + [page_size, (page - 1) * page_size])
        return {"items": [record_out(r) for r in rows], "total": int(total or 0),
                "page": page, "page_size": page_size}

    def export_csv(self, **filters) -> str:
        clause, params = self._filters(**filters)
        rows = self.store.query(_SELECT + clause + " ORDER BY a.date DESC, a.time DESC", params)
        buf = io.StringIO()
        buf.write("\ufeff")  # BOM so Excel opens UTF-8 names correctly
        w = csv.writer(buf)
        w.writerow(["Date", "Time", "Person ID", "Full name", "Type", "Department", "Class",
                    "Status", "Method", "Match score", "Marked by"])
        for r in rows:
            rec = record_out(r)
            w.writerow([_safe(v) for v in (
                rec["date"], rec["time"], rec["person_id"], rec["full_name"], rec["person_type"],
                rec["department"] or "", rec["class_name"] or "", rec["status"], rec["method"],
                "" if rec["similarity"] is None else rec["similarity"], rec["marked_by"] or "")])
        return buf.getvalue()

    def absentees(self, day: date) -> list[dict[str, Any]]:
        rows = self.store.query(
            "SELECT p.person_id, p.full_name, p.department, p.class_name, "
            "COALESCE(json_extract(p.metadata_json, '$.type'), 'student') AS person_type "
            "FROM persons p WHERE substr(p.registered_at, 1, 10) <= ? AND NOT EXISTS "
            "(SELECT 1 FROM attendance a WHERE a.person_id = p.person_id AND a.date = ?) "
            "ORDER BY p.full_name", (day.isoformat(), day.isoformat()))
        return [dict(r) for r in rows]

    def statuses_on(self, day: date) -> dict[str, dict[str, str]]:
        rows = self.store.query("SELECT person_id, status, time FROM attendance WHERE date=?", (day.isoformat(),))
        return {r["person_id"]: {"status": r["status"], "time": r["time"]} for r in rows}

    def dashboard(self) -> dict[str, Any]:
        today = self.clock.today()
        t = today.isoformat()
        people = self.store.query_one(
            "SELECT COUNT(*) AS total, "
            "SUM(COALESCE(json_extract(metadata_json, '$.type'), 'student') = 'student') AS students, "
            "SUM(COALESCE(json_extract(metadata_json, '$.type'), 'student') = 'employee') AS employees, "
            "SUM(EXISTS(SELECT 1 FROM face_samples s WHERE s.person_id = persons.person_id)) AS with_face "
            "FROM persons")
        expected = int(self.store.scalar(
            "SELECT COUNT(*) FROM persons WHERE substr(registered_at, 1, 10) <= ?", (t,)) or 0)
        counts = {r["status"]: r["n"] for r in self.store.query(
            "SELECT status, COUNT(*) AS n FROM attendance WHERE date=? GROUP BY status", (t,))}
        present, late = int(counts.get("present", 0)), int(counts.get("late", 0))
        marked = present + late
        start = today - timedelta(days=6)
        per_day = {r["date"]: r["n"] for r in self.store.query(
            "SELECT date, COUNT(*) AS n FROM attendance WHERE date BETWEEN ? AND ? GROUP BY date",
            (start.isoformat(), t))}
        trend = [{"date": (start + timedelta(days=i)).isoformat(),
                  "count": int(per_day.get((start + timedelta(days=i)).isoformat(), 0))} for i in range(7)]
        recent = self.store.query(_SELECT + " ORDER BY a.date DESC, a.time DESC LIMIT 8")
        total = int(people["total"] or 0)
        return {
            "date": t,
            "people": {"total": total, "students": int(people["students"] or 0),
                       "employees": int(people["employees"] or 0),
                       "with_face": int(people["with_face"] or 0),
                       "without_face": total - int(people["with_face"] or 0)},
            "today": {"expected": expected, "present": present, "late": late, "marked": marked,
                      "absent": max(expected - marked, 0),
                      "rate": round(100 * marked / expected, 1) if expected else 0.0},
            "trend": trend,
            "recent": [record_out(r) for r in recent],
        }


def _safe(value: Any) -> Any:
    """Neutralise spreadsheet formula injection in exported text cells."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value
