"""Mock interviews (multi-turn, streamed) and gap-driven MCQ practice."""
import json
import re
from typing import Iterator

from app.core import countries, cpd, db, llm
from app.core.config import load_prompt
from app.core.models import MCQ, MCQSet, Profile
from app.core.tracker import Application
from connectors import github


class InterviewSession:
    """Holds the conversation. The big, stable context (persona + profile + job) goes in the
    system prompt with a cache breakpoint so every turn after the first is mostly cache reads."""

    def __init__(self, profile: Profile, mode: str = "mixed", application: Application | None = None,
                 project: str | None = None, country: str | None = None, case_id: int | None = None):
        self.profile = profile
        self.mode = mode
        self.application = application
        self.project = project
        self.messages: list[dict] = []
        self.params = {"app_id": application.id if application else None, "mode": mode, "project": project, "country": country, "case_id": case_id}
        self.row_id: int | None = None  # its interviews row, written after every reply

        context = f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>"
        if project:
            context += "\n\n" + project_context(profile, project)
        if case_id:
            context += "\n\n" + cpd.case_context(case_id)
        # Country style (OT): who interviews, what they ask, and her real licence progress.
        code = country or (application.country if application else None)
        norms = countries.norms_block(code) if code else ""
        if norms:
            context += "\n\n" + norms
        if application:
            context += (
                f"\n\n<job company={application.company!r}>\n{application.jd_text}\n</job>"
                f"\n\n<fit_assessment score={application.match.score()}>\n"
                f"{application.match.model_dump_json(indent=1)}\n</fit_assessment>"
            )
        self.system = [
            {"type": "text", "text": load_prompt("persona_recruiter").format(mode=mode, country=(countries.country(code) or {}).get("name", "the candidate's target country"))},
            {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}},
        ]

    def start(self) -> Iterator[str]:
        return self._send("Begin the interview.")

    def answer(self, text: str) -> Iterator[str]:
        return self._send(text)

    def _send(self, user_text: str) -> Iterator[str]:
        self.messages.append({"role": "user", "content": user_text})
        chunks: list[str] = []
        for chunk in llm.stream(self.messages, system=self.system, effort="low", feature="interview"):
            chunks.append(chunk)
            yield chunk
        self.messages.append({"role": "assistant", "content": "".join(chunks)})
        self._persist(ended=user_text.strip().lower() == "end")

    def _persist(self, ended: bool = False) -> None:
        """Keep the conversation in the database after every reply, so an interview she leaves can be resumed.
        The "end" report closes it, with the score from its first line."""
        db.init()
        with db.connect() as conn:
            if self.row_id is None:
                self.row_id = conn.execute(
                    "INSERT INTO interviews (application_id, kind, transcript_json, params_json, finished) VALUES (?, 'mock', ?, ?, 0)",
                    (self.params["app_id"], json.dumps(self.messages), json.dumps(self.params))).lastrowid
            else:
                conn.execute("UPDATE interviews SET transcript_json=? WHERE id=?", (json.dumps(self.messages), self.row_id))
            if ended:
                report = self.messages[-1]["content"]
                conn.execute("UPDATE interviews SET summary=?, score=?, finished=1 WHERE id=?", (report, report_score(report), self.row_id))

    @property
    def turns(self) -> int:
        return sum(1 for m in self.messages if m["role"] == "user") - 1  # minus the kickoff

    def save(self, summary: str | None = None) -> int:
        db.init()
        with db.connect() as conn:
            if self.row_id is None:
                self.row_id = conn.execute(
                    "INSERT INTO interviews (application_id, kind, transcript_json, summary, params_json, score) VALUES (?, 'mock', ?, ?, ?, ?)",
                    (self.params["app_id"], json.dumps(self.messages), summary, json.dumps(self.params), report_score(summary or ""))).lastrowid
            else:  # an ended interview keeps its report as the summary
                conn.execute("UPDATE interviews SET transcript_json=?, summary=COALESCE(summary, ?), finished=1 WHERE id=?",
                             (json.dumps(self.messages), summary, self.row_id))
            return self.row_id

    def discard(self) -> None:
        """Drop an interview she abandons part-way; one with an end report is kept."""
        if self.row_id is not None:
            with db.connect() as conn:
                conn.execute("DELETE FROM interviews WHERE id=? AND finished=0", (self.row_id,))


def report_score(report: str) -> int | None:
    """The 'Score: N/10' line of an end report, or None."""
    m = re.search(r"Score:\W*(\d{1,2})\s*/\s*10", report or "", re.I)
    return min(10, int(m.group(1))) if m else None


