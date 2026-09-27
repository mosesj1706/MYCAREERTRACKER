"""Country packs (OT): the licensing route per regulator, what each country expects of a CV, a cover
letter and an interview, and the candidate's progress through each route.

The pack data lives in packs/ot/countries.json. Her choices (countries, primary, routes per country)
live in DATA_DIR/countries.json; step progress lives in the licence_steps table.
"""
import json
import re
from datetime import datetime
from functools import lru_cache

import anthropic

from app.core import db, llm
from app.core.config import DATA_DIR, ROOT, load_prompt

PACK_FILE = ROOT / "packs" / "ot" / "countries.json"
SELECTION_FILE = DATA_DIR / "countries.json"
CHECKS_FILE = DATA_DIR / "country_checks.json"
STEP_STATUSES = ("todo", "in_progress", "done", "not_needed")

# Place names a job ad uses instead of the country
ALIASES = {
    "AE": ["uae", "u.a.e", "emirates", "dubai", "abu dhabi", "sharjah", "ajman", "al ain", "ras al khaimah", "fujairah", "umm al quwain"],
    "SA": ["ksa", "saudi", "riyadh", "jeddah", "dammam", "khobar", "mecca", "makkah", "medina", "madinah"],
    "QA": ["qatar", "doha"], "OM": ["oman", "muscat", "salalah"], "KW": ["kuwait"], "BH": ["bahrain", "manama"],
    "GB": ["uk", "united kingdom", "england", "scotland", "wales", "london", "nhs"], "IE": ["ireland", "dublin"],
    "AU": ["australia", "sydney", "melbourne", "brisbane", "perth"], "NZ": ["new zealand", "auckland"],
    "CA": ["canada", "toronto", "vancouver"], "US": ["usa", "united states", "u.s."], "SG": ["singapore"],
}


@lru_cache
def _raw() -> dict:
    return json.loads(PACK_FILE.read_text())


def _route(r: dict) -> dict:
    steps_src = _raw()["steps"]
    fill = {"portal": r.get("portal", "the regulator's portal"), "exam_name": r.get("exam_name", "licensing exam"),
            "exam_provider": r.get("exam_provider", "the exam provider")}
    steps = [{"id": sid, "title": steps_src[sid]["title"], "detail": steps_src[sid]["detail"].format(**fill),
              "docs": steps_src[sid]["docs"]} for sid in r.get("steps", [])]
    return {**r, "steps": steps}


@lru_cache
def all_countries() -> list[dict]:
    raw = _raw()
    out = []
    for c in raw["countries"]:
        region = raw["regions"].get(c.get("region"), {})
        merged = {**region, **{k: v for k, v in c.items() if k != "extra_job_sites"}}
        merged["job_sites"] = region.get("job_sites", []) + c.get("extra_job_sites", [])
        merged["routes"] = [_route(r) for r in c["routes"]]
        merged["verified"] = raw.get("verified")
        out.append(merged)
    return out


def country(code: str | None) -> dict | None:
    return next((c for c in all_countries() if c["code"] == code), None)


def exams() -> list[dict]:
    """Every occupational therapy licensing exam in the packs, with its format and blueprint topics."""
    return _raw()["exams"]


def exam(exam_id: str | None) -> dict | None:
    """An exam by id, or by the licence route it belongs to (older clients sent route ids)."""
    return next((e for e in exams() if exam_id in (e["id"], e.get("route"))), None) if exam_id else None


def no_exam_notes() -> list[dict]:
    """Countries that register OTs without a licensing exam, and what they do instead."""
    return _raw()["no_exam"]


def cv_format(code: str | None) -> dict:
    """CV conventions for a country: photo (expected / optional / avoid), which personal details
    belong on it, paper size, 'CV' or 'Resume', length, references line. The international standard
    (no photo, no personal details, A4) when no country is given."""
    standard = _raw()["cv_standard"]
    c = country(code)
    return {**standard, **((c or {}).get("cv_format") or {}), "code": c["code"] if c else None,
            "country": c["name"] if c else "International", "region": c["region"] if c else None}


