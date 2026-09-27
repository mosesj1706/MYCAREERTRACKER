"""Occupational therapy CV, laid out to each country's conventions (cv_format in packs/ot/countries.json):
photo or none, which personal details appear, A4 or US Letter, "CV" or "Resume", a references line.

Like the tech resume it is generated from the profile, so it can never say more than the profile does.
Only independent (hands_on) and advanced skills are listed: a line on a CV implies you can be
interviewed on it. Registration sits near the top, where regulators and HR look first.
"""
from datetime import date
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core import countries
from app.core.config import DATA_DIR
from app.core.models import Profile, TailoredOutput, parse_ym
from app.core.text import plain

PHOTO_PATH = DATA_DIR / "photo.jpg"  # set on Profile > Edit profile > CV photo

INK = colors.HexColor("#1d1d1f")
MUTED = colors.HexColor("#5f6368")
ACCENT = colors.HexColor("#1f4e79")  # deep clinical blue for the name rule and section headings
RULE = colors.HexColor("#d5d9df")

S = {
    "name": ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=INK),
    "role": ParagraphStyle("role", fontName="Helvetica", fontSize=11, leading=14, textColor=ACCENT, spaceBefore=1),
    "contact": ParagraphStyle("contact", fontName="Helvetica", fontSize=8.8, leading=12, textColor=MUTED, spaceBefore=3),
    "status": ParagraphStyle("status", fontName="Helvetica-Bold", fontSize=8.8, leading=12, textColor=ACCENT, spaceBefore=2),
    "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=9.5, leading=12, textColor=ACCENT, spaceBefore=9, spaceAfter=1),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.4, leading=12.6, textColor=INK),
    "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=9.4, leading=12.4, textColor=INK, leftIndent=10, bulletIndent=1),
    "job": ParagraphStyle("job", fontName="Helvetica-Bold", fontSize=9.8, leading=12.6, textColor=INK),
    "dates": ParagraphStyle("dates", fontName="Helvetica", fontSize=8.8, leading=12.6, textColor=MUTED, alignment=TA_RIGHT),
    "meta": ParagraphStyle("meta", fontName="Helvetica", fontSize=8.8, leading=11.5, textColor=MUTED),
    "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8.8, leading=12.4, textColor=MUTED),
}
SKILL_GROUPS = [("populations", "Client groups"), ("assessments", "Assessments"), ("interventions", "Interventions"),
                ("assistive_tech", "Assistive technology"), ("documentation", "Frameworks & documentation"),
                ("settings", "Practice settings"), ("credentials", "Certified in")]
DETAIL_LABELS = {"nationality": "Nationality", "date_of_birth": "Date of birth", "visa_status": "Visa / work status",
                 "notice_period": "Notice period"}


def _esc(s: str) -> str:
    return plain(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _month(ym: str | None) -> str:
    if not ym or parse_ym(ym) is None:
        return "Present"
    return f"{date(*parse_ym(ym), 1):%b %Y}" if "-" in ym else ym.strip()


def _heading(text: str) -> list:
    return [Paragraph(text.upper(), S["h"]), HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=1, spaceAfter=4)]


def _two_col(rows: list[list], left: float) -> Table:
    t = Table(rows, colWidths=[left, None])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 1.2),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2)]))
    return t


def use_photo(fmt: dict, photo: bool | None) -> bool:
    """The country's convention unless the caller overrides it: expected -> on, optional/avoid -> off."""
    return (fmt["photo"] == "expected" if photo is None else photo) and PHOTO_PATH.exists()


def _licence_status(code: str | None) -> str | None:
    """One line of real licence progress for Gulf CVs, from her tracker (never more than it shows)."""
    if not code:
        return None
    sel = countries.selection()
    prog = countries.progress()
    lines = []
    for rid in sel["routes"].get(code, []):
        _, r = countries.route(rid)
        p = prog.get(rid, {})
        done = [s["title"] for s in r["steps"] if p.get(s["id"], {}).get("status") == "done" and s["id"] != "eligibility"]
        doing = [s["title"] for s in r["steps"] if p.get(s["id"], {}).get("status") == "in_progress"]
        if doing:
            lines.append(f"{r['regulator']} licensing: {doing[-1].lower()} in progress")
        elif done:
            lines.append(f"{r['regulator']} licensing: {done[-1].lower()} complete")
    return " · ".join(lines) or None


