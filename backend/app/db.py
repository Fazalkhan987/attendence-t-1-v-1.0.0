"""Web-layer tables living in the SAME SQLite file as the face engine's Repository.

* Writes go through ``Repository.transaction()`` so the database has a single writer
  connection (no SQLITE_BUSY between two writers).
* Reads use a separate read-only-in-practice connection; WAL mode lets them run while
  the engine writes.
* Schema changes are versioned under the ``web_schema_version`` setting. To migrate to
  PostgreSQL/MySQL later, the tables below map 1:1 (see README, "Database").
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

from faceattend.storage.database import Repository

WEB_SCHEMA_VERSION = 1

# Each entry upgrades the schema from version i to i+1.
MIGRATIONS: list[list[str]] = [
    [
        """CREATE TABLE IF NOT EXISTS admin_users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
            full_name     TEXT,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            last_login_at TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash   TEXT PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
            created_at   TEXT NOT NULL,
            expires_at   TEXT NOT NULL,
            user_agent   TEXT
        )""",
        "CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(user_id)",
        """CREATE TABLE IF NOT EXISTS attendance (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
            date        TEXT NOT NULL,              -- YYYY-MM-DD in ATTENDANCE_TIMEZONE
            time        TEXT NOT NULL,              -- HH:MM:SS in ATTENDANCE_TIMEZONE
            status      TEXT NOT NULL CHECK (status IN ('present', 'late')),
            method      TEXT NOT NULL CHECK (method IN ('face', 'manual')),
            similarity  REAL,
            marked_by   TEXT,
            created_at  TEXT NOT NULL,
            UNIQUE (person_id, date)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)",
    ],
]


class WebStore:
    def __init__(self, repo: Repository, db_path: str | Path):
        self.repo = repo
        self._lock = threading.RLock()
        self._read = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._read.row_factory = sqlite3.Row
        self._read.execute("PRAGMA busy_timeout = 5000")
        self.migrate()

    def close(self) -> None:
        with self._lock:
            self._read.close()

    def migrate(self) -> None:
        current = int(self.repo.get_setting("web_schema_version") or 0)
        if current > WEB_SCHEMA_VERSION:
            raise RuntimeError(f"Database web schema v{current} is newer than this app (v{WEB_SCHEMA_VERSION})")
        for version in range(current, WEB_SCHEMA_VERSION):
            with self.repo.transaction() as c:
                for stmt in MIGRATIONS[version]:
                    c.execute(stmt)
                c.execute("INSERT INTO settings(key, value) VALUES('web_schema_version', ?) "
                          "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(version + 1),))

    # ---------- helpers ----------
    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._read.execute(sql, tuple(params)).fetchall()

    def query_one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._read.execute(sql, tuple(params)).fetchone()

    def scalar(self, sql: str, params: Iterable[Any] = ()) -> Any:
        row = self.query_one(sql, params)
        return None if row is None else row[0]

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self.repo.transaction() as c:
            return c.execute(sql, tuple(params))
