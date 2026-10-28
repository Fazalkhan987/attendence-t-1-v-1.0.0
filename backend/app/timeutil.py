"""'Today' and 'now' in the attendance timezone."""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo


class Clock:
    def __init__(self, tz_name: str = ""):
        self.tz = ZoneInfo(tz_name) if tz_name else None
        self.tz_name = tz_name or "server local time"

    def now(self) -> datetime:
        return datetime.now(self.tz) if self.tz else datetime.now()

    def today(self) -> date:
        return self.now().date()
