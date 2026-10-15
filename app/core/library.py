"""Study materials (OT): PDFs she reads as they are, such as prep books and regulator guidelines. Files are
stored under DATA_DIR/library with random names, are never sent to the model, and open in the device's own
PDF viewer (on the iPad: zoom, search, Books).
"""
import io
import re
import uuid

from app.core import db
from app.core.config import DATA_DIR

LIB_DIR = DATA_DIR / "library"
MAX_BYTES = 100 * 1024 * 1024


def _pages(data: bytes) -> int | None:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            reader.decrypt("")  # many prep PDFs only restrict printing; they open without a password
        return len(reader.pages)
    except Exception:  # noqa: BLE001 - a page count is nice to have, not required
        return None


def add(data: bytes, filename: str, title: str = "", notes: str = "") -> dict:
    if not data.startswith(b"%PDF"):
        raise ValueError("Upload a PDF.")
    if len(data) > MAX_BYTES:
        raise ValueError("That PDF is over 100 MB.")
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.pdf"
    (LIB_DIR / stored).write_bytes(data)
    name = title.strip() or re.sub(r"[_-]+", " ", filename.rsplit(".", 1)[0]).strip() or "Untitled"
    db.init()
    with db.connect() as conn:
        cur = conn.execute("INSERT INTO study_files (title, filename, stored, pages, bytes, notes) VALUES (?,?,?,?,?,?)",
                           (name, filename, stored, _pages(data), len(data), notes.strip()))
        return dict(conn.execute("SELECT * FROM study_files WHERE id=?", (cur.lastrowid,)).fetchone())


def list_files() -> list[dict]:
    db.init()
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM study_files ORDER BY title COLLATE NOCASE").fetchall()]


def get(file_id: int) -> dict | None:
    db.init()
    with db.connect() as conn:
        r = conn.execute("SELECT * FROM study_files WHERE id=?", (file_id,)).fetchone()
    return dict(r) if r else None


def file_path(f: dict):
    return LIB_DIR / f["stored"]


def safe_name(f: dict) -> str:
    return (re.sub(r"[^\w .()-]+", "", f["title"]).strip() or "study-material") + ".pdf"


def delete(file_id: int) -> None:
    f = get(file_id)
    if f is None:
        raise KeyError(file_id)
    with db.connect() as conn:
        conn.execute("DELETE FROM study_files WHERE id=?", (file_id,))
    file_path(f).unlink(missing_ok=True)
