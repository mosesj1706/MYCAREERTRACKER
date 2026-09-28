"""Licensing-exam practice (OT): a question bank per exam, practice sessions, full-length mocks.

Every question that survives the second review (interview._review) is stored in the exam's bank. A session
draws its questions from new generation, the bank (questions she hasn't mastered first) or her mistakes
(questions whose latest answer was wrong). Full mocks use the exam's length and time limit; new questions
for them are generated in parallel batches of ten. Answers are marked on submit and also written to
mcq_results, so topic accuracy and the dashboard trend keep working.
"""
import hashlib
import json
import random
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer

from app.core import countries, db, interview, llm
from app.core.config import load_prompt
from app.core.models import MCQ, MCQPlan
from app.core.text import plain

MODES = {"quick", "timed", "full"}
SOURCES = {"new", "bank", "mistakes"}
BATCH = 10
DEADLINE = 240  # seconds to wait for a round of batches (a batch of ten normally takes about 40)


_STOP = set("a an the of to and or in on for with by at as from is are be this that which what who when most best first "
             "should would will has have his her their client patient therapist occupational therapy ot".split())


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in _STOP}


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / max(1, len(a | b))


def _sig(question: str, options: list[str], answer_index: int) -> tuple[set[str], set[str]]:
    return _words(question), _words(options[answer_index])


def _similar(a: tuple[set[str], set[str]], b: tuple[set[str], set[str]]) -> bool:
    """A reworded copy of the same question: stems that share most of their words, or similar stems with a
    similar keyed answer. Tuned on a 100-question DHA set; it also catches near-identical vignettes keyed
    to different answers, which would teach her contradictory rules."""
    stem, key = _jaccard(a[0], b[0]), _jaccard(a[1], b[1])
    return stem >= 0.58 or (stem >= 0.45 and key >= 0.3)


def _qhash(text: str) -> str:
    return hashlib.sha1(re.sub(r"[^a-z0-9]+", " ", text.lower()).strip().encode()).hexdigest()


_POSITIONAL = re.compile(r"\b(all|none|both) of the above\b|\bboth [A-D] and [A-D]\b|\b(option|answer|choice)s? [A-D]\b|\b[A-D] (and|or) [A-D]\b", re.I)


def _shuffle(q: MCQ) -> MCQ:
    """Put the right answer in a random position. The model favours A and B (a 99-question mock had no D
    answers at all), which a test-taker would learn to exploit. Questions whose options or explanation
    refer to positions ("all of the above", "option B") keep their order."""
    if len(q.options) < 2 or not 0 <= q.answer_index < len(q.options) or \
            any(_POSITIONAL.search(t) for t in [*q.options, q.explanation]):
        return q
    order = list(range(len(q.options)))
    random.shuffle(order)
    return q.model_copy(update={"options": [q.options[i] for i in order], "answer_index": order.index(q.answer_index)})


def _store(exam: str, questions: list[MCQ]) -> list[int]:
    """Add questions to the bank (repeats are skipped) and return their ids, in order, without repeats."""
    db.init()
    ids: list[int] = []
    with db.connect() as conn:
        for q in map(_shuffle, questions):
            h = _qhash(q.question)
            conn.execute("INSERT OR IGNORE INTO exam_questions (exam, topic, difficulty, question, options_json, answer_index, explanation, reference, qhash)"
                         " VALUES (?,?,?,?,?,?,?,?,?)", (exam, q.topic, q.difficulty, q.question, json.dumps(q.options), q.answer_index,
                                                         q.explanation, q.reference, h))
            qid = conn.execute("SELECT id FROM exam_questions WHERE exam=? AND qhash=?", (exam, h)).fetchone()["id"]
            if qid not in ids:
                ids.append(qid)
    return ids


def _allocate(exam: dict, topics: list[str], n: int) -> list[list[str]]:
    """Split n questions into batches of up to ten, each with its topics. Domain weights (NBCOT) set the mix."""
    weights = dict(zip(exam.get("topics", []), exam.get("weights", [])))
    if all(t in weights for t in topics) and weights:
        total = sum(weights[t] for t in topics)
        slots = [t for t in topics for _ in range(round(n * weights[t] / total))]
    else:
        slots = [topics[i % len(topics)] for i in range(n)]
    slots = (slots + [topics[0]] * n)[:n]
    random.shuffle(slots)
    return [slots[i:i + BATCH] for i in range(0, n, BATCH)]


