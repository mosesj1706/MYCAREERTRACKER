"""SQLite storage. One file, no ORM; JSON columns hold the Pydantic objects."""
import sqlite3
from contextlib import contextmanager

from app.core.config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company       TEXT,
    title         TEXT NOT NULL,
    url           TEXT,
    source        TEXT,
    jd_text       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'saved',
    match_score   REAL,
    job_json      TEXT NOT NULL,
    match_json    TEXT NOT NULL,
    tailored_json TEXT,
    notes         TEXT DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    applied_at    TEXT
);
CREATE TABLE IF NOT EXISTS status_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    status         TEXT NOT NULL,
    changed_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS mcq_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    topic      TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    correct    INTEGER NOT NULL,
    question   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS interviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
    kind           TEXT NOT NULL,          -- mock | real
    transcript_json TEXT NOT NULL,
    summary        TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
