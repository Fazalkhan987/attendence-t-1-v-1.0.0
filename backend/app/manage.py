"""Admin management: `python -m app.manage create-admin` / `reset-password`."""
from __future__ import annotations

import argparse
import getpass
import sys

from .auth import hash_password
from .context import AppContext
from .errors import ApiError
from .settings import Settings


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m app.manage")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-admin", help="create an administrator account")
    c.add_argument("--username", required=True)
    c.add_argument("--name", default=None)
    r = sub.add_parser("reset-password", help="set a new password and sign out all sessions")
    r.add_argument("--username", required=True)
    sub.add_parser("list-admins")
    args = ap.parse_args()

    s = Settings()
    s.load_engine = False
    ctx = AppContext(s)
    try:
        if args.cmd == "list-admins":
            for row in ctx.store.query("SELECT username, full_name, last_login_at FROM admin_users"):
                print(f"{row['username']:<20} {row['full_name'] or '':<25} last login: {row['last_login_at'] or '-'}")
            return 0
        pw = getpass.getpass("Password (min 10 chars): ")
        if pw != getpass.getpass("Repeat password: "):
            print("Passwords do not match", file=sys.stderr)
            return 1
        if args.cmd == "create-admin":
            ctx.auth.create_admin(args.username, pw, args.name)
            print(f"Administrator '{args.username}' created.")
        else:
            if len(pw) < 10:
                print("Password must be at least 10 characters", file=sys.stderr)
                return 1
            row = ctx.store.query_one("SELECT id FROM admin_users WHERE username=?", (args.username,))
            if not row:
                print(f"No administrator named '{args.username}'", file=sys.stderr)
                return 1
            with ctx.repo.transaction() as conn:
                conn.execute("UPDATE admin_users SET password_hash=? WHERE id=?", (hash_password(pw), row["id"]))
                conn.execute("DELETE FROM admin_sessions WHERE user_id=?", (row["id"],))
            print(f"Password reset for '{args.username}'. All sessions signed out.")
        return 0
    except ApiError as exc:
        print(exc.detail, file=sys.stderr)
        return 1
    finally:
        ctx.close()


if __name__ == "__main__":
    sys.exit(main())
