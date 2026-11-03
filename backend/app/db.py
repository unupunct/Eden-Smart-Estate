import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from . import config


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    config.ensure_dirs()
    conn = sqlite3.connect(config.DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def migrate() -> list[str]:
    """Apply pending *.sql migrations in filename order. Returns applied names."""
    applied: list[str] = []
    with session() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations")}
        for path in sorted(config.MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            conn.executescript(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)", (path.name, now()))
            applied.append(path.name)
    return applied


def dumps(v) -> str:
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