def route(route_id: str) -> tuple[dict, dict]:
    """(country, route) for a route id, or KeyError."""
    for c in all_countries():
        for r in c["routes"]:
            if r["id"] == route_id:
                return c, r
    raise KeyError(route_id)


def match_country(*texts: str | None) -> str | None:
    """Country code from a job's country/location text, e.g. 'Dubai, UAE' -> 'AE'."""
    text = " ".join(t for t in texts if t).lower()
    if not text:
        return None
    for c in all_countries():
        if c["name"].lower() in text:
            return c["code"]
    for code, words in ALIASES.items():
        if any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) for w in words):
            return code
    return None


# ----------------------------------------------------------------------------- selection
def selection() -> dict:
    try:
        d = json.loads(SELECTION_FILE.read_text())
    except (FileNotFoundError, ValueError):
        d = {}
    return {"selected": d.get("selected", []), "primary": d.get("primary"), "routes": d.get("routes", {})}


def save_selection(selected: list[str], primary: str | None, routes: dict[str, list[str]]) -> dict:
    known = {c["code"]: {r["id"] for r in c["routes"]} for c in all_countries()}
    selected = [c for c in dict.fromkeys(selected) if c in known]
    primary = primary if primary in selected else (selected[0] if selected else None)
    # Each selected country tracks at least one route; the first is the default (e.g. DHA for the UAE).
    routes = {c: [r for r in routes.get(c, []) if r in known[c]] or [next(iter(_ids(c)))] for c in selected}
    SELECTION_FILE.write_text(json.dumps({"selected": selected, "primary": primary, "routes": routes}, indent=2))
    return selection()


def _ids(code: str) -> list[str]:
    return [r["id"] for r in country(code)["routes"]]


def tracked_routes() -> list[str]:
    s = selection()
    return [r for c in s["selected"] for r in s["routes"].get(c, [])]


# ----------------------------------------------------------------------------- licence progress
def progress() -> dict[str, dict[str, dict]]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM licence_steps").fetchall()
    out: dict[str, dict[str, dict]] = {}
    for r in rows:
        out.setdefault(r["route_id"], {})[r["step_id"]] = {k: r[k] for k in ("status", "date", "cost", "notes", "updated_at")}
    return out


def set_step(route_id: str, step_id: str, status: str, date: str | None, cost: str | None, notes: str) -> None:
    if status not in STEP_STATUSES:
        raise ValueError(f"status must be one of {', '.join(STEP_STATUSES)}")
    _, r = route(route_id)
    if step_id not in {s["id"] for s in r["steps"]}:
        raise KeyError(step_id)
    db.init()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO licence_steps (route_id, step_id, status, date, cost, notes) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(route_id, step_id) DO UPDATE SET status=excluded.status, date=excluded.date, cost=excluded.cost, "
            "notes=excluded.notes, updated_at=datetime('now','localtime')",
            (route_id, step_id, status, date or None, cost or None, notes or ""))


def route_summary(route_id: str, prog: dict | None = None) -> dict:
    """Done / total (steps marked not needed drop out) and the first step not yet done."""
    c, r = route(route_id)
    p = (prog if prog is not None else progress()).get(route_id, {})
    counted = [s for s in r["steps"] if p.get(s["id"], {}).get("status") != "not_needed"]
    done = [s for s in counted if p.get(s["id"], {}).get("status") == "done"]
    nxt = next((s for s in counted if p.get(s["id"], {}).get("status") != "done"), None)
    return {"route_id": route_id, "country": c["code"], "country_name": c["name"], "regulator": r["regulator"], "area": r.get("area"),
            "done": len(done), "total": len(counted), "next": nxt and {"id": nxt["id"], "title": nxt["title"],
                                                                      "status": p.get(nxt["id"], {}).get("status", "todo")}}


