"""HTTP API over app/core + static hosting for the built frontend.

    uvicorn app.server:app --port 8765
"""
import json
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.core import analytics, interview, profile as profile_store, tracker
from app.core.config import DATA_DIR, ROOT
from app.core.matcher import analyze_jd, match, tailor
from app.core.models import JobAnalysis, LearningPlan, MatchResult, MCQ, Profile, TailoredOutput
from connectors import github
from learning_engine import planner

app = FastAPI(title="MYCAREERTRACKER API")
STATIC = ROOT / "frontend" / "dist"


def _profile() -> Profile:
    if not profile_store.exists():
        raise HTTPException(404, "No profile yet - build one from a resume first.")
    return profile_store.load()


def _app_dict(a: tracker.Application) -> dict:
    d = asdict(a)
    d["job"] = a.job.model_dump()
    d["match"] = a.match.model_dump() | {"score": a.match.score()}
    d["tailored"] = a.tailored.model_dump() if a.tailored else None
    return d


# ----------------------------------------------------------------------------- profile
@app.get("/api/profile")
def get_profile():
    if not profile_store.exists():
        return None
    p = profile_store.load()
    return p.model_dump() | {
        "years": p.total_experience_years(),
        "hands_on": len(p.skills_by_proficiency("hands_on", "expert")),
        "learning": len(p.skills_by_proficiency("learning")),
    }


@app.put("/api/profile")
def put_profile(body: Profile):
    profile_store.save(body)
    return get_profile()


@app.post("/api/profile/build")
async def build_profile(target_role: str, file: UploadFile | None = None):
    if file is not None:
        pdf = DATA_DIR / "resume.pdf"
        pdf.write_bytes(await file.read())
        p = profile_store.build_from_pdf(pdf, target_role)
    elif (DATA_DIR / "resume.txt").exists():
        p = profile_store.build_from_text((DATA_DIR / "resume.txt").read_text(), target_role)
    else:
        raise HTTPException(400, "Upload a resume PDF.")
    profile_store.save(p)
    return get_profile()


# ----------------------------------------------------------------------------- github
def _github_dict(snap: github.GitHubSnapshot | None) -> dict | None:
    if snap is None:
        return None
    return snap.model_dump(exclude={"repos"}) | {
        "repos": [r.model_dump(exclude={"readme"}) | {"has_code": r.has_code} for r in snap.repos],
    }


@app.get("/api/github")
def github_status():
    snap = github.load_snapshot()
    username = snap.username if snap else (github.username_from_url(profile_store.load().personal_info.github) if profile_store.exists() else None)
    return {"username": username, "snapshot": _github_dict(snap)}


class GitHubSync(BaseModel):
    username: str


@app.post("/api/github/sync")
def github_sync(body: GitHubSync):
    """Fetch repos, ask the model what they prove, apply the evidence to the profile."""
    p = _profile()
    try:
        snap = github.fetch(body.username.strip())
    except github.GitHubError as e:
        raise HTTPException(429 if "rate limit" in str(e) else 400, str(e))
    before = {s.name: s.proficiency for s in p.skills}
    merge = profile_store.propose_github_merge(p, snap)
    p = profile_store.apply_github_merge(p, merge, snap)
    profile_store.save(p)
    snap.notes = merge.notes
    snap.merged_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    snap.save()
    changes = [{"skill": s.name, "from": before.get(s.name), "to": s.proficiency}
               for s in p.skills if before.get(s.name) != s.proficiency]
    return {"snapshot": _github_dict(snap), "changes": changes, "profile": get_profile()}


# ----------------------------------------------------------------------------- matching
class JDIn(BaseModel):
    jd_text: str


@app.post("/api/jd/analyze")
def jd_analyze(body: JDIn):
    p = _profile()
    job = analyze_jd(body.jd_text, p.target.primary_role)
    result = match(p, job)
    return {"job": job.model_dump(), "match": result.model_dump() | {"score": result.score()}}


class TailorIn(BaseModel):
    jd_text: str
    job: JobAnalysis
    match: MatchResult
    app_id: int | None = None


@app.post("/api/jd/tailor")
def jd_tailor(body: TailorIn):
    out = tailor(_profile(), body.job, body.match, body.jd_text)
    if body.app_id:
        tracker.save_tailored(body.app_id, out)
    return out.model_dump()


# ----------------------------------------------------------------------------- applications
class TrackIn(BaseModel):
    jd_text: str
    job: JobAnalysis
    match: MatchResult
    url: str | None = None
    company: str | None = None
    tailored: TailoredOutput | None = None


@app.get("/api/applications")
def list_applications():
    return {"items": [_app_dict(a) for a in tracker.list_all()], "counts": tracker.counts_by_status(),
            "statuses": tracker.STATUSES}


@app.post("/api/applications")
def track(body: TrackIn):
    i = tracker.add(body.job, body.match, body.jd_text, url=body.url, company=body.company, tailored=body.tailored)
    return _app_dict(tracker.get(i))


@app.get("/api/applications/{app_id}")
def get_application(app_id: int):
    return _app_dict(tracker.get(app_id))


class AppPatch(BaseModel):
    status: str | None = None
    company: str | None = None
    title: str | None = None
    url: str | None = None
    notes: str | None = None


