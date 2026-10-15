"""Licensing-exam practice (OT): a question bank per exam, practice sessions, full-length mocks.

Every question that survives the second review (interview._review) is stored in the exam's bank. Sessions
draw only from the bank (questions she hasn't mastered first) or her mistakes (questions whose latest answer
was wrong), so practice never calls the AI; generate() fills the bank when run on purpose, in parallel batches
of ten. Full mocks use the exam's length and time limit. Answers are marked on submit and also written to
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

from app.core import countries, db, flashcards, interview, llm
from app.core.config import load_prompt
from app.core.models import MCQ, MCQPlan
from app.core.text import plain

MODES = {"quick", "timed", "full"}
SOURCES = {"bank", "mistakes"}

# The study path: rounds unlocked one at a time by scoring PASS_PERCENT or more (DHA's own pass mark is 55%).
# Completing it closes the run (path_runs), turns the questions she got wrong into MISTAKES_DECK flashcards, and lets
# her start a new run.
PASS_PERCENT = 60
MISTAKES_DECK = "My exam mistakes"
ROUNDS = [("quick-5", "quick", 5), ("quick-10", "quick", 10), ("quick-15", "quick", 15),
          ("timed-10", "timed", 10), ("timed-20", "timed", 20), ("timed-30", "timed", 30), ("timed-50", "timed", 50),
          ("full", "full", 0)]  # 0: the exam's mock length
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


def _from_bank(exam: str, topics: list[str] | None, n: int, mistakes_only: bool) -> list[int]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT id, topic FROM exam_questions WHERE exam=?", (exam,)).fetchall()
        latest = _latest_answers(conn, exam)
    pool = [r["id"] for r in rows if not topics or r["topic"] in topics]
    if mistakes_only:
        pool = [q for q in pool if latest.get(q) == 0]
    random.shuffle(pool)
    # unseen first, then previously wrong, then the rest
    pool.sort(key=lambda q: 0 if q not in latest else (1 if latest[q] == 0 else 2))
    return pool[:n]


def _wrong_in(session_id: int) -> list[int]:
    db.init()
    with db.connect() as conn:
        rows = conn.execute("SELECT question_id FROM exam_answers WHERE session_id=? AND correct=0 ORDER BY position", (session_id,)).fetchall()
    return [r["question_id"] for r in rows]


def _option_order(options: list[str], explanation: str) -> list[int]:
    """A fresh order for a question's options every time it is asked, so she learns the answer rather than its
    letter. Options or explanations that refer to positions ("all of the above") keep their order."""
    order = list(range(len(options)))
    if not any(_POSITIONAL.search(t) for t in [*options, explanation]):
        random.shuffle(order)
    return order


def start(exam_id: str, mode: str, source: str, n: int, topics: list[str], retry_of: int | None = None,
          round_id: str | None = None, cycle: int | None = None) -> dict:
    """retry_of: a finished session whose wrong (and unanswered) questions make up the new one.
    round_id, cycle: the study-path round this session is, and in which run of the path (see path())."""
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
    elif mode == "full":  # like the real thing: questions she hasn't seen first, then her mistakes, then the rest
        ids = _from_bank(exam["id"], None, n, mistakes_only=False)
    else:
        ids = _from_bank(exam["id"], topics, n, mistakes_only=source == "mistakes")
    if not ids:
        raise ValueError("No questions to practise yet: " + ("you have no outstanding mistakes." if source == "mistakes" else "the bank is empty for this exam."))
    time_limit = (mock.get("minutes", 120) * 60 * len(ids) // max(1, mock.get("questions", len(ids)))) if mode == "full" else \
        (len(ids) * exam.get("seconds_per_question", 72) if mode == "timed" else None)
    db.init()
    with db.connect() as conn:
        sid = conn.execute("INSERT INTO exam_sessions (exam, mode, source, total, time_limit, round, cycle) VALUES (?,?,?,?,?,?,?)",
                           (exam["id"], mode, source, len(ids), time_limit, round_id, cycle)).lastrowid
        qs = {r["id"]: r for r in conn.execute(f"SELECT id, options_json, explanation FROM exam_questions WHERE id IN ({','.join('?' * len(ids))})", ids)}
        conn.executemany("INSERT INTO exam_answers (session_id, position, question_id, option_order) VALUES (?,?,?,?)",
                         [(sid, i, q, json.dumps(_option_order(json.loads(qs[q]["options_json"]), qs[q]["explanation"]))) for i, q in enumerate(ids)])
    return get(sid)


def _percent(row) -> int:
    return round(100 * (row["correct"] or 0) / max(1, row["total"]))


def _current_run(conn, exam_id: str):
    run = conn.execute("SELECT * FROM path_runs WHERE exam=? ORDER BY cycle DESC LIMIT 1", (exam_id,)).fetchone()
    if run is None:
        conn.execute("INSERT OR IGNORE INTO path_runs (exam, cycle) VALUES (?, 1)", (exam_id,))
        run = conn.execute("SELECT * FROM path_runs WHERE exam=? ORDER BY cycle DESC LIMIT 1", (exam_id,)).fetchone()
    return run


def path(exam_id: str) -> dict:
    """Her current run of the study path for an exam: each round passed, open (the next one to do) or locked, with
    her best score, attempts and any session she left part-way. A round is passed by any finished attempt scoring
    PASS_PERCENT. Also every run so far, so the page can show how many times she has completed it."""
    exam = countries.exam(exam_id)
    if exam is None:
        raise KeyError(exam_id)
    db.init()
    with db.connect() as conn:
        run = _current_run(conn, exam_id)
        sessions = conn.execute("SELECT id, round, total, correct, finished_at FROM exam_sessions WHERE exam=? AND round IS NOT NULL "
                                "AND COALESCE(cycle, 1)=? ORDER BY id", (exam_id, run["cycle"])).fetchall()
        runs = [dict(r) for r in conn.execute("SELECT cycle, started_at, completed_at, cards_added FROM path_runs WHERE exam=? ORDER BY cycle",
                                              (exam_id,))]
    steps, unlocked = [], True
    for rid, mode, n in ROUNDS:
        done = [r for r in sessions if r["round"] == rid and r["finished_at"]]
        passed = next((r["finished_at"] for r in done if _percent(r) >= PASS_PERCENT), None)
        open_id = next((r["id"] for r in reversed(sessions) if r["round"] == rid and not r["finished_at"]), None)
        steps.append({"id": rid, "mode": mode, "n": n or exam.get("mock", {}).get("questions", 100),
                      "status": "passed" if passed else "open" if unlocked else "locked",
                      "best": max((_percent(r) for r in done), default=None), "attempts": len(done),
                      "resume_id": open_id if unlocked or passed else None})
        unlocked = unlocked and passed is not None
    if unlocked and run["completed_at"] is None:  # every round passed: close the run
        _complete(exam_id, run["cycle"])
        return path(exam_id)
    return {"pass_percent": PASS_PERCENT, "steps": steps, "cycle": run["cycle"], "complete": run["completed_at"] is not None, "runs": runs}


def _complete(exam_id: str, cycle: int) -> None:
    """Close a run she has finished and turn every question she got wrong in it into a flashcard."""
    cards = [_mistake_card(w) for w in report(exam_id, cycle)["wrong"]]
    added = flashcards.add_cards(MISTAKES_DECK, cards) if cards else 0
    with db.connect() as conn:
        conn.execute("UPDATE path_runs SET completed_at=COALESCE(completed_at, datetime('now','localtime')), cards_added=? "
                     "WHERE exam=? AND cycle=?", (added, exam_id, cycle))


def _mistake_card(w: dict) -> dict:
    letters = "ABCDEF"
    options = "\n".join(f"{letters[j]}. {o}" for j, o in enumerate(w["options"]))
    ref = f"\n\nRead more: {w['reference']}" if w["reference"] else ""
    return {"topic": w["topic"], "front": f"{w['question']}\n\n{options}",
            "back": f"Answer: {letters[w['answer_index']]}. {w['options'][w['answer_index']]}\n\n{w['explanation']}{ref}"}


def restart_path(exam_id: str) -> dict:
    """Start the study path again from round one, once the current run is complete."""
    if countries.exam(exam_id) is None:
        raise KeyError(exam_id)
    db.init()
    with db.connect() as conn:
        run = _current_run(conn, exam_id)
        if run["completed_at"] is None:
            raise ValueError("Finish the current study path first.")
        conn.execute("INSERT INTO path_runs (exam, cycle) VALUES (?, ?)", (exam_id, run["cycle"] + 1))
    return path(exam_id)


def report(exam_id: str, cycle: int | None = None) -> dict:
    """What a run of the study path took: attempts, scores and time per round, accuracy per topic (weakest first),
    and every question she got wrong, with the answer and explanation, as study notes."""
    exam = countries.exam(exam_id)
    if exam is None:
        raise KeyError(exam_id)
    db.init()
    with db.connect() as conn:
        run = conn.execute("SELECT * FROM path_runs WHERE exam=? AND cycle=?", (exam_id, cycle)).fetchone() if cycle else _current_run(conn, exam_id)
        if run is None:
            raise KeyError(cycle)
        where = "s.exam=? AND s.round IS NOT NULL AND COALESCE(s.cycle, 1)=? AND s.finished_at IS NOT NULL"
        sessions = conn.execute(f"SELECT * FROM exam_sessions s WHERE {where} ORDER BY s.id", (exam_id, run["cycle"])).fetchall()
        answers = conn.execute("SELECT a.correct, q.id, q.topic, q.question, q.options_json, q.answer_index, q.explanation, q.reference "
                               f"FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id JOIN exam_sessions s ON s.id = a.session_id "
                               f"WHERE {where}", (exam_id, run["cycle"])).fetchall()
    rounds = []
    for rid, mode, n in ROUNDS:
        tries = [s for s in sessions if s["round"] == rid]
        pcts = [_percent(s) for s in tries]
        rounds.append({"id": rid, "mode": mode, "n": tries[0]["total"] if tries else n or exam.get("mock", {}).get("questions", 100),
                       "attempts": len(tries), "first": pcts[0] if pcts else None, "best": max(pcts, default=None),
                       "passed_on": next((s["finished_at"] for s, p in zip(tries, pcts) if p >= PASS_PERCENT), None),
                       "seconds": sum(s["seconds_used"] or 0 for s in tries)})
    topics: dict[str, list[int]] = {}
    wrong: dict[int, dict] = {}
    for a in answers:
        t = topics.setdefault(a["topic"], [0, 0])
        t[0] += a["correct"] or 0
        t[1] += 1
        if not a["correct"]:
            w = wrong.setdefault(a["id"], {"topic": a["topic"], "question": a["question"], "options": json.loads(a["options_json"]),
                                           "answer_index": a["answer_index"], "explanation": a["explanation"], "reference": a["reference"],
                                           "times_wrong": 0})
            w["times_wrong"] += 1
    by_topic = sorted(({"topic": t, "correct": c, "total": k, "percent": round(100 * c / k)} for t, (c, k) in topics.items()),
                      key=lambda d: d["percent"])
    rank = {d["topic"]: i for i, d in enumerate(by_topic)}
    correct = sum(a["correct"] or 0 for a in answers)
    return {"exam": exam["name"], "cycle": run["cycle"], "started_at": run["started_at"], "completed_at": run["completed_at"],
            "cards_added": run["cards_added"], "deck": MISTAKES_DECK, "pass_percent": PASS_PERCENT, "attempts": len(sessions),
            "answered": len(answers), "correct": correct, "percent": round(100 * correct / max(1, len(answers))),
            "seconds": sum(s["seconds_used"] or 0 for s in sessions), "rounds": rounds, "by_topic": by_topic,
            "wrong": sorted(wrong.values(), key=lambda w: (rank[w["topic"]], -w["times_wrong"]))}


def start_round(exam_id: str, round_id: str) -> dict:
    """Start (or resume) a study-path round. Locked rounds can't be started."""
    step = next((x for x in path(exam_id)["steps"] if x["id"] == round_id), None)
    if step is None:
        raise ValueError("Unknown round.")
    if step["status"] == "locked":
        raise ValueError("Pass the round before this one first.")
    if step["resume_id"]:
        return get(step["resume_id"])
    return start(exam_id, step["mode"], "bank", step["n"], [], round_id=round_id, cycle=path(exam_id)["cycle"])


