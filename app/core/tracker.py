"""Application pipeline + cross-JD gap analysis."""
from collections import defaultdict
from dataclasses import dataclass

from app.core import db
from app.core.models import JobAnalysis, MatchResult, TailoredOutput

STATUSES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"]
ACTIVE = {"saved", "applied", "screening", "interview", "offer"}

# How far an application got, used to weight gap analysis: a gap in a JD where you reached
# interview stage matters more than one where you never applied.
STAGE_WEIGHT = {"saved": 1.0, "applied": 1.5, "screening": 2.0, "interview": 2.5, "offer": 2.5,
                "rejected": 2.0, "withdrawn": 1.0}


@dataclass
class Application:
    id: int
    company: str | None
    title: str
    url: str | None
    status: str
    match_score: float | None
    notes: str
    created_at: str
    updated_at: str
    applied_at: str | None
    jd_text: str
    job: JobAnalysis
    match: MatchResult
    tailored: TailoredOutput | None

    @classmethod
    def from_row(cls, r) -> "Application":
        return cls(
            id=r["id"], company=r["company"], title=r["title"], url=r["url"], status=r["status"],
            match_score=r["match_score"], notes=r["notes"] or "", created_at=r["created_at"],
            updated_at=r["updated_at"], applied_at=r["applied_at"], jd_text=r["jd_text"],
            job=JobAnalysis.model_validate_json(r["job_json"]),
            match=MatchResult.model_validate_json(r["match_json"]),
            tailored=TailoredOutput.model_validate_json(r["tailored_json"]) if r["tailored_json"] else None,
        )


def add(job: JobAnalysis, match: MatchResult, jd_text: str, url: str | None = None,
        tailored: TailoredOutput | None = None, company: str | None = None, title: str | None = None) -> int:
    db.init()
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO applications (company, title, url, jd_text, match_score, job_json, match_json, tailored_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (company or job.company, title or job.title, url, jd_text, match.score(),
             job.model_dump_json(), match.model_dump_json(), tailored.model_dump_json() if tailored else None),
        )
        conn.execute("INSERT INTO status_history (application_id, status) VALUES (?, 'saved')", (cur.lastrowid,))
        return cur.lastrowid


def save_tailored(app_id: int, tailored: TailoredOutput) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE applications SET tailored_json=?, updated_at=datetime('now','localtime') WHERE id=?",
                     (tailored.model_dump_json(), app_id))


def set_status(app_id: int, status: str) -> None:
    assert status in STATUSES, status
    with db.connect() as conn:
        row = conn.execute("SELECT status FROM applications WHERE id=?", (app_id,)).fetchone()
        if row and row["status"] == status:
            return
        conn.execute(
            "UPDATE applications SET status=?, updated_at=datetime('now','localtime'), "
            "applied_at=CASE WHEN ?='applied' AND applied_at IS NULL THEN datetime('now','localtime') ELSE applied_at END "
            "WHERE id=?", (status, status, app_id))
        conn.execute("INSERT INTO status_history (application_id, status) VALUES (?, ?)", (app_id, status))


def update(app_id: int, **fields) -> None:
    allowed = {"company", "title", "url", "notes"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return
    sets = ", ".join(f"{k}=?" for k in fields)
    with db.connect() as conn:
        conn.execute(f"UPDATE applications SET {sets}, updated_at=datetime('now','localtime') WHERE id=?",
                     (*fields.values(), app_id))


def delete(app_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM applications WHERE id=?", (app_id,))


def get(app_id: int) -> Application | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    return Application.from_row(row) if row else None


def list_all(status: str | None = None) -> list[Application]:
    db.init()
    q = "SELECT * FROM applications" + (" WHERE status=?" if status else "") + " ORDER BY updated_at DESC"
    with db.connect() as conn:
        rows = conn.execute(q, (status,) if status else ()).fetchall()
    return [Application.from_row(r) for r in rows]


def counts_by_status() -> dict[str, int]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT status, COUNT(*) n FROM applications GROUP BY status").fetchall()
    out = {s: 0 for s in STATUSES}
    out.update({r["status"]: r["n"] for r in rows})
    return out


# ---------------------------------------------------------------------------
# Aggregate gap analysis across every JD ever analyzed
# ---------------------------------------------------------------------------

@dataclass
class SkillDemand:
    skill: str
    jobs: int            # how many JDs asked for it
    must_have: int       # in how many it was a must-have
    strong: int
    partial: int
    none: int
    pressure: float      # weighted "how much this gap is costing you"; 0 = fully covered

    @property
    def coverage(self) -> float:
        return round(100 * (self.strong + 0.5 * self.partial) / self.jobs, 0) if self.jobs else 0.0


def aggregate_gaps(min_jobs: int = 1) -> list[SkillDemand]:
    apps = list_all()
    acc: dict[str, dict] = defaultdict(lambda: {"jobs": 0, "must_have": 0, "strong": 0, "partial": 0, "none": 0, "pressure": 0.0})
    for a in apps:
        w_stage = STAGE_WEIGHT.get(a.status, 1.0)
        for m in a.match.matches:
            d = acc[m.skill]
            d["jobs"] += 1
            d["must_have"] += m.importance == "must_have"
            d[m.strength] += 1
            d["pressure"] += w_stage * MatchResult.WEIGHTS[m.importance] * (1 - MatchResult.STRENGTH[m.strength])
    out = [SkillDemand(skill=k, **v) for k, v in acc.items() if v["jobs"] >= min_jobs]
    return sorted(out, key=lambda s: (-s.pressure, -s.jobs, s.skill))


def rescore(app_id: int, profile) -> float:
    """Re-run the fit assessment against the current profile (after skills were learned)."""
    from app.core.matcher import match  # local import: matcher imports models only, avoids cycles at import time
    a = get(app_id)
    result = match(profile, a.job)
    with db.connect() as conn:
        conn.execute("UPDATE applications SET match_json=?, match_score=?, updated_at=datetime('now','localtime') WHERE id=?",
                     (result.model_dump_json(), result.score(), app_id))
    return result.score()