# ----------------------------------------------------------------------------- prompt context
def norms_block(code: str | None) -> str:
    """What the tailor, cover letter and interviewer need to know about a country, plus her real
    progress on its licence routes (so a licence-status line is never overstated)."""
    c = country(code)
    if not c:
        return ""
    s = selection()
    prog = progress()
    lines = [f'<country_norms country="{c["name"]}">', c["summary"]]
    if c.get("cv_norms"):
        lines += ["CV norms:"] + [f"- {x}" for x in c["cv_norms"]]
    if c.get("cover_letter_norms"):
        lines += ["Cover letter norms:"] + [f"- {x}" for x in c["cover_letter_norms"]]
    if c.get("interview_style"):
        lines += ["Interview style: " + c["interview_style"]]
    if c.get("language_test"):
        lines += ["Language test: " + c["language_test"]]
    for rid in s["routes"].get(c["code"], []) or [r["id"] for r in c["routes"][:1]]:
        _, r = route(rid)
        p = prog.get(rid, {})
        done = [st["title"] for st in r["steps"] if p.get(st["id"], {}).get("status") == "done"]
        doing = [st["title"] for st in r["steps"] if p.get(st["id"], {}).get("status") == "in_progress"]
        lines.append(f"Licence route {r['regulator']} ({r.get('area', '')}): exam {r.get('exam_name', 'n/a')} via {r.get('exam_provider', 'n/a')}. "
                     f"Candidate's progress - done: {', '.join(done) or 'nothing yet'}; in progress: {', '.join(doing) or 'nothing'}.")
        checked = last_check(rid)
        if checked and checked.get("summary"):
            # Figures (fees, timelines, pass marks) may only be quoted from here, never from memory.
            lines.append(f"Verified on {r['regulator']}'s own site ({checked['checked_at'][:10]}):\n{checked['summary'][:1800]}")
    lines.append("</country_norms>")
    return "\n".join(lines)


# ----------------------------------------------------------------------------- live check
def _load_checks() -> dict:
    try:
        return json.loads(CHECKS_FILE.read_text())
    except (FileNotFoundError, ValueError):
        return {}


def last_check(route_id: str) -> dict | None:
    return _load_checks().get(route_id)


def check(route_id: str) -> dict:
    """Search the regulator's own site(s) for the current route and summarise it with sources.
    Nothing in the pack changes; she reads it and updates her steps herself."""
    c, r = route(route_id)
    system = load_prompt("country_check").format(regulator=r["regulator_full"], country=c["name"],
                                                 domains=", ".join(r["check_domains"]), today=datetime.now().date().isoformat())
    tool = {"type": "web_search_20260209", "name": "web_search", "max_uses": 6, "allowed_domains": r["check_domains"]}
    ask = [{"role": "user", "content": f"Current licensing route for an Indian-trained occupational therapist (BOT) with {r['regulator_full']}, {c['name']}."}]
    try:
        response = llm.client().messages.create(model=llm.MODEL, max_tokens=6000, system=system, tools=[tool], messages=ask,
                                                output_config={"effort": "low"})
    except anthropic.BadRequestError:
        tool.pop("allowed_domains")  # older tool versions: fall back to the instruction in the prompt
        response = llm.client().messages.create(model=llm.MODEL, max_tokens=6000, system=system, tools=[tool], messages=ask,
                                                output_config={"effort": "low"})
    llm._record("country_check", response.usage)
    cited: dict[str, str] = {}
    found: dict[str, str] = {}
    for block in response.content:
        if block.type == "web_search_tool_result" and isinstance(block.content, list):
            for res in block.content:
                if getattr(res, "type", "") == "web_search_result":
                    found.setdefault(res.url, res.title)
        if block.type == "text":
            for cit in getattr(block, "citations", None) or []:
                if getattr(cit, "url", None):
                    cited.setdefault(cit.url, getattr(cit, "title", "") or cit.url)
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if "## " in text:
        text = text[text.index("## "):]  # drop "I have enough information..." style preambles
    sources = [{"url": u, "title": t} for u, t in (cited or found).items()]
    result = {"route_id": route_id, "checked_at": datetime.now().isoformat(timespec="minutes"), "summary": text, "sources": sources}
    checks = _load_checks()
    checks[route_id] = result
    CHECKS_FILE.write_text(json.dumps(checks, indent=2))
    return result