@app.patch("/api/applications/{app_id}")
def patch_application(app_id: int, body: AppPatch):
    if body.status:
        tracker.set_status(app_id, body.status)
    fields = {k: v for k, v in body.model_dump().items() if k != "status" and v is not None}
    if fields:
        tracker.update(app_id, **fields)
    return _app_dict(tracker.get(app_id))


@app.delete("/api/applications/{app_id}")
def delete_application(app_id: int):
    tracker.delete(app_id)
    return {"ok": True}


@app.post("/api/applications/{app_id}/rescore")
def rescore(app_id: int):
    tracker.rescore(app_id, _profile())
    return _app_dict(tracker.get(app_id))


@app.get("/api/gaps")
def gaps(min_jobs: int = 1):
    return [asdict(g) | {"coverage": g.coverage} for g in tracker.aggregate_gaps(min_jobs)]


# ----------------------------------------------------------------------------- interview
SESSIONS: dict[str, interview.InterviewSession] = {}


class InterviewStart(BaseModel):
    app_id: int | None = None
    mode: str = "mixed"


@app.post("/api/interview")
def interview_start(body: InterviewStart):
    sess = interview.InterviewSession(_profile(), mode=body.mode,
                                      application=tracker.get(body.app_id) if body.app_id else None)
    sid = uuid.uuid4().hex
    SESSIONS[sid] = sess
    return {"session_id": sid}


class MessageIn(BaseModel):
    text: str | None = None  # None = kick off


@app.post("/api/interview/{sid}/message")
def interview_message(sid: str, body: MessageIn):
    sess = SESSIONS.get(sid)
    if not sess:
        raise HTTPException(404, "session expired")
    gen = sess.start() if body.text is None else sess.answer(body.text)

    def events():
        for chunk in gen:
            yield f"data: {json.dumps(chunk)}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/interview/{sid}/save")
def interview_save(sid: str):
    sess = SESSIONS.pop(sid, None)
    if not sess:
        raise HTTPException(404, "session expired")
    last = sess.messages[-1]["content"] if sess.messages and sess.messages[-1]["role"] == "assistant" else None
    return {"id": sess.save(summary=last)}


@app.delete("/api/interview/{sid}")
def interview_discard(sid: str):
    SESSIONS.pop(sid, None)
    return {"ok": True}


@app.get("/api/interviews")
def interviews():
    out = []
    for s in interview.list_sessions():
        s["transcript"] = json.loads(s.pop("transcript_json"))[1:]
        out.append(s)
    return out


class MCQGen(BaseModel):
    topics: list[str]
    n: int = 5


@app.post("/api/mcq/generate")
def mcq_generate(body: MCQGen):
    return [q.model_dump() for q in interview.generate_mcqs(body.topics, body.n, _profile().target.primary_role)]


class MCQRecord(BaseModel):
    question: MCQ
    correct: bool


@app.post("/api/mcq/record")
def mcq_record(body: MCQRecord):
    interview.record_mcq(body.question, body.correct)
    return {"ok": True}


@app.get("/api/mcq/stats")
def mcq_stats():
    return interview.mcq_stats()


# ----------------------------------------------------------------------------- learning
@app.get("/api/plan")
def get_plan():
    plan = planner.load_plan()
    return _plan_dict(plan) if plan else None


def _plan_dict(plan: LearningPlan) -> dict:
    d = plan.model_dump()
    for s, sd in zip(plan.skills, d["skills"]):
        sd["hours"] = s.hours
        sd["progress"] = s.progress
    return d


class PlanGen(BaseModel):
    weekly_hours: int = 10
    top_n: int = 6


@app.post("/api/plan/generate")
def plan_generate(body: PlanGen):
    n_apps = len(tracker.list_all())
    plan = planner.generate_plan(_profile(), tracker.aggregate_gaps(min_jobs=min(2, max(1, n_apps))), body.weekly_hours, body.top_n)
    planner.save_plan(plan)
    return _plan_dict(plan)


@app.put("/api/plan")
def plan_put(body: LearningPlan):
    planner.save_plan(body)
    return _plan_dict(body)


class SkillIn(BaseModel):
    skill: str


@app.post("/api/plan/resources")
def plan_resources(body: SkillIn):
    return [r.model_dump() for r in planner.find_resources(body.skill, _profile())]


class LearnedIn(BaseModel):
    skill: str
    evidence: str


@app.post("/api/plan/learned")
def plan_learned(body: LearnedIn):
    p = planner.mark_learned(_profile(), body.skill, body.evidence)
    profile_store.save(p)
    plan = planner.load_plan()
    if plan:
        for s in plan.skills:
            if s.skill.lower() == body.skill.lower():
                for st in s.steps:
                    st.done = True
        planner.save_plan(plan)
    return get_profile()


# ----------------------------------------------------------------------------- analytics
@app.get("/api/analytics")
def get_analytics():
    return {
        "kpis": asdict(analytics.kpis()),
        "weekly": analytics.weekly_activity(),
        "funnel": analytics.funnel(),
        "scores": analytics.score_distribution(),
        "mcq_trend": analytics.mcq_weekly_accuracy(),
    }


# ----------------------------------------------------------------------------- frontend
if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        target = STATIC / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(STATIC / "index.html")