def unfinished() -> dict | None:
    """The latest interview she left part-way through (after at least one answer), to offer resuming it."""
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT id, created_at, transcript_json, params_json FROM interviews "
                            "WHERE kind='mock' AND finished=0 AND params_json IS NOT NULL ORDER BY id DESC").fetchall()
    for r in rows:
        answers = sum(1 for m in json.loads(r["transcript_json"]) if m["role"] == "user") - 1
        if answers >= 1:
            return {"id": r["id"], "created_at": r["created_at"], "answers": answers, "params": json.loads(r["params_json"])}
    return None


def unfinished_row(row_id: int) -> dict | None:
    db.init()
    with db.connect() as conn:
        r = conn.execute("SELECT * FROM interviews WHERE id=? AND finished=0 AND params_json IS NOT NULL", (row_id,)).fetchone()
    return dict(r) if r else None


def delete_unfinished(row_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM interviews WHERE id=? AND finished=0", (row_id,))


def list_sessions() -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT i.id, i.created_at, i.summary, i.transcript_json, a.title, a.company "
            "FROM interviews i LEFT JOIN applications a ON a.id = i.application_id WHERE i.finished=1 ORDER BY i.id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# MCQs
# ---------------------------------------------------------------------------

def exam_style(exam: dict, topics: list[str]) -> str:
    style = f"Exam: {exam['name']} ({exam['provider']}), {exam['regulator']}. Style: {exam['style']} Format: {'; '.join(exam['format'])}."
    weights = dict(zip(exam.get("topics", []), exam.get("weights", [])))
    chosen = {t: weights[t] for t in topics if t in weights}
    if len(chosen) > 1:
        style += " Spread the questions across the topics roughly in these proportions: " + ", ".join(f"{t} {w}%" for t, w in chosen.items()) + "."
    return style


def generate_mcqs(topics: list[str], n: int, target_role: str, exam: dict | None = None,
                  concepts: list[str] | None = None) -> list[MCQ]:
    """`exam` is a licensing exam from the OT pack (countries.exams()): its name, question style,
    format and domain weights shape the questions. `concepts` ("topic: point", one per question) come
    from exams.plan so parallel batches don't write the same question."""
    system = load_prompt("mcq_generator").format(target_role=target_role, n=n, topics=", ".join(topics),
                                                 exam=exam["name"] if exam else "the licensing exam for the target country",
                                                 exam_style=exam_style(exam, topics) if exam else "Computer-based multiple choice; four options, one best answer.")
    user = "Generate the questions now."
    if concepts:
        user = "Write exactly one question for each of these, in this order (topic: what it tests):\n" + "\n".join(f"- {c}" for c in concepts)
    # Exam questions stay on Claude even when a free provider handles other basic calls: accuracy matters.
    questions = llm.extract(MCQSet, user=user, system=system, effort="low", feature="mcq", tier="judgment" if exam else "basic",
                            timeout=120 if exam else None).questions[:n]  # the model sometimes adds one per topic
    return _review(questions, exam) if exam and questions else questions


def _review(questions: list[MCQ], exam: dict) -> list[MCQ]:
    """Second pass for licensing-exam practice: an independent review of each keyed answer. Wrong keys are
    corrected, ambiguous or country-dependent questions are dropped, so she doesn't learn a wrong answer."""
    from app.core.models import MCQReview
    body = "\n\n".join(f"[{i}] {q.question}\n" + "\n".join(f"  {j}. {o}" for j, o in enumerate(q.options))
                        + f"\n  keyed answer_index: {q.answer_index}\n  explanation: {q.explanation}" for i, q in enumerate(questions))
    system = load_prompt("mcq_checker").format(exam=exam["name"])
    review = llm.extract(MCQReview, user=f"<questions>\n{body}\n</questions>", system=system, effort="medium", feature="mcq_review",
                         timeout=120)
    verdict = {c.index: c for c in review.checks}
    kept: list[MCQ] = []
    for i, q in enumerate(questions):
        c = verdict.get(i)
        if c is None or c.verdict == "ok":
            kept.append(q)
        elif c.verdict == "fix" and c.answer_index is not None:
            kept.append(q if c.answer_index == q.answer_index else
                        q.model_copy(update={"answer_index": c.answer_index, "explanation": f"{c.reason} {q.explanation}"}))
    return kept


def record_mcq(q: MCQ, correct: bool, exam: str | None = None) -> None:
    db.init()
    with db.connect() as conn:
        conn.execute("INSERT INTO mcq_results (topic, difficulty, correct, question, exam) VALUES (?, ?, ?, ?, ?)",
                     (q.topic, q.difficulty, int(correct), q.question, exam))


def mcq_stats(exam: str | None = None) -> list[dict]:
    """Per-topic accuracy, weakest first; for one licensing exam when `exam` is given."""
    db.init()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT topic, COUNT(*) n, SUM(correct) n_right FROM mcq_results" + (" WHERE exam=?" if exam else "") + " GROUP BY topic",
            (exam,) if exam else (),
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
