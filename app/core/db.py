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
CREATE TABLE IF NOT EXISTS exam_questions (   -- OT: every reviewed practice question, per licensing exam
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exam         TEXT NOT NULL,
    topic        TEXT NOT NULL,
    difficulty   TEXT NOT NULL,
    question     TEXT NOT NULL,
    options_json TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    explanation  TEXT NOT NULL,
    reference    TEXT,
    qhash        TEXT NOT NULL,             -- normalised question text, to keep the bank free of repeats
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (exam, qhash)
);
CREATE TABLE IF NOT EXISTS exam_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exam         TEXT NOT NULL,
    mode         TEXT NOT NULL,             -- quick | timed | full
    source       TEXT NOT NULL,             -- new | bank | mistakes
    total        INTEGER NOT NULL,
    time_limit   INTEGER,                   -- seconds; null = untimed
    seconds_used INTEGER,
    correct      INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    finished_at  TEXT
);
CREATE TABLE IF NOT EXISTS exam_answers (
    session_id  INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    picked      INTEGER,
    correct     INTEGER,
    flagged     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, position)
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
CREATE TABLE IF NOT EXISTS study_files (     -- OT: PDFs she reads as they are (library.py)
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title    TEXT NOT NULL,
    filename TEXT NOT NULL,                  -- the name it was uploaded with
    stored   TEXT NOT NULL,                  -- its random name under DATA_DIR/library
    pages    INTEGER,
    bytes    INTEGER NOT NULL,
    notes    TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS path_runs (       -- OT: each time she works through an exam's study path
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exam         TEXT NOT NULL,
    cycle        INTEGER NOT NULL,           -- 1 for her first run, 2 when she starts again, ...
    started_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at TEXT,
    cards_added  INTEGER,                    -- questions she got wrong, turned into flashcards when the run was completed
    UNIQUE (exam, cycle)
);
CREATE TABLE IF NOT EXISTS flashcards (      -- OT: revision cards, reviewed with spaced repetition
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    deck       TEXT NOT NULL,
    topic      TEXT NOT NULL,
    front      TEXT NOT NULL,
    back       TEXT NOT NULL,
    box        INTEGER NOT NULL DEFAULT 0,  -- Leitner box: 0 = new or missed, 5 = known for weeks
    due        TEXT,                        -- date it comes up again
    seen       INTEGER NOT NULL DEFAULT 0,
    hidden     INTEGER NOT NULL DEFAULT 0,  -- she marked it wrong or not useful
    fhash      TEXT NOT NULL,               -- normalised front, to keep a deck free of repeats
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (deck, fhash)
);
"""

# Columns added after the first release: (table, column, definition). init() adds any that are missing.
MIGRATIONS = [
    ("applications", "country", "TEXT"),
    ("applications", "agency_json", "TEXT"),
    ("mcq_results", "exam", "TEXT"),  # OT: the licensing exam being practised for
    ("exam_sessions", "round", "TEXT"),       # OT: the study-path round it belongs to (exams.ROUNDS), null for free practice
    ("exam_sessions", "cycle", "INTEGER"),    # OT: which run of the study path (path_runs.cycle); null means 1
    ("exam_answers", "option_order", "TEXT"), # the order its options were shown in, shuffled for every session
    ("interviews", "params_json", "TEXT"),    # how the interview was set up, to resume it
    ("interviews", "finished", "INTEGER NOT NULL DEFAULT 1"),  # 0 while she is part-way through
    ("interviews", "score", "INTEGER"),       # out of 10, from the end report
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
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                except sqlite3.OperationalError as e:  # two first requests racing to add the same column
                    if "duplicate column" not in str(e):
                        raise
