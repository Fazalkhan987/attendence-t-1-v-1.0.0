from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from faceattend.validation import validate_person_id

from ..auth import Admin, AdminDep
from ..errors import ApiError

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


class ManualMarkIn(BaseModel):
    person_id: str
    date: dt.date | None = None
    time: dt.time | None = None
    status: Literal["present", "late"] | None = None


def _filters(date_from, date_to, search, person_type, status, method) -> dict:
    return dict(date_from=date_from, date_to=date_to, search=search, person_type=person_type,
                status=status, method=method)


@router.get("")
def list_attendance(request: Request, date_from: str | None = None, date_to: str | None = None,
                    search: str | None = None, person_type: str | None = None, status: str | None = None,
                    method: str | None = None, page: int = Query(1, ge=1),
                    page_size: int = Query(25, ge=1, le=200), _: Admin = AdminDep):
    return request.app.state.ctx.attendance.list(
        page=page, page_size=page_size, **_filters(date_from, date_to, search, person_type, status, method))


@router.get("/export")
def export_attendance(request: Request, date_from: str | None = None, date_to: str | None = None,
                      search: str | None = None, person_type: str | None = None, status: str | None = None,
                      method: str | None = None, _: Admin = AdminDep):
    ctx = request.app.state.ctx
    data = ctx.attendance.export_csv(**_filters(date_from, date_to, search, person_type, status, method))
    span = f"{date_from or 'start'}_to_{date_to or ctx.clock.today().isoformat()}"
    return Response(data.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="attendance_{span}.csv"'})


@router.get("/absent")
def absentees(request: Request, day: dt.date | None = Query(None, alias="date"), _: Admin = AdminDep):
    ctx = request.app.state.ctx
    d = day or ctx.clock.today()
    items = ctx.attendance.absentees(d)
    return {"date": d.isoformat(), "items": items, "total": len(items)}


@router.post("", status_code=201)
def mark_manually(request: Request, body: ManualMarkIn, admin: Admin = AdminDep):
    ctx = request.app.state.ctx
    person = ctx.persons.get(validate_person_id(body.person_id))
    if body.date and body.date > ctx.clock.today():
        raise ApiError(422, "Attendance cannot be marked for a future date", "invalid_input")
    record, created = ctx.attendance.mark(person.person_id, "manual", marked_by=admin.username,
                                          on=body.date, at=body.time, status=body.status)
    if not created:
        raise ApiError(409, f"{person.full_name} is already marked {record['status']} on {record['date']} "
                            f"at {record['time']}", "already_marked", record=record)
    return record


@router.delete("/{record_id}", status_code=204)
def delete_record(request: Request, record_id: int, _: Admin = AdminDep):
    request.app.state.ctx.attendance.delete(record_id)
