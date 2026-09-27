"""Cover letters, one or more versions per job: written from the JD, the fit assessment and the
profile, in the job country's norms. The letter can only claim what the profile supports."""
import json
from datetime import date
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app.core import countries, db, llm
from app.core.config import load_prompt
from app.core.matcher import profile_block
from app.core.models import Profile
from app.core.text import plain
from app.core.tracker import Application

LENGTH_WORDS = {"short": "150-200", "standard": "220-270", "long": "320-380"}


def _row(r) -> dict:
    d = dict(r)
    d["options"] = json.loads(d.pop("options_json"))
    return d


def generate(profile: Profile, options: dict, application: Application | None = None, jd_text: str | None = None,
             country: str | None = None) -> dict:
    """Write a letter and save it as a new version."""
    if application is None and not (jd_text and jd_text.strip()):
        raise ValueError("Pick a tracked job or paste a job description.")
    code = country or (application.country if application else None) or countries.selection()["primary"]
    parts = []
    if application:
        parts += [f"<job_description>\n{application.jd_text}\n</job_description>",
                  f"<job_analysis>\n{application.job.model_dump_json(indent=1)}\n</job_analysis>",
                  f"<fit_assessment score={application.match.score()}>\n{application.match.model_dump_json(indent=1)}\n</fit_assessment>"]
        if application.tailored:
            parts.append("<honesty_notes>\n" + "\n".join(f"- {n}" for n in application.tailored.honesty_notes) + "\n</honesty_notes>")
    else:
        parts.append(f"<job_description>\n{jd_text}\n</job_description>")
    norms = countries.norms_block(code) if code else ""
    if norms:
        parts.append(norms)
    opts = {"length": options.get("length", "standard"), "tone": options.get("tone", "formal"),
            "addressee": (options.get("addressee") or "").strip(), "include_licence": bool(options.get("include_licence", True)),
            "include_notice": bool(options.get("include_notice", True)), "include_visa": bool(options.get("include_visa", False)),
            "extra": (options.get("extra") or "").strip()}
    parts.append("<options>\n" + json.dumps(opts, indent=1) + "\n</options>")
    years = profile.total_experience_years()
    half = round(years * 2) / 2  # 3.2 -> "3", 2.6 -> "2.5", as the tailor states it
    system = load_prompt("cover_letter").format(words=LENGTH_WORDS.get(opts["length"], LENGTH_WORDS["standard"]),
                                               today=date.today().strftime("%d %B %Y"),
                                               years_text=str(int(half)) if half == int(half) else f"{half:.1f}")
    text = plain(llm.complete("\n\n".join(parts), system=system, cached=profile_block(profile), effort="medium",
                              max_tokens=4000, feature="cover_letter")).strip()
    title = f"{application.title}{' - ' + application.company if application and application.company else ''}" if application \
        else (options.get("title") or "Pasted job").strip()
    db.init()
    with db.connect() as conn:
        cur = conn.execute("INSERT INTO cover_letters (application_id, title, country, options_json, text) VALUES (?,?,?,?,?)",
                           (application.id if application else None, title, code, json.dumps(opts), text))
        return _row(conn.execute("SELECT * FROM cover_letters WHERE id=?", (cur.lastrowid,)).fetchone())


def list_all(app_id: int | None = None) -> list[dict]:
    db.init()
    with db.connect() as conn:
        q = "SELECT * FROM cover_letters" + (" WHERE application_id=?" if app_id else "") + " ORDER BY created_at DESC, id DESC"
        return [_row(r) for r in conn.execute(q, (app_id,) if app_id else ()).fetchall()]


def get(letter_id: int) -> dict | None:
    db.init()
    with db.connect() as conn:
        r = conn.execute("SELECT * FROM cover_letters WHERE id=?", (letter_id,)).fetchone()
    return _row(r) if r else None


def update_text(letter_id: int, text: str) -> dict | None:
    with db.connect() as conn:
        conn.execute("UPDATE cover_letters SET text=?, updated_at=datetime('now','localtime') WHERE id=?", (text.strip(), letter_id))
    return get(letter_id)


def delete(letter_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM cover_letters WHERE id=?", (letter_id,))


def pdf(letter: dict, profile: Profile) -> bytes:
    """The letter on an A4 page with her name and contact line on top."""
    pi = profile.personal_info
    body = ParagraphStyle("b", fontName="Helvetica", fontSize=10.5, leading=15)
    head = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=15, leading=19)
    meta = ParagraphStyle("m", fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.HexColor("#5b6272"))
    esc = lambda s: plain(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
                            title=f"{pi.name} - Cover letter", author=pi.name, creator=pi.name, producer=pi.name)
    f = [Paragraph(esc(pi.name), head), Paragraph(esc("  ·  ".join(x for x in (profile.target.primary_role, pi.phone, pi.email, pi.location) if x)), meta),
         Spacer(1, 10 * mm)]
    for para in letter["text"].split("\n\n"):
        f += [Paragraph(esc(para).replace("\n", "<br/>"), body), Spacer(1, 4 * mm)]
    doc.build(f)
    return buf.getvalue()