def build(profile: Profile, tailored: TailoredOutput | None, job_title: str | None, country: str | None,
          photo: bool | None) -> bytes:
    p, pi = profile, profile.personal_info
    fmt = countries.cv_format(country)
    summary = tailored.summary if tailored else p.summary
    rewrites = {b.original: b.rewritten for b in tailored.bullets} if tailored else {}
    us_style = fmt["document"] == "Resume"

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER if fmt["paper"] == "Letter" else A4, leftMargin=17 * mm, rightMargin=17 * mm,
                            topMargin=14 * mm, bottomMargin=15 * mm, title=f"{pi.name} - {fmt['document']}",
                            author=pi.name, subject=fmt["document"], creator=pi.name, producer=pi.name)
    f: list = []

    # Header: name, role, contact; photo on the right where the country expects one.
    head = [Paragraph(_esc(pi.name), S["name"]), Paragraph(_esc(job_title or p.target.primary_role), S["role"])]
    contact = [x for x in (pi.location, pi.phone, pi.email) if x]
    if pi.linkedin:
        url = pi.linkedin if pi.linkedin.startswith("http") else "https://" + pi.linkedin
        contact.append(f'<link href="{url}" color="#1f4e79">LinkedIn</link>')
    head.append(Paragraph("  ·  ".join(c if c.startswith("<link") else _esc(c) for c in contact), S["contact"]))
    status = _licence_status(fmt["code"]) if fmt["region"] == "gulf" else None
    if status:
        head.append(Paragraph(_esc(status), S["status"]))
    if use_photo(fmt, photo):
        img = Image(str(PHOTO_PATH), width=26 * mm, height=33 * mm, kind="proportional")
        t = Table([[head, img]], colWidths=[None, 28 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                               ("BOX", (1, 0), (1, 0), 0, colors.white)]))
        f.append(t)
    else:
        f.extend(head)
    f.append(HRFlowable(width="100%", thickness=1.4, color=ACCENT, spaceBefore=6, spaceAfter=2))

    f += _heading("Professional summary") + [Paragraph(_esc(summary), S["body"])]

    if p.registrations:
        f += _heading("Licensure & registration" if us_style else "Professional registration")
        for r in p.registrations:
            bits = [r.kind.capitalize(), r.number, r.status, str(r.year) if r.year else None, f"valid to {r.expires}" if r.expires else None]
            f.append(Paragraph(f"<b>{_esc(r.body)}</b>  <font color='#5f6368'>{_esc(' · '.join(b for b in bits if b))}</font>", S["body"]))

    rows = []
    for cat, label in SKILL_GROUPS:
        names = [s.name for s in p.skills if s.category == cat and s.proficiency in ("hands_on", "expert")]
        if names:
            rows.append([Paragraph(label, S["label"]), Paragraph(_esc(", ".join(names)), S["body"])])
    if rows:
        f += _heading("Clinical skills") + [_two_col(rows, 40 * mm)]

    f += _heading("Professional experience")
    for e in p.experience:
        kind = " (clinical internship)" if (e.employment_type or "").lower() == "internship" else ""
        where = f"{e.company}{', ' + e.location if e.location else ''}"
        line = Table([[Paragraph(f"{_esc(e.title)}{kind}", S["job"]), Paragraph(f"{_month(e.start)} – {_month(e.end)}", S["dates"])]],
                     colWidths=[None, 38 * mm])
        line.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                  ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 0), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
        block = [line, Paragraph(_esc(where), S["meta"])]
        bullets = [Paragraph(_esc(rewrites.get(b, b)), S["bullet"], bulletText="•") for b in e.bullets]
        f.append(KeepTogether(block + bullets[:1]))  # keep the role with its first bullet; long roles may flow
        f.extend(bullets[1:])

    if p.projects:
        f += _heading("Projects & research")
        for pr in p.projects:
            f.append(KeepTogether([Paragraph(f"<b>{_esc(pr.name)}</b>", S["body"]), Paragraph(_esc(pr.description), S["body"])]))

    if p.education:
        f += _heading("Education")
        for ed in p.education:
            years = " – ".join(str(y) for y in (ed.start_year, ed.end_year) if y)
            f.append(Paragraph(f"<b>{_esc(ed.degree)}{', ' + _esc(ed.field) if ed.field else ''}</b>  "
                               f"<font color='#5f6368'>{_esc(ed.institution)}{' · ' + years if years else ''}"
                               f"{' · ' + _esc(ed.grade) if ed.grade else ''}</font>", S["body"]))

    degrees = {ed.degree.lower() for ed in p.education}
    certs = [c for c in p.certifications if c.name.lower() not in degrees and c.status != "planned"]
    if certs or p.courses:
        f += _heading("Certifications & CPD")
        for c in certs:
            status = "" if c.status == "completed" else " (in progress)"
            f.append(Paragraph(f"{_esc(c.name)}{status}  <font color='#5f6368'>{_esc(' · '.join(x for x in (c.issuer, str(c.year) if c.year else None) if x))}</font>", S["body"]))
        for c in p.courses:
            f.append(Paragraph(f"{_esc(c.name)}  <font color='#5f6368'>{_esc(' · '.join(x for x in (c.provider, str(c.year) if c.year else None) if x))}</font>", S["body"]))

    if p.languages:
        f += _heading("Languages") + [Paragraph(_esc("  ·  ".join(f"{l.name} ({l.level})" for l in p.languages)), S["body"])]

    details = [(DETAIL_LABELS[k], getattr(pi, k)) for k in fmt["details"] if getattr(pi, k, None)]
    if details:
        title = "Personal details" if fmt["region"] == "gulf" else "Availability & right to work"
        f += _heading(title) + [_two_col([[Paragraph(k, S["label"]), Paragraph(_esc(v), S["body"])] for k, v in details], 40 * mm)]

    if fmt["references"]:
        f += _heading("References") + [Paragraph("Available on request.", S["body"])]

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(d.leftMargin, 8 * mm, f"{plain(pi.name)} · {fmt['document']}")
        canvas.drawRightString(d.pagesize[0] - d.rightMargin, 8 * mm, f"Page {d.page}")
        canvas.restoreState()

    doc.build(f, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
