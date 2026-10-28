"""Web-layer settings, read from environment variables (and backend/.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import time
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    p = Path(value).expanduser()
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


def _opt_int(name: str) -> int | None:
    v = os.environ.get(name, "").strip()
    return int(v) if v else None


def _late_after(value: str) -> time | None:
    value = value.strip()
    if not value:
        return None
    try:
        hh, mm = value.split(":")
        return time(int(hh), int(mm))
    except ValueError as exc:
        raise RuntimeError(f"LATE_AFTER must be HH:MM, got {value!r}") from exc


@dataclass
class Settings:
    engine_root: Path = field(default_factory=lambda: _path(
        os.environ.get("FACEATTEND_ROOT"), (BACKEND_DIR.parent / "face_attendance").resolve()))
    config_path: Path | None = None
    admin_username: str = field(default_factory=lambda: os.environ.get("ADMIN_USERNAME", "admin").strip())
    admin_password: str | None = field(default_factory=lambda: os.environ.get("ADMIN_PASSWORD") or None)
    session_hours: int = field(default_factory=lambda: int(os.environ.get("SESSION_HOURS", "12")))
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip() for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()])
    timezone: str = field(default_factory=lambda: os.environ.get("ATTENDANCE_TIMEZONE", "").strip())
    late_after: time | None = field(default_factory=lambda: _late_after(os.environ.get("LATE_AFTER", "")))
    live_min_votes: int | None = field(default_factory=lambda: _opt_int("LIVE_MIN_VOTES"))
    live_window: int | None = field(default_factory=lambda: _opt_int("LIVE_WINDOW"))
    frontend_dist: Path = field(default_factory=lambda: BACKEND_DIR.parent / "frontend" / "dist")
    load_engine: bool = True

    def __post_init__(self) -> None:
        if self.config_path is None:
            self.config_path = _path(os.environ.get("FACEATTEND_CONFIG"),
                                     self.engine_root / "config" / "default.yaml")
