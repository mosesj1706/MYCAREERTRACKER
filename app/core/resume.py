"""Resume PDF generated from the profile, so it can never say more than the profile does.

build_pdf(profile) is the master resume. Pass an application's tailored output to get the
version for that job: its summary replaces the profile summary and each rewritten bullet
replaces the original it was derived from. Nothing else changes.
"""
from datetime import date
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.models import Profile, TailoredOutput
from connectors import github

INK = colors.HexColor("#111318")
MUTED = colors.HexColor("#5b6272")
RULE = colors.HexColor("#c9ced8")

S = {
    "name": ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=19, leading=22, textColor=INK, alignment=TA_CENTER),
    "headline": ParagraphStyle("headline", fontName="Helvetica", fontSize=10.5, leading=13, textColor=MUTED, alignment=TA_CENTER),
    "contact": ParagraphStyle("contact", fontName="Helvetica", fontSize=9, leading=12, textColor=MUTED, alignment=TA_CENTER),
    "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=INK, spaceBefore=7, spaceAfter=2),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=12.5, textColor=INK),
    "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=9.5, leading=12.5, textColor=INK, leftIndent=9, bulletIndent=0),
    "role": ParagraphStyle("role", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK, spaceBefore=4),
    "meta": ParagraphStyle("meta", fontName="Helvetica", fontSize=9, leading=12, textColor=MUTED),
    "skillcat": ParagraphStyle("skillcat", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=MUTED),
}

CATEGORY_LABEL = {"cloud": "Cloud", "data_engineering": "Data", "programming": "Programming", "devops": "DevOps",
                  "ml_ai": "ML / AI", "databases": "Databases", "tools": "Tools", "soft": "Other"}
CATEGORY_ORDER = ["cloud", "data_engineering", "programming", "ml_ai", "databases", "devops", "tools"]


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _month(ym: str | None) -> str:
    if not ym:
        return "Present"
    y, m = ym.split("-")
    return f"{date(int(y), int(m), 1):%b %Y}"


def _link(url: str, label: str | None = None) -> str:
    return f'<link href="{url}" color="#1f4fd8">{_esc(label or url.replace("https://", "").replace("http://", ""))}</link>'


def _rule():
    return HRFlowable(width="100%", thickness=0.6, color=RULE, spaceBefore=1, spaceAfter=3)


def build_pdf(profile: Profile, tailored: TailoredOutput | None = None, job_title: str | None = None) -> bytes:
    p = profile
    summary = tailored.summary if tailored else p.summary
    rewrites = {b.original: b.rewritten for b in tailored.bullets} if tailored else {}
    snap = github.load_snapshot()
    private_urls = {r.url.lower().rstrip("/") for r in snap.repos if r.private} if snap else set()

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=13 * mm, bottomMargin=13 * mm,
                            title=f"{p.personal_info.name} - Resume", author=p.personal_info.name)
    f = []

    # Header
    pi = p.personal_info
    f.append(Paragraph(_esc(pi.name), S["name"]))
    f.append(Paragraph(_esc(job_title or p.target.primary_role), S["headline"]))
    contact = [x for x in (pi.location, pi.email, pi.phone) if x]
    links = []
    if pi.linkedin:
        url = pi.linkedin if pi.linkedin.startswith("http") else "https://" + pi.linkedin
        links.append(_link(url, "LinkedIn"))
    if pi.github:
        links.append(_link(pi.github, "GitHub"))
    f.append(Paragraph("  ·  ".join([_esc(c) for c in contact] + links), S["contact"]))
    f.append(Spacer(1, 4))

    # Summary
    f += [Paragraph("SUMMARY", S["h"]), _rule(), Paragraph(_esc(summary), S["body"])]

    # Skills: hands-on only, grouped. 'familiar' skills are deliberately left off - the profile
    # is where those live; a resume line implies you can be interviewed on it.
    f += [Paragraph("SKILLS", S["h"]), _rule()]
    rows = []
    for cat in CATEGORY_ORDER:
        names = [s.name for s in p.skills if s.category == cat and s.proficiency in ("hands_on", "expert")]
        if names:
            rows.append([Paragraph(CATEGORY_LABEL[cat], S["skillcat"]), Paragraph(_esc(", ".join(names)), S["body"])])
    t = Table(rows, colWidths=[24 * mm, None])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    f.append(t)

    # Experience
    f += [Paragraph("EXPERIENCE", S["h"]), _rule()]
    for e in p.experience:
        block = [Paragraph(f"{_esc(e.title)} <font color='#5b6272'>· {_esc(e.company)}</font>", S["role"]),
                 Paragraph(f"{_month(e.start)} – {_month(e.end)}{' · ' + _esc(e.location) if e.location else ''}", S["meta"])]
        bullets = [Paragraph(_esc(rewrites.get(b, b)), S["bullet"], bulletText="•") for b in e.bullets]
        # Keep the heading with its first bullet only, so a long role can flow across pages.
        f.append(KeepTogether(block + bullets[:1]))
        f.extend(bullets[1:])

    # Projects
    if p.projects:
        f += [Paragraph("PROJECTS", S["h"]), _rule()]
        for pr in p.projects:
            if pr.url and pr.url.lower().rstrip("/") in private_urls:
                title = _esc(pr.name) + "  <font size=8.5 color='#5b6272'>(private repo - available on request)</font>"
            else:
                title = _esc(pr.name) + (f"  <font size=8.5>{_link(pr.url)}</font>" if pr.url else "")
            block = [Paragraph(title, S["role"]), Paragraph(_esc(pr.description), S["body"])]
            if pr.technologies:
                block.append(Paragraph(f"<font color='#5b6272'>{_esc(', '.join(pr.technologies))}</font>", S["meta"]))
            f.append(KeepTogether(block))

    # Education & certifications
    f += [Paragraph("EDUCATION & CERTIFICATIONS", S["h"]), _rule()]
    for ed in p.education:
        years = " – ".join(str(y) for y in (ed.start_year, ed.end_year) if y)
        f.append(Paragraph(f"<b>{_esc(ed.degree)}{', ' + _esc(ed.field) if ed.field else ''}</b> · {_esc(ed.institution)}"
                           f"{' · ' + years if years else ''}{' · ' + _esc(ed.grade) if ed.grade else ''}", S["body"]))
    degrees = {ed.degree.lower() for ed in p.education}
    for c in p.certifications:
        if c.name.lower() in degrees:
            continue
        status = "" if c.status == "completed" else f" ({c.status.replace('_', ' ')})"
        f.append(Paragraph(f"{_esc(c.name)}{' · ' + _esc(c.issuer) if c.issuer else ''}{' · ' + str(c.year) if c.year else ''}{status}", S["body"]))

    doc.build(f)
    return buf.getvalue()
