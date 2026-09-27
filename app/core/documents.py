"""Her documents: certificates, letters, IDs. Files are stored under DATA_DIR/documents with random
names and are never sent to the model. Each has a category (which licence steps need it) and an
optional expiry date.
"""
import io
import re
import uuid
import zipfile
from datetime import date

from app.core import db
from app.core.config import DATA_DIR

DOC_DIR = DATA_DIR / "documents"
MAX_BYTES = 20 * 1024 * 1024

CATEGORIES = [
    {"key": "passport", "label": "Passport", "group": "Identity"},
    {"key": "photo", "label": "Passport photo", "group": "Identity"},
    {"key": "degree", "label": "Degree certificate", "group": "Education"},
    {"key": "transcripts", "label": "Transcripts / mark sheets", "group": "Education"},
    {"key": "internship", "label": "Internship completion", "group": "Education"},
    {"key": "registration", "label": "Registration / membership", "group": "Registration"},
    {"key": "good_standing", "label": "Certificate of good standing", "group": "Registration"},
    {"key": "experience_letter", "label": "Experience letter", "group": "Experience"},
    {"key": "dataflow", "label": "DataFlow report", "group": "Licensing"},
    {"key": "exam_result", "label": "Exam result", "group": "Licensing"},
    {"key": "eligibility_letter", "label": "Eligibility letter", "group": "Licensing"},
    {"key": "licence", "label": "Licence", "group": "Licensing"},
    {"key": "bls", "label": "BLS certificate", "group": "Certificates"},
    {"key": "cpd_certificate", "label": "CPD / course certificate", "group": "Certificates"},
    {"key": "cv", "label": "CV sent", "group": "Applications"},
    {"key": "cover_letter", "label": "Cover letter sent", "group": "Applications"},
    {"key": "offer_letter", "label": "Offer letter / contract", "group": "Applications"},
    {"key": "other", "label": "Other", "group": "Other"},
]
CATEGORY_KEYS = {c["key"] for c in CATEGORIES}
LABEL = {c["key"]: c["label"] for c in CATEGORIES}

# Accepted file types, recognised by their first bytes rather than the name or the browser's claim.
_SIGNATURES = [
    (b"%PDF", "application/pdf", ".pdf"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
]


def _sniff(data: bytes) -> tuple[str, str]:
    for sig, mime, ext in _SIGNATURES:
        if data.startswith(sig):
            return mime, ext
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"heif", b"mif1", b"msf1", b"hevc"):
        return "image/heic", ".heic"  # iPhone and iPad photos
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    raise ValueError("Upload a PDF or a photo (JPG, PNG, HEIC or WebP).")


def _row(r) -> dict:
    d = dict(r)
    d["category_label"] = LABEL.get(d["category"], d["category"])
    d["days_left"] = (date.fromisoformat(d["expires"]) - date.today()).days if d["expires"] else None
    return d


def add(data: bytes, filename: str, category: str, title: str, expires: str | None, notes: str) -> dict:
    if len(data) > MAX_BYTES:
        raise ValueError("That file is over 20 MB.")
    if category not in CATEGORY_KEYS:
        raise ValueError(f"Unknown category {category!r}.")
    mime, ext = _sniff(data)
    if expires:
        date.fromisoformat(expires)  # raises on a malformed date
    DOC_DIR.mkdir(parents=True, exist_ok=True)
    stored = uuid.uuid4().hex + ext
    (DOC_DIR / stored).write_bytes(data)
    db.init()
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO documents (category, title, filename, stored_name, mime, size, expires, notes) VALUES (?,?,?,?,?,?,?,?)",
            (category, title.strip() or LABEL[category], filename, stored, mime, len(data), expires or None, notes or ""))
        return get(cur.lastrowid, conn)


def get(doc_id: int, conn=None) -> dict | None:
    if conn is None:
        db.init()
        with db.connect() as c:
            return get(doc_id, c)
    r = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    return _row(r) if r else None


def list_all() -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM documents ORDER BY category, created_at DESC").fetchall()
    return [_row(r) for r in rows]


def update(doc_id: int, **fields) -> dict | None:
    allowed = {"category", "title", "expires", "notes"}
    fields = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if "category" in fields and fields["category"] not in CATEGORY_KEYS:
        raise ValueError(f"Unknown category {fields['category']!r}.")
    if fields.get("expires"):
        date.fromisoformat(fields["expires"])
    if "expires" in fields and not fields["expires"]:
        fields["expires"] = None
    if fields:
        with db.connect() as conn:
            conn.execute(f"UPDATE documents SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", (*fields.values(), doc_id))
    return get(doc_id)


def delete(doc_id: int) -> None:
    d = get(doc_id)
    if d:
        (DOC_DIR / d["stored_name"]).unlink(missing_ok=True)
        with db.connect() as conn:
            conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))


def file_path(d: dict):
    return DOC_DIR / d["stored_name"]


def safe_name(d: dict) -> str:
    """A download name made from the title, with the stored file's real extension."""
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "", d["title"]).strip().replace(" ", "_")[:60] or "document"
    return stem + "." + d["stored_name"].rsplit(".", 1)[-1]


def zip_bytes(ids: list[int]) -> bytes:
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i in ids:
            d = get(i)
            if not d:
                continue
            name = f"{LABEL.get(d['category'], 'Other')}/{safe_name(d)}"
            while name in used:
                name = name.replace(".", "_1.", 1)
            used.add(name)
            z.write(file_path(d), name)
    return buf.getvalue()


def checklist(routes: list[dict]) -> list[dict]:
    """Every document the given licence routes ask for, which steps need it, and what she has."""
    have: dict[str, list[dict]] = {}
    for d in list_all():
        have.setdefault(d["category"], []).append({"id": d["id"], "title": d["title"], "days_left": d["days_left"]})
    need: dict[str, list[str]] = {}
    for r in routes:
        for st in r["steps"]:
            for key in st["docs"]:
                need.setdefault(key, [])
                label = f"{r['regulator']}: {st['title']}"
                if label not in need[key]:
                    need[key].append(label)
    order = [c["key"] for c in CATEGORIES]
    return [{"key": k, "label": LABEL[k], "needed_by": need[k], "have": have.get(k, [])}
            for k in sorted(need, key=order.index)]