def _bank(exam: str) -> list[dict]:
    """The exam's questions, newest first: topic, question and the signature _similar compares."""
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT topic, question, options_json, answer_index FROM exam_questions WHERE exam=? ORDER BY id DESC",
                            (exam,)).fetchall()
    return [{"topic": r["topic"], "question": r["question"], "sig": _sig(r["question"], json.loads(r["options_json"]), r["answer_index"])}
            for r in rows]


def plan(exam: dict, topics: list[str], n: int, bank: list[str]) -> list[str]:
    """n distinct concepts ("topic: point") across the topics, none already in the bank. The topic mix
    follows the exam's domain weights. Without a plan, parallel batches each write the same classic
    questions (C6 tetraplegia and tenodesis, zone II flexor tendons...)."""
    counts: dict[str, int] = {}
    for batch in _allocate(exam, topics, n):
        for t in batch:
            counts[t] = counts.get(t, 0) + 1
    system = load_prompt("mcq_planner").format(exam=exam["name"], n=n, exam_style=interview.exam_style(exam, topics),
                                               counts=", ".join(f"{t} {c}" for t, c in counts.items()))
    listed = "\n".join(f"- {q[:160]}" for q in bank[:300]) or "(empty)"
    got = llm.extract(MCQPlan, user=f"<bank>\n{listed}\n</bank>\n\nList the {n} concepts now.", system=system,
                      effort="low", feature="mcq_plan", tier="judgment", timeout=90).concepts
    return [f"{c.topic if c.topic in topics else topics[0]}: {c.concept}" for c in got][:n]


def generate(exam_id: str, topics: list[str], n: int, target_role: str) -> list[int]:
    """New reviewed questions for an exam: planned so each tests something different, written in parallel
    batches, filtered for near-copies of each other and of the bank, stored in the bank. Returns ids."""
    exam = countries.exam(exam_id)
    if exam is None:
        raise KeyError(exam_id)
    ids: list[int] = []
    for _ in range(2):  # the reviewer and the copy filter drop some; one more round makes up the count
        bank = _bank(exam["id"])
        need = n - len(ids)
        try:
            concepts = plan(exam, topics, need, [b["question"] for b in bank if b["topic"] in topics])
        except Exception:  # noqa: BLE001 - without a plan the batches still work, just less varied
            concepts = []
        if concepts:
            batches = [concepts[i:i + BATCH] for i in range(0, len(concepts), BATCH)]
            args = [(sorted({c.split(":", 1)[0] for c in b}), len(b), b) for b in batches]
        else:
            args = [(sorted(set(b)), len(b), None) for b in _allocate(exam, topics, need)]
        got: list[MCQ] = []
        pool = ThreadPoolExecutor(max_workers=min(6, len(args)))
        jobs = [pool.submit(interview.generate_mcqs, t, k, target_role, exam, c) for t, k, c in args]
        try:
            for job in as_completed(jobs, timeout=DEADLINE):
                try:
                    got.extend(job.result())
                except Exception:  # noqa: BLE001 - one failed batch should not sink a whole mock
                    continue
        except TimeoutError:  # a stalled batch is left behind; the next round makes up for it
            pass
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        seen = [b["sig"] for b in bank]
        fresh: list[MCQ] = []
        for q in got:
            if q.topic not in topics:  # "and" for "&" and the like
                q = q.model_copy(update={"topic": max(topics, key=lambda t: len(_words(t) & _words(q.topic)))})
            sig = _sig(q.question, q.options, q.answer_index)
            if not any(_similar(sig, x) for x in seen):
                seen.append(sig)
                fresh.append(q)
        ids += [q for q in _store(exam["id"], fresh) if q not in ids]
        if len(ids) >= n:
            break
    if not ids:
        raise RuntimeError("Could not write questions just now. Try again in a minute.")
    return ids[:n]


def _latest_answers(conn, exam: str) -> dict[int, int]:
    """question_id -> 1/0 for her most recent answer to it."""
    rows = conn.execute("SELECT a.question_id, a.correct FROM exam_answers a JOIN exam_sessions s ON s.id = a.session_id "
                        "WHERE s.exam=? AND a.correct IS NOT NULL ORDER BY s.finished_at, a.position", (exam,)).fetchall()
    return {r["question_id"]: r["correct"] for r in rows}


