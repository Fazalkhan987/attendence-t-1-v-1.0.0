"""Administrator accounts and session tokens.

* Passwords: PBKDF2-HMAC-SHA256, 600k iterations (same scheme as the engine's AdminGuard).
* Sessions: random 256-bit bearer tokens; only their SHA-256 is stored, so a leaked
  database does not leak usable tokens. Logout deletes the row (real revocation).
* Login throttling: 5 failures per username+IP within 10 minutes locks for 5 minutes.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request

from .db import WebStore
from .errors import ApiError

log = logging.getLogger(__name__)
_ITERATIONS = 600_000
MIN_PASSWORD_LEN = 10


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        cand = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(cand, bytes.fromhex(hash_hex))
    except (ValueError, TypeError):
        return False


def _utc(dt: datetime | None = None) -> str:
    return (dt or datetime.now(timezone.utc)).isoformat(timespec="seconds")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Admin:
    id: int
    username: str
    full_name: str | None

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username, "full_name": self.full_name}


class LoginThrottle:
    def __init__(self, max_failures: int = 5, window_s: int = 600, lockout_s: int = 300):
        self.max_failures, self.window_s, self.lockout_s = max_failures, window_s, lockout_s
        self._fails: dict[str, list[float]] = {}
        self._locked: dict[str, float] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        with self._lock:
            until = self._locked.get(key, 0)
            if until > time.time():
                mins = max(1, round((until - time.time()) / 60))
                raise ApiError(429, f"Too many failed attempts. Try again in {mins} minute(s).", "locked")

    def fail(self, key: str) -> None:
        now = time.time()
        with self._lock:
            hits = [t for t in self._fails.get(key, []) if now - t < self.window_s] + [now]
            self._fails[key] = hits
            if len(hits) >= self.max_failures:
                self._locked[key] = now + self.lockout_s
                self._fails.pop(key, None)

    def success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
            self._locked.pop(key, None)


class AuthService:
    def __init__(self, store: WebStore, session_hours: int):
        self.store = store
        self.session_hours = session_hours
        self.throttle = LoginThrottle()

    def admin_count(self) -> int:
        return int(self.store.scalar("SELECT COUNT(*) FROM admin_users") or 0)

    def create_admin(self, username: str, password: str, full_name: str | None = None) -> Admin:
        username = (username or "").strip()
        if not 3 <= len(username) <= 64 or not username.replace("_", "").replace(".", "").replace("-", "").isalnum():
            raise ApiError(422, "Username must be 3-64 letters, digits, '.', '_' or '-'", "invalid_input")
        if len(password) < MIN_PASSWORD_LEN:
            raise ApiError(422, f"Password must be at least {MIN_PASSWORD_LEN} characters", "invalid_input")
        if self.store.query_one("SELECT 1 FROM admin_users WHERE username=?", (username,)):
            raise ApiError(409, f"Username '{username}' already exists", "duplicate_username")
        self.store.execute(
            "INSERT INTO admin_users(username, full_name, password_hash, created_at) VALUES(?,?,?,?)",
            (username, full_name, hash_password(password), _utc()))
        row = self.store.query_one("SELECT * FROM admin_users WHERE username=?", (username,))
        return Admin(row["id"], row["username"], row["full_name"])

    def ensure_initial_admin(self, username: str, password: str | None) -> None:
        if self.admin_count():
            return
        if not password:
            log.warning("No administrator exists. Set ADMIN_PASSWORD in backend/.env or run "
                        "`python -m app.manage create-admin`.")
            return
        self.create_admin(username, password, "Administrator")
        log.warning("Created initial administrator '%s' from ADMIN_PASSWORD - change it after first login.",
                    username)

    def login(self, username: str, password: str, ip: str, user_agent: str | None) -> tuple[str, Admin, str]:
        key = f"{(username or '').lower()}|{ip}"
        self.throttle.check(key)
        row = self.store.query_one("SELECT * FROM admin_users WHERE username=?", ((username or "").strip(),))
        # Verify against a dummy hash when the user does not exist to keep timing uniform.
        ok = verify_password(password, row["password_hash"] if row else _DUMMY_HASH)
        if not row or not ok:
            self.throttle.fail(key)
            self.store.repo.audit("web_login_failed", detail=f"user={(username or '')[:64]}")
            raise ApiError(401, "Incorrect username or password", "invalid_credentials")
        self.throttle.success(key)
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=self.session_hours)
        now = _utc()
        with self.store.repo.transaction() as c:
            c.execute("DELETE FROM admin_sessions WHERE expires_at < ?", (now,))
            c.execute("INSERT INTO admin_sessions(token_hash, user_id, created_at, expires_at, user_agent) "
                      "VALUES(?,?,?,?,?)", (_token_hash(token), row["id"], now, _utc(expires),
                                           (user_agent or "")[:200]))
            c.execute("UPDATE admin_users SET last_login_at=? WHERE id=?", (now, row["id"]))
        self.store.repo.audit("web_login", detail=f"user={row['username']}")
        return token, Admin(row["id"], row["username"], row["full_name"]), _utc(expires)

    def resolve(self, token: str | None) -> Admin:
        if not token:
            raise ApiError(401, "Sign in to continue", "unauthorized")
        row = self.store.query_one(
            "SELECT u.id, u.username, u.full_name, s.expires_at FROM admin_sessions s "
            "JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash=?", (_token_hash(token),))
        if row is None or row["expires_at"] < _utc():
            raise ApiError(401, "Your session has expired. Sign in again.", "session_expired")
        return Admin(row["id"], row["username"], row["full_name"])

    def logout(self, token: str) -> None:
        self.store.execute("DELETE FROM admin_sessions WHERE token_hash=?", (_token_hash(token),))

    def change_password(self, admin: Admin, current: str, new: str, keep_token: str) -> None:
        row = self.store.query_one("SELECT password_hash FROM admin_users WHERE id=?", (admin.id,))
        if not row or not verify_password(current, row["password_hash"]):
            raise ApiError(400, "Current password is incorrect", "invalid_credentials")
        if len(new) < MIN_PASSWORD_LEN:
            raise ApiError(422, f"New password must be at least {MIN_PASSWORD_LEN} characters", "invalid_input")
        with self.store.repo.transaction() as c:
            c.execute("UPDATE admin_users SET password_hash=? WHERE id=?", (hash_password(new), admin.id))
            # Sign out every other session for this account.
            c.execute("DELETE FROM admin_sessions WHERE user_id=? AND token_hash<>?",
                      (admin.id, _token_hash(keep_token)))
        self.store.repo.audit("web_password_changed", detail=f"user={admin.username}")


_DUMMY_HASH = hash_password(secrets.token_hex(8))


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def current_admin(request: Request) -> Admin:
    return request.app.state.ctx.auth.resolve(bearer_token(request))


AdminDep = Depends(current_admin)
