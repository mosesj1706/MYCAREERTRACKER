"""Mock interviews (multi-turn, streamed) and gap-driven MCQ practice."""
import json
from typing import Iterator

from app.core import db, llm
from app.core.config import load_prompt
from app.core.models import MCQ, MCQSet, Profile
from app.core.tracker import Application
from connectors import github


class InterviewSession:
    """Holds the conversation. The big, stable context (persona + profile + job) goes in the
    system prompt with a cache breakpoint so every turn after the first is mostly cache reads."""

    def __init__(self, profile: Profile, mode: str = "mixed", application: Application | None = None,
                 project: str | None = None):
        self.profile = profile
        self.mode = mode
        self.application = application
        self.project = project
        self.messages: list[dict] = []

        context = f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>"
        if project:
            context += "\n\n" + project_context(profile, project)
        if application:
            context += (
                f"\n\n<job company={application.company!r}>\n{application.jd_text}\n</job>"
                f"\n\n<fit_assessment score={application.match.score()}>\n"
                f"{application.match.model_dump_json(indent=1)}\n</fit_assessment>"
            )
        self.system = [
            {"type": "text", "text": load_prompt("persona_recruiter").format(mode=mode)},
            {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}},
        ]

    def start(self) -> Iterator[str]:
        return self._send("Begin the interview.")

    def answer(self, text: str) -> Iterator[str]:
        return self._send(text)

    def _send(self, user_text: str) -> Iterator[str]:
        self.messages.append({"role": "user", "content": user_text})
        chunks: list[str] = []
        for chunk in llm.stream(self.messages, system=self.system, effort="medium"):
            chunks.append(chunk)
            yield chunk
        self.messages.append({"role": "assistant", "content": "".join(chunks)})

    @property
    def turns(self) -> int:
        return sum(1 for m in self.messages if m["role"] == "user") - 1  # minus the kickoff

    def save(self, summary: str | None = None) -> int:
        db.init()
        with db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO interviews (application_id, kind, transcript_json, summary) VALUES (?, 'mock', ?, ?)",
                (self.application.id if self.application else None, json.dumps(self.messages), summary),
            )
            return cur.lastrowid


def list_sessions() -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT i.id, i.created_at, i.summary, i.transcript_json, a.title, a.company "
            "FROM interviews i LEFT JOIN applications a ON a.id = i.application_id ORDER BY i.id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# MCQs
# ---------------------------------------------------------------------------

def generate_mcqs(topics: list[str], n: int, target_role: str) -> list[MCQ]:
    system = load_prompt("mcq_generator").format(target_role=target_role, n=n, topics=", ".join(topics))
    return llm.extract(MCQSet, user="Generate the questions now.", system=system, effort="medium").questions


def record_mcq(q: MCQ, correct: bool) -> None:
    db.init()
    with db.connect() as conn:
        conn.execute("INSERT INTO mcq_results (topic, difficulty, correct, question) VALUES (?, ?, ?, ?)",
                     (q.topic, q.difficulty, int(correct), q.question))


def mcq_stats() -> list[dict]:
    """Per-topic accuracy, weakest first."""
    db.init()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT topic, COUNT(*) n, SUM(correct) n_right FROM mcq_results GROUP BY topic"
        ).fetchall()
    out = [{"topic": r["topic"], "answered": r["n"], "accuracy": round(100 * r["n_right"] / r["n"])} for r in rows]
    return sorted(out, key=lambda d: (d["accuracy"], -d["answered"]))


def project_context(profile: Profile, name: str) -> str:
    """The profile's project entry plus, when its URL matches a synced GitHub repo, that repo's
    README, file tree and infra files - so a deep-dive asks about the real implementation."""
    proj = next((p for p in profile.projects if p.name == name), None)
    if proj is None:
        raise ValueError(f"No project named {name!r} on the profile.")
    out = f"<project>\n{proj.model_dump_json(indent=1)}\n</project>"
    snap = github.load_snapshot()
    if snap and proj.url:
        repo = next((r for r in snap.repos if r.url.lower().rstrip("/") == proj.url.lower().rstrip("/")), None)
        if repo:
            out += f"\n\n<repository>\n{repo.digest()}\n</repository>"
    return out