def _from_bank(exam: str, topics: list[str] | None, n: int, mistakes_only: bool, unseen_only: bool = False) -> list[int]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT id, topic FROM exam_questions WHERE exam=?", (exam,)).fetchall()
        latest = _latest_answers(conn, exam)
    pool = [r["id"] for r in rows if not topics or r["topic"] in topics]
    if mistakes_only:
        pool = [q for q in pool if latest.get(q) == 0]
    if unseen_only:
        pool = [q for q in pool if q not in latest]
    random.shuffle(pool)
    # unseen first, then previously wrong, then the rest
    pool.sort(key=lambda q: 0 if q not in latest else (1 if latest[q] == 0 else 2))
    return pool[:n]


def _wrong_in(session_id: int) -> list[int]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT question_id FROM exam_answers WHERE session_id=? AND correct=0 ORDER BY position", (session_id,)).fetchall()
    return [r["question_id"] for r in rows]


def start(exam_id: str, mode: str, source: str, n: int, topics: list[str], target_role: str, retry_of: int | None = None) -> dict:
    """retry_of: a finished session whose wrong (and unanswered) questions make up the new one."""
    exam = countries.exam(exam_id)
    if exam is None:
        raise KeyError(exam_id)
    if mode not in MODES or source not in SOURCES:
        raise ValueError("Unknown mode or source.")
    mock = exam.get("mock", {})
    if mode == "full":
        n, topics = mock.get("questions", 100), exam["topics"]
    n = max(1, min(n, 250))
    topics = topics or exam["topics"]
    if retry_of is not None and mode != "full":
        ids, source = _wrong_in(retry_of), "mistakes"
        if not ids:
            raise ValueError("No wrong answers in that session.")
    elif source == "new" and mode != "full":
        ids = generate(exam["id"], topics, n, target_role)
    elif mode == "full":  # like the real thing: questions she hasn't seen, topped up with new ones
        ids = _from_bank(exam["id"], None, n, mistakes_only=False, unseen_only=True)
        if len(ids) < n:
            try:
                ids += [q for q in generate(exam["id"], topics, n - len(ids), target_role) if q not in ids]
            except RuntimeError:  # no new questions to be had right now: repeat ones she has seen, mistakes first
                pass
            ids += [q for q in _from_bank(exam["id"], None, n, mistakes_only=False) if q not in ids][:n - len(ids)]
    else:
        ids = _from_bank(exam["id"], topics, n, mistakes_only=source == "mistakes")
    if not ids:
        raise ValueError("No questions to practise yet: " + ("you have no outstanding mistakes." if source == "mistakes" else "generate some first."))
    time_limit = (mock.get("minutes", 120) * 60 * len(ids) // max(1, mock.get("questions", len(ids)))) if mode == "full" else \
        (len(ids) * exam.get("seconds_per_question", 72) if mode == "timed" else None)
    db.init()
    with db.connect() as conn:
        sid = conn.execute("INSERT INTO exam_sessions (exam, mode, source, total, time_limit) VALUES (?,?,?,?,?)",
                           (exam["id"], mode, source, len(ids), time_limit)).lastrowid
        conn.executemany("INSERT INTO exam_answers (session_id, position, question_id) VALUES (?,?,?)",
                         [(sid, i, q) for i, q in enumerate(ids)])
    return get(sid)


def get(session_id: int) -> dict | None:
    db.init()
    with db.connect() as conn:
        s = conn.execute("SELECT * FROM exam_sessions WHERE id=?", (session_id,)).fetchone()
        if not s:
            return None
        rows = conn.execute("SELECT a.position, a.picked, a.correct, a.flagged, q.* FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id "
                            "WHERE a.session_id=? ORDER BY a.position", (session_id,)).fetchall()
    items = [{"position": r["position"], "question_id": r["id"], "topic": r["topic"], "difficulty": r["difficulty"], "question": r["question"],
              "options": json.loads(r["options_json"]), "answer_index": r["answer_index"], "explanation": r["explanation"],
              "reference": r["reference"], "picked": r["picked"], "correct": r["correct"], "flagged": bool(r["flagged"])} for r in rows]
    return dict(s) | {"items": items, "by_topic": _by_topic(items) if s["finished_at"] else []}


def _by_topic(items: list[dict]) -> list[dict]:
    acc: dict[str, list[int]] = {}
    for it in items:
        a = acc.setdefault(it["topic"], [0, 0])
        a[0] += 1 if it["correct"] else 0
        a[1] += 1
    return sorted(({"topic": t, "correct": c, "total": n, "percent": round(100 * c / n)} for t, (c, n) in acc.items()), key=lambda d: d["percent"])


def submit(session_id: int, answers: list[dict], seconds_used: int | None) -> dict:
    """Mark a session. `answers`: [{position, picked, flagged}]. Submitting twice returns the first result."""
    s = get(session_id)
    if s is None:
        raise KeyError(session_id)
    if s["finished_at"]:
        return s
    picked = {a["position"]: a for a in answers}
    with db.connect() as conn:
        correct = 0
        for it in s["items"]:
            a = picked.get(it["position"], {})
            p = a.get("picked")
            ok = int(p is not None and p == it["answer_index"])
            correct += ok
            conn.execute("UPDATE exam_answers SET picked=?, correct=?, flagged=? WHERE session_id=? AND position=?",
                         (p, ok, int(bool(a.get("flagged"))), session_id, it["position"]))
            conn.execute("INSERT INTO mcq_results (topic, difficulty, correct, question, exam) VALUES (?,?,?,?,?)",
                         (it["topic"], it["difficulty"], ok, it["question"], s["exam"]))
        conn.execute("UPDATE exam_sessions SET correct=?, seconds_used=?, finished_at=datetime('now','localtime') WHERE id=?",
                     (correct, seconds_used, session_id))
    return get(session_id)


def list_sessions(exam: str | None = None) -> list[dict]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM exam_sessions" + (" WHERE exam=?" if exam else "") + " ORDER BY id DESC",
                            (exam,) if exam else ()).fetchall()
    return [dict(r) for r in rows]


