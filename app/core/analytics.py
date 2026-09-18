"""Read-only aggregations for the dashboard. Everything comes from the SQLite db + learning plan."""
from dataclasses import dataclass

from app.core import db
from app.core.tracker import STATUSES

FUNNEL = ["saved", "applied", "screening", "interview", "offer"]


def _week(expr: str) -> str:
    # ISO week label from a 'YYYY-MM-DD HH:MM:SS' column: e.g. 2026-W38
    return f"strftime('%Y-W%W', {expr})"


def weekly_activity() -> list[dict]:
    """Rows of {week, activity, count} for the four things worth doing every week."""
    db.init()
    queries = {
        "JDs analyzed": f"SELECT {_week('created_at')} w, COUNT(*) n FROM applications GROUP BY w",
        "Applied": f"SELECT {_week('changed_at')} w, COUNT(*) n FROM status_history WHERE status='applied' GROUP BY w",
        "Mock interviews": f"SELECT {_week('created_at')} w, COUNT(*) n FROM interviews GROUP BY w",
        "MCQs answered": f"SELECT {_week('created_at')} w, COUNT(*) n FROM mcq_results GROUP BY w",
    }
    rows = []
    with db.connect() as conn:
        for activity, q in queries.items():
            for r in conn.execute(q):
                rows.append({"week": r["w"], "activity": activity, "count": r["n"]})
    return rows


def funnel() -> list[dict]:
    """How many applications ever reached each stage (an application counts at every stage it passed)."""
    db.init()
    with db.connect() as conn:
        total = conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"]
        reached = {r["status"]: r["n"] for r in conn.execute(
            "SELECT status, COUNT(DISTINCT application_id) n FROM status_history GROUP BY status")}
    out = []
    for stage in FUNNEL:
        n = total if stage == "saved" else reached.get(stage, 0)
        # offer implies interview implies screening implies applied
        later = FUNNEL[FUNNEL.index(stage) + 1:]
        n = max([n] + [reached.get(s, 0) for s in later])
        out.append({"stage": stage, "count": n})
    return out


@dataclass
class Kpis:
    tracked: int
    applied: int
    response_rate: float | None      # % of applied that reached screening or beyond
    avg_score_applied: float | None
    avg_score_rejected: float | None
    interviews: int
    mcq_accuracy: float | None
    mcq_answered: int


def kpis() -> Kpis:
    db.init()
    f = {r["stage"]: r["count"] for r in funnel()}
    with db.connect() as conn:
        applied_scores = conn.execute(
            "SELECT AVG(match_score) a FROM applications WHERE status IN ('applied','screening','interview','offer','rejected')").fetchone()["a"]
        rejected_scores = conn.execute("SELECT AVG(match_score) a FROM applications WHERE status='rejected'").fetchone()["a"]
        interviews = conn.execute("SELECT COUNT(*) n FROM interviews").fetchone()["n"]
        mcq = conn.execute("SELECT COUNT(*) n, AVG(correct) a FROM mcq_results").fetchone()
    return Kpis(
        tracked=f["saved"], applied=f["applied"],
        response_rate=round(100 * f["screening"] / f["applied"]) if f["applied"] else None,
        avg_score_applied=round(applied_scores) if applied_scores is not None else None,
        avg_score_rejected=round(rejected_scores) if rejected_scores is not None else None,
        interviews=interviews,
        mcq_accuracy=round(100 * mcq["a"]) if mcq["a"] is not None else None,
        mcq_answered=mcq["n"],
    )


def mcq_weekly_accuracy() -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT {_week('created_at')} w, COUNT(*) n, AVG(correct) a FROM mcq_results GROUP BY w ORDER BY w").fetchall()
    return [{"week": r["w"], "accuracy": round(100 * r["a"]), "answered": r["n"]} for r in rows]


def score_distribution() -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT title, company, status, match_score FROM applications ORDER BY match_score DESC").fetchall()
    return [{"application": f"{r['title']}" + (f" @ {r['company']}" if r["company"] else ""),
             "status": r["status"], "score": r["match_score"]} for r in rows]
