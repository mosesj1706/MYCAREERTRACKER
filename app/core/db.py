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
CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    filename    TEXT NOT NULL,             -- the name it was uploaded with
    stored_name TEXT NOT NULL,             -- random name under DATA_DIR/documents
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    expires     TEXT,                      -- YYYY-MM-DD
    notes       TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cpd_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,              -- YYYY-MM-DD
    kind       TEXT NOT NULL,              -- course | workshop | conference | supervision | reading | case_review | teaching | other
    title      TEXT NOT NULL,
    provider   TEXT DEFAULT '',
    hours      REAL NOT NULL DEFAULT 0,
    reflection TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS case_studies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    input_json TEXT NOT NULL,              -- what she typed (de-identified)
    story_json TEXT,                       -- CaseStory once built
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cover_letters (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    country        TEXT,
    options_json   TEXT NOT NULL,
    text           TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS licence_steps (
    route_id   TEXT NOT NULL,
    step_id    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'todo', -- todo | in_progress | done | not_needed
    date       TEXT,
    cost       TEXT,
    notes      TEXT DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (route_id, step_id)
);
"""

# Columns added after the first release: (table, column, definition). init() adds any that are missing.
MIGRATIONS = [
    ("applications", "country", "TEXT"),
    ("applications", "agency_json", "TEXT"),
    ("mcq_results", "exam", "TEXT"),  # OT: the licensing exam being practised for
]


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
        for table, column, definition in MIGRATIONS:
            if column not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