def save_progress(session_id: int, answers: list[dict], seconds_used: int | None) -> None:
    """Keep her answers and time so far in an unfinished session, so she can leave and carry on later."""
    with db.connect() as conn:
        s = conn.execute("SELECT finished_at FROM exam_sessions WHERE id=?", (session_id,)).fetchone()
        if s is None:
            raise KeyError(session_id)
        if s["finished_at"]:
            return
        conn.executemany("UPDATE exam_answers SET picked=?, flagged=? WHERE session_id=? AND position=?",
                         [(a.get("picked"), int(bool(a.get("flagged"))), session_id, a["position"]) for a in answers])
        if seconds_used is not None:
            conn.execute("UPDATE exam_sessions SET seconds_used=? WHERE id=?", (max(0, seconds_used), session_id))


def get(session_id: int) -> dict | None:
    db.init()
    with db.connect() as conn:
        s = conn.execute("SELECT * FROM exam_sessions WHERE id=?", (session_id,)).fetchone()
        if not s:
            return None
        rows = conn.execute("SELECT a.position, a.picked, a.correct, a.flagged, a.option_order, q.* FROM exam_answers a "
                            "JOIN exam_questions q ON q.id = a.question_id WHERE a.session_id=? ORDER BY a.position", (session_id,)).fetchall()
    items = []
    for r in rows:  # options as she saw them; picked and answer_index refer to that order
        options = json.loads(r["options_json"])
        order = json.loads(r["option_order"]) if r["option_order"] else list(range(len(options)))
        items.append({"position": r["position"], "question_id": r["id"], "topic": r["topic"], "difficulty": r["difficulty"], "question": r["question"],
                      "options": [options[i] for i in order], "answer_index": order.index(r["answer_index"]), "explanation": r["explanation"],
                      "reference": r["reference"], "picked": r["picked"], "correct": r["correct"], "flagged": bool(r["flagged"])})
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
    if s.get("round"):
        path(s["exam"])  # closes the run when this was its last round
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
         Paragraph(esc(f"{s['total']} questions · session {s['id']} · {s['created_at'][:10]} · practice questions, not real exam questions"), sub),
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


