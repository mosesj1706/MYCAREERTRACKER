"""Per-call LLM usage log: what each feature costs, so spend is visible in the app."""
from datetime import date, timedelta

from app.core import db

# USD per million tokens. Cache write = 1.25x input, cache read = 0.1x input.
PRICES = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_usage (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    feature       TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_read    INTEGER NOT NULL DEFAULT 0,
    cache_write   INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    fallback      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""


def cost(model: str, input_tokens: int, cache_read: int, cache_write: int, output_tokens: int) -> float:
    if model not in PRICES:
        return 0.0
    inp, out = PRICES[model]
    return (input_tokens * inp + cache_read * inp * 0.1 + cache_write * inp * 1.25 + output_tokens * out) / 1_000_000


def record(feature: str, provider: str, model: str, input_tokens: int = 0, cache_read: int = 0,
           cache_write: int = 0, output_tokens: int = 0, fallback: bool = False) -> None:
    with db.connect() as conn:
        conn.executescript(SCHEMA)
        conn.execute(
            "INSERT INTO llm_usage (feature, provider, model, input_tokens, cache_read, cache_write, output_tokens, cost_usd, fallback)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (feature, provider, model, input_tokens, cache_read, cache_write, output_tokens,
             cost(model, input_tokens, cache_read, cache_write, output_tokens), int(fallback)),
        )


def summary() -> dict:
    today = date.today().isoformat()
    week = (date.today() - timedelta(days=6)).isoformat()
    with db.connect() as conn:
        conn.executescript(SCHEMA)
        q = lambda sql, *a: [dict(r) for r in conn.execute(sql, a).fetchall()]
        totals = q("SELECT COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost FROM llm_usage WHERE date(created_at)=?", today)[0]
        wk = q("SELECT COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost FROM llm_usage WHERE date(created_at)>=?", week)[0]
        alltime = q("SELECT COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost FROM llm_usage")[0]
        by_feature = q("SELECT feature, provider, COUNT(*) calls, SUM(cost_usd) cost, SUM(input_tokens+cache_read+cache_write) input_tokens,"
                       " SUM(output_tokens) output_tokens, SUM(cache_read) cache_read, SUM(fallback) fallbacks"
                       " FROM llm_usage WHERE date(created_at)>=? GROUP BY feature, provider ORDER BY cost DESC", week)
        daily = q("SELECT date(created_at) day, SUM(cost_usd) cost, COUNT(*) calls FROM llm_usage WHERE date(created_at)>=? GROUP BY day ORDER BY day", week)
    return {"today": totals, "week": wk, "all_time": alltime, "by_feature": by_feature, "daily": daily}
