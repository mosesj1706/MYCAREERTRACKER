"""Make model-written text read like the candidate typed it.

Models reach for em dashes, curly quotes and ellipsis characters that almost nobody types by hand;
they are the first thing a reader (or an AI-text detector) notices. plain() normalises those to
keyboard characters. It changes punctuation only - never words.
"""
import re
from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

_CHARS = {
    "—": " - ",   # em dash
    "–": " - ",   # en dash (between words); the digit-range case is fixed up below
    "‒": "-",     # figure dash
    "‘": "'", "’": "'", "‚": "'",
    "“": '"', "”": '"', "„": '"',
    "…": "...",
    " ": " ", " ": " ", " ": " ",
    "​": "", "‌": "", "‍": "", "﻿": "",
    "•": "-",     # bullet character inside a sentence
}
_TABLE = str.maketrans(_CHARS)


def plain(s: str) -> str:
    s = s.translate(_TABLE)
    s = re.sub(r"(\d) - (\d)", r"\1-\2", s)        # 2022 - 2024 -> 2022-2024 (was an en dash)
    s = re.sub(r"[ \t]{2,}", " ", s)               # doubled spaces left by the dash substitution
    s = re.sub(r" - ([,.;:)])", r"\1", s)         # "word - ," -> "word,"
    return s.strip()


def plain_model(obj: T) -> T:
    """Apply plain() to every string inside a Pydantic model, recursively."""
    return obj.model_validate(_walk(obj.model_dump()))


def _walk(v):
    if isinstance(v, str):
        return plain(v)
    if isinstance(v, list):
        return [_walk(x) for x in v]
    if isinstance(v, dict):
        return {k: _walk(x) for k, x in v.items()}
    return v