def _duration(seconds: int) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m} min" if h else f"{m} min"


ROUND_LABEL = {"quick": "Quick-fire", "timed": "Timed", "full": "Full mock exam"}


def report_pdf(exam_id: str, cycle: int | None = None) -> bytes:
    """The study-path report as a printable PDF: summary, rounds, topics, then her study notes (each question she
    got wrong, with the answer and explanation), grouped by topic, weakest first."""
    r = report(exam_id, cycle)
    esc = lambda t: plain(str(t)).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=15, leading=19)
    h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, spaceBefore=10, spaceAfter=3)
    sub = ParagraphStyle("s", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#5f6368"))
    line = ParagraphStyle("l", fontName="Helvetica", fontSize=9.6, leading=13)
    q = ParagraphStyle("q", fontName="Helvetica-Bold", fontSize=10, leading=13.5, spaceBefore=8)
    o = ParagraphStyle("o", fontName="Helvetica", fontSize=9.6, leading=12.8, leftIndent=12)
    k = ParagraphStyle("k", fontName="Helvetica", fontSize=9.3, leading=12.5, spaceBefore=3, leftIndent=12)
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"{r['exam']} study path report")
    when = f"completed {r['completed_at'][:10]}" if r["completed_at"] else "in progress"
    f = [Paragraph(esc(f"{r['exam']}: study path report"), h),
         Paragraph(esc(f"Run {r['cycle']} · started {r['started_at'][:10]} · {when} · {r['attempts']} attempts · {r['answered']} questions · "
                       f"{r['percent']}% correct · {_duration(r['seconds'])}"), sub),
         Paragraph("Rounds", h2)]
    for x in r["rounds"]:
        if x["attempts"]:
            f.append(Paragraph(esc(f"{ROUND_LABEL[x['mode']]}, {x['n']} questions: {x['attempts']} attempt{'s' if x['attempts'] > 1 else ''}, "
                                   f"first {x['first']}%, best {x['best']}%" + (f", passed {x['passed_on'][:10]}" if x["passed_on"] else ", not passed yet")), line))
    f.append(Paragraph("Topics, weakest first", h2))
    f += [Paragraph(esc(f"{t['topic']}: {t['correct']}/{t['total']} ({t['percent']}%)"), line) for t in r["by_topic"]]
    f.append(Paragraph(f"Study notes: {len(r['wrong'])} questions you got wrong", h2))
    topic = None
    for w in r["wrong"]:
        if w["topic"] != topic:
            topic = w["topic"]
            f.append(Paragraph(esc(topic), ParagraphStyle("t", parent=h2, fontSize=10.5, textColor=colors.HexColor("#0a6cff"))))
        block = [Paragraph(esc(w["question"]), q)]
        block += [Paragraph(esc(f"{'ABCDEF'[j]}.  {opt}"), o) for j, opt in enumerate(w["options"])]
        ref = f"  Read more: {w['reference']}" if w["reference"] else ""
        times = f"  (wrong {w['times_wrong']} times)" if w["times_wrong"] > 1 else ""
        block.append(Paragraph(f"<b>Answer {'ABCDEF'[w['answer_index']]}.</b> {esc(w['explanation'])}{esc(ref)}{esc(times)}", k))
        f.append(KeepTogether(block))
    doc.build(f)
    return buf.getvalue()
