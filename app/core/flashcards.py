"""Revision flashcards (OT): decks of front/back cards, reviewed with a Leitner schedule.

A card she knows moves up a box and comes back after longer and longer gaps (1, 3, 7, 16, 35 days); a card
she misses drops to box 0 and is due again today. Cards that are wrong or out of date can be hidden.
"""
import hashlib
import random
import re
from datetime import date, timedelta

from app.core import db

INTERVALS = [0, 1, 3, 7, 16, 35]  # days until a card in box i comes up again


def _fhash(text: str) -> str:
    return hashlib.sha1(re.sub(r"[^a-z0-9]+", " ", text.lower()).strip().encode()).hexdigest()


def add_cards(deck: str, cards: list[dict]) -> int:
    """Add {front, back, topic} cards to a deck; repeats of a front already in the deck are skipped."""
    db.init()
    with db.connect() as conn:
        before = conn.total_changes
        for c in cards:
            conn.execute("INSERT OR IGNORE INTO flashcards (deck, topic, front, back, fhash) VALUES (?,?,?,?,?)",
                         (deck, c["topic"], c["front"].strip(), c["back"].strip(), _fhash(c["front"])))
        return conn.total_changes - before


def _where(deck: str | None, topic: str | None) -> tuple[str, list]:
    sql, args = "hidden=0", []
    if deck:
        sql += " AND deck=?"; args.append(deck)
    if topic:
        sql += " AND topic=?"; args.append(topic)
    return sql, args


def summary() -> dict:
    """Per deck: cards, new, due today and known (box 3 or higher); and card counts per topic."""
    db.init()
    today = date.today().isoformat()
    with db.connect() as conn:
        decks = conn.execute("SELECT deck, COUNT(*) AS total, SUM(seen=0) AS new, SUM(seen>0 AND due<=?) AS due, SUM(box>=3) AS known "
                             "FROM flashcards WHERE hidden=0 GROUP BY deck ORDER BY deck", (today,)).fetchall()
        topics = conn.execute("SELECT topic, COUNT(*) AS total, SUM(seen>0 AND due<=?) AS due FROM flashcards WHERE hidden=0 "
                              "GROUP BY topic ORDER BY total DESC", (today,)).fetchall()
        hidden = conn.execute("SELECT COUNT(*) FROM flashcards WHERE hidden=1").fetchone()[0]
    return {"decks": [dict(r) for r in decks], "topics": [dict(r) for r in topics], "hidden": hidden}


def next_cards(deck: str | None, topic: str | None, n: int) -> list[dict]:
    """Up to n cards: the ones due (longest overdue first), then new ones in random order."""
    db.init()
    where, args = _where(deck, topic)
    with db.connect() as conn:
        due = conn.execute(f"SELECT * FROM flashcards WHERE {where} AND seen>0 AND due<=? ORDER BY due, box LIMIT ?",
                           (*args, date.today().isoformat(), n)).fetchall()
        new = conn.execute(f"SELECT * FROM flashcards WHERE {where} AND seen=0 ORDER BY RANDOM() LIMIT ?",
                           (*args, n - len(due))).fetchall() if len(due) < n else []
    cards = [dict(r) for r in due]
    random.shuffle(cards)
    return cards + [dict(r) for r in new]


def grade(card_id: int, knew: bool) -> dict:
    with db.connect() as conn:
        row = conn.execute("SELECT box FROM flashcards WHERE id=?", (card_id,)).fetchone()
        if row is None:
            raise KeyError(card_id)
        box = min(row["box"] + 1, len(INTERVALS) - 1) if knew else 0
        due = (date.today() + timedelta(days=INTERVALS[box])).isoformat()
        conn.execute("UPDATE flashcards SET box=?, due=?, seen=seen+1 WHERE id=?", (box, due, card_id))
        return dict(conn.execute("SELECT * FROM flashcards WHERE id=?", (card_id,)).fetchone())


def set_hidden(card_id: int, hidden: bool) -> None:
    with db.connect() as conn:
        if conn.execute("UPDATE flashcards SET hidden=? WHERE id=?", (int(hidden), card_id)).rowcount == 0:
            raise KeyError(card_id)