def delete_session(session_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM exam_sessions WHERE id=?", (session_id,))


def bank_stats(exam: str) -> dict:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT id, topic FROM exam_questions WHERE exam=?", (exam,)).fetchall()
        latest = _latest_answers(conn, exam)
    by_topic: dict[str, int] = {}
    for r in rows:
        by_topic[r["topic"]] = by_topic.get(r["topic"], 0) + 1
    return {"total": len(rows), "answered": sum(1 for r in rows if r["id"] in latest),
            "mistakes": sum(1 for r in rows if latest.get(r["id"]) == 0), "by_topic": by_topic}


def pdf(session_id: int) -> bytes:
    """A printable practice paper: the questions, then the answer key with explanations (and her answers
    when the session is finished)."""
    s = get(session_id)
    exam = countries.exam(s["exam"]) or {"name": s["exam"]}
    esc = lambda t: plain(str(t)).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=15, leading=19)
    sub = ParagraphStyle("s", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#5f6368"))
    q = ParagraphStyle("q", fontName="Helvetica-Bold", fontSize=10, leading=13.5, spaceBefore=8)
    o = ParagraphStyle("o", fontName="Helvetica", fontSize=9.8, leading=13, leftIndent=12)
    k = ParagraphStyle("k", fontName="Helvetica", fontSize=9.3, leading=12.5, spaceBefore=5)
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"{exam['name']} practice paper")
    f = [Paragraph(esc(f"{exam['name']} practice paper"), h),
         Paragraph(esc(f"{s['total']} questions · session {s['id']} · {s['created_at'][:10]} · AI-written practice, not real exam questions"), sub),
         Spacer(1, 4 * mm)]
    for it in s["items"]:
        block = [Paragraph(esc(f"{it['position'] + 1}. {it['question']}"), q)]
        block += [Paragraph(esc(f"{'ABCD'[j]}.  {opt}"), o) for j, opt in enumerate(it["options"])]
        f.append(KeepTogether(block))
    f += [PageBreak(), Paragraph("Answer key", h), Spacer(1, 2 * mm)]
    for it in s["items"]:
        mine = f"  ·  your answer {'ABCD'[it['picked']]}" if it["picked"] is not None else ""
        ref = f"  Read more: {it['reference']}" if it["reference"] else ""
        f.append(Paragraph(f"<b>{it['position'] + 1}. {'ABCD'[it['answer_index']]}</b>{esc(mine)}  {esc(it['explanation'])}{esc(ref)}", k))
    doc.build(f)
    return buf.getvalue()
