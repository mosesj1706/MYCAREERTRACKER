"""CPD log (courses, supervision, reading, with hours) and case studies: a de-identified case turned
into a STAR interview story, a resume line and the questions a panel will ask about it."""
import json
from collections import defaultdict

from app.core import db, llm
from app.core.config import load_prompt
from app.core.models import CaseStory, Profile
from app.core.text import plain_model

CPD_KINDS = ["course", "workshop", "conference", "supervision", "reading", "case_review", "teaching", "other"]
CASE_FIELDS = ["client_group", "setting", "age_band", "presentation", "assessments", "goals", "interventions", "outcomes", "role", "reflection"]


# ----------------------------------------------------------------------------- CPD
def list_cpd() -> list[dict]:
    db.init()
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM cpd_entries ORDER BY date DESC, id DESC").fetchall()]


def add_cpd(date: str, kind: str, title: str, provider: str, hours: float, reflection: str) -> dict:
    if kind not in CPD_KINDS:
        raise ValueError(f"kind must be one of {', '.join(CPD_KINDS)}")
    db.init()
    with db.connect() as conn:
        cur = conn.execute("INSERT INTO cpd_entries (date, kind, title, provider, hours, reflection) VALUES (?,?,?,?,?,?)",
                           (date, kind, title.strip(), provider.strip(), max(0.0, hours), reflection.strip()))
        return dict(conn.execute("SELECT * FROM cpd_entries WHERE id=?", (cur.lastrowid,)).fetchone())


def update_cpd(entry_id: int, **fields) -> None:
    allowed = {"date", "kind", "title", "provider", "hours", "reflection"}
    fields = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if fields.get("kind") and fields["kind"] not in CPD_KINDS:
        raise ValueError(f"kind must be one of {', '.join(CPD_KINDS)}")
    if fields:
        with db.connect() as conn:
            conn.execute(f"UPDATE cpd_entries SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", (*fields.values(), entry_id))


def delete_cpd(entry_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM cpd_entries WHERE id=?", (entry_id,))


def cpd_summary() -> dict:
    by_year: dict[str, float] = defaultdict(float)
    by_kind: dict[str, float] = defaultdict(float)
    for e in list_cpd():
        by_year[e["date"][:4]] += e["hours"]
        by_kind[e["kind"]] += e["hours"]
    return {"total_hours": round(sum(by_kind.values()), 1),
            "by_year": [{"year": y, "hours": round(h, 1)} for y, h in sorted(by_year.items(), reverse=True)],
            "by_kind": [{"kind": k, "hours": round(h, 1)} for k, h in sorted(by_kind.items(), key=lambda x: -x[1])]}


# ----------------------------------------------------------------------------- case studies
def _case(r) -> dict:
    return {"id": r["id"], "title": r["title"], "input": json.loads(r["input_json"]),
            "story": json.loads(r["story_json"]) if r["story_json"] else None,
            "created_at": r["created_at"], "updated_at": r["updated_at"]}


def list_cases() -> list[dict]:
    db.init()
    with db.connect() as conn:
        return [_case(r) for r in conn.execute("SELECT * FROM case_studies ORDER BY updated_at DESC").fetchall()]


def get_case(case_id: int) -> dict | None:
    db.init()
    with db.connect() as conn:
        r = conn.execute("SELECT * FROM case_studies WHERE id=?", (case_id,)).fetchone()
    return _case(r) if r else None


def save_case(title: str, fields: dict, case_id: int | None = None) -> dict:
    data = {k: str(fields.get(k, "")).strip() for k in CASE_FIELDS}
    db.init()
    with db.connect() as conn:
        if case_id:
            # Editing the case makes the old story stale; it is rebuilt on request.
            conn.execute("UPDATE case_studies SET title=?, input_json=?, story_json=NULL, updated_at=datetime('now','localtime') WHERE id=?",
                         (title.strip(), json.dumps(data), case_id))
        else:
            case_id = conn.execute("INSERT INTO case_studies (title, input_json) VALUES (?, ?)", (title.strip(), json.dumps(data))).lastrowid
    return get_case(case_id)


def delete_case(case_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM case_studies WHERE id=?", (case_id,))


def build_story(case_id: int, profile: Profile | None) -> dict:
    c = get_case(case_id)
    if c is None:
        raise KeyError(case_id)
    role = profile.target.primary_role if profile else "Occupational Therapist"
    system = load_prompt("case_story").format(target_role=role)
    case = "\n".join(f"{k.replace('_', ' ')}: {v}" for k, v in c["input"].items() if v)
    story = plain_model(llm.extract(CaseStory, user=f"<case title=\"{c['title']}\">\n{case}\n</case>", system=system,
                                    effort="medium", feature="case_story"))
    with db.connect() as conn:
        conn.execute("UPDATE case_studies SET story_json=?, updated_at=datetime('now','localtime') WHERE id=?",
                     (story.model_dump_json(), case_id))
    return get_case(case_id)


def case_context(case_id: int) -> str:
    """The case and its story, for the Case defence interview."""
    c = get_case(case_id)
    if c is None:
        raise ValueError("No such case study.")
    body = "\n".join(f"{k.replace('_', ' ')}: {v}" for k, v in c["input"].items() if v)
    story = json.dumps(c["story"], indent=1) if c["story"] else "(no story built yet)"
    return f"<case_study title=\"{c['title']}\">\n{body}\n\nSTAR story:\n{story}\n</case_study>"
