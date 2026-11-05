"""Local admin tools (run on the computer EDEN lives on; there is deliberately no API for this).

    python -m app.admin reset --username admin      asks for a new password (or reads EDEN_NEW_PASSWORD)
    python -m app.admin status
"""
import argparse
import getpass
import os
import sys

from . import auth, db


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.admin")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("reset", help="create the admin account or set a new password for it")
    r.add_argument("--username", default="")
    sub.add_parser("status", help="show whether an admin account exists")
    args = ap.parse_args(argv)
    db.migrate()
    admin = auth.get_admin()
    if args.cmd == "status":
        print(f"ADMIN={admin['username']}" if admin else "ADMIN=none")
        return 0
    username = args.username or (admin["username"] if admin else "admin")
    password = os.environ.get("EDEN_NEW_PASSWORD") or getpass.getpass(f"New password for {username}: ")
    try:
        auth.set_admin(username, password)
    except Exception as e:  # HTTPException carries the human-readable reason in .detail
        print(getattr(e, "detail", str(e)), file=sys.stderr)
        return 1
    print(f"RESET_OK={username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
