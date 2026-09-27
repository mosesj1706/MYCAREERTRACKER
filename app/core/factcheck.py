"""Authenticity check for text she will send (cover letters, tailored CV text).

Deterministic, no model call: every number must appear in the sources (her profile, the job ad, her
computed years), and a sentence that claims licensing progress (an exam passed, a licence held, an
eligibility letter issued) must match what her licence tracker says is done. Findings are shown next
to the text so she can fix or confirm them before sending.
"""
import re

_NUM = re.compile(r"(?<![\w.])(\d+(?:[.,/]\d+)?)\+?%?")
_SENT = re.compile(r"[^.!?\n]+[.!?]?")
_CLAIM = re.compile(r"\b(passed|hold|holding|held|licensed|issued|obtained|completed|cleared|received|have (?:my|an?|the))\b", re.I)
_LICENCE = re.compile(r"\b(DHA|DOH|MOHAP|SCFHS|DHP|OMSB|NHRA|Prometric|Pearson VUE|DataFlow|licen[cs]e|eligibility letter|NBCOT|NOTCE|HCPC)\b", re.I)
_HEDGE = re.compile(r"\b(not|yet|plan|planning|will|intend|preparing|prepare|aim|once|after|before|begin|start|in progress)\b", re.I)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower())


def check(text: str, sources: list[str], licence_done: set[str] | None = None, skip_first_line: bool = False) -> list[dict]:
    """Findings: [{"kind": "number" | "licence", "quote": sentence, "detail": why}]."""
    body = text.split("\n", 1)[1] if skip_first_line and "\n" in text else text
    src = _norm(" ".join(sources))
    src_nums = {m.group(1) for m in _NUM.finditer(src)}
    out: list[dict] = []
    for sent in (m.group(0).strip() for m in _SENT.finditer(body)):
        if not sent:
            continue
        missing = [n for n in (m.group(1) for m in _NUM.finditer(sent)) if n not in src_nums and not (1900 <= _as_int(n) <= 2100 and n in src)]
        if missing:
            out.append({"kind": "number", "quote": sent, "detail": f"{', '.join(missing)} is not in your profile or the job ad"})
        if licence_done is not None and _CLAIM.search(sent) and _LICENCE.search(sent) and not _HEDGE.search(sent):
            if not ({"exam", "eligibility_letter", "classification", "activation"} & licence_done):
                out.append({"kind": "licence", "quote": sent, "detail": "claims licensing progress your licence tracker does not show as done"})
    return out


def _as_int(n: str) -> int:
    try:
        return int(n)
    except ValueError:
        return -1


def sources_for(profile, jd_text: str = "") -> list[str]:
    """What her documents may draw on: the profile, the job ad, her computed experience, verified licence facts."""
    from app.core import countries  # local import: countries pulls in the model client
    years = profile.total_experience_years()
    half = round(years * 2) / 2
    checks = [countries.last_check(r) or {} for r in countries.tracked_routes()]
    return [profile.model_dump_json(), jd_text, f"{years} {half} {int(half)} {round(years)}"] + [c.get("summary", "") for c in checks]


def licence_done() -> set[str]:
    """Licence steps marked done on any route she tracks."""
    from app.core import countries
    prog = countries.progress()
    return {step for r in countries.tracked_routes() for step, v in prog.get(r, {}).items() if v.get("status") == "done"}
