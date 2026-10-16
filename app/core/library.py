"""Study materials (OT): PDFs she reads as they are, such as prep books and regulator guidelines. Files are
stored under DATA_DIR/library with random names, are never sent to the model, and open in the device's own
PDF viewer (on the iPad: zoom, search, Books). A PDF with bookmarks gets a chapter guide: each chapter opens
as its own small PDF, which is far quicker on an iPad than a whole textbook.
"""
import io
import json
import re
import uuid

from app.core import db
from app.core.config import DATA_DIR

LIB_DIR = DATA_DIR / "library"
CHAPTER_DIR = LIB_DIR / "chapters"  # chapters cut from a PDF, kept so each is only made once
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


def _outline(source) -> list[dict]:
    """Chapters from a PDF's bookmarks: [{title, depth, start, end}] for the top two levels, each running to the
    page before the next entry at its level or above. End-of-chapter sections such as practice tests fold into
    the chapter before them."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(source)
        if reader.is_encrypted:
            reader.decrypt("")
        total = len(reader.pages)
        flat: list[tuple[int, str, int]] = []

        def walk(items, depth):
            for it in items:
                if isinstance(it, list):
                    walk(it, depth + 1)
                elif depth <= 1:
                    try:
                        flat.append((depth, " ".join(str(it.title).split()).rstrip(","), reader.get_destination_page_number(it) + 1))
                    except Exception:  # noqa: BLE001 - a bookmark without a page
                        pass
        walk(reader.outline, 0)
    except Exception:  # noqa: BLE001 - no usable bookmarks: no chapter guide
        return []
    entries = [(d, t, p) for d, t, p in flat if not re.match(r"(?i)^(practice test questions|review questions|summary)$", t)]
    out = []
    for i, (depth, title, start) in enumerate(entries):
        nxt = next((p for d, _, p in entries[i + 1:] if d <= depth and p > start), total + 1)
        out.append({"title": title, "depth": depth, "start": start, "end": max(start, nxt - 1)})
    return out if len(out) >= 3 else []


def outline(f: dict) -> list[dict]:
    if f.get("outline_json") is None:  # files added before chapter guides: read once, then keep
        chapters = _outline(str(file_path(f)))
        with db.connect() as conn:
            conn.execute("UPDATE study_files SET outline_json=? WHERE id=?", (json.dumps(chapters), f["id"]))
        return chapters
    return json.loads(f["outline_json"])


def _without_page_links(page):
    """The page minus links to other pages of the book (web links stay). An index links to every page, and
    copying those links would pull the whole book into a one-chapter PDF."""
    from pypdf.generic import ArrayObject, NameObject
    annots = page.get("/Annots")
    if annots is None:
        return page
    keep = ArrayObject()
    for a in annots.get_object():
        obj = a.get_object()
        action = obj.get("/A")
        action = action.get_object() if action is not None else None
        if "/Dest" in obj or (action is not None and action.get("/S") in ("/GoTo", "/GoToR")):
            continue
        keep.append(a)
    page[NameObject("/Annots")] = keep
    return page


def chapter_pdf(f: dict, start: int, end: int):
    """Pages start..end of a study PDF as their own file, made once and kept."""
    if not 1 <= start <= end <= (f["pages"] or 0) or end - start >= 2000:
        raise ValueError("Those pages aren't in this PDF.")
    CHAPTER_DIR.mkdir(parents=True, exist_ok=True)
    out = CHAPTER_DIR / f"{f['stored'][:-4]}-{start}-{end}.pdf"
    if not out.exists():
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(str(file_path(f)))
        if reader.is_encrypted:
            reader.decrypt("")
        writer = PdfWriter()
        for i in range(start - 1, end):
            writer.add_page(_without_page_links(reader.pages[i]))
        tmp = out.with_suffix(".part")
        with open(tmp, "wb") as fh:
            writer.write(fh)
        tmp.replace(out)
    return out


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
        cur = conn.execute("INSERT INTO study_files (title, filename, stored, pages, bytes, notes, outline_json) VALUES (?,?,?,?,?,?,?)",
                           (name, filename, stored, _pages(data), len(data), notes.strip(), json.dumps(_outline(io.BytesIO(data)))))
        return dict(conn.execute("SELECT * FROM study_files WHERE id=?", (cur.lastrowid,)).fetchone())


def list_files() -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM study_files ORDER BY title COLLATE NOCASE").fetchall()]
    return [{k: v for k, v in r.items() if k != "outline_json"} | {"chapters": outline(r)} for r in rows]


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
    for part in CHAPTER_DIR.glob(f"{f['stored'][:-4]}-*.pdf"):
        part.unlink(missing_ok=True)
