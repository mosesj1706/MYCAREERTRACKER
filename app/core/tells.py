"""Line-level scan for the things that make text read as model-written.

This is the part of an "AI detector" you can act on. Commercial detectors (GPTZero, Originality,
Copyleaks) score a document statistically; when they flag it you still have to guess which
sentence did it. This scanner names the sentence and the reason, using the signals those tools
and the research behind them lean on:

  - punctuation nobody types: em/en dashes, curly quotes, ellipsis characters
  - excess vocabulary: words whose frequency jumped after 2022 (Kobak et al. 2024, Liang et al.
    2024) plus the resume-specific cliches recruiters name
  - connective openers ("Additionally,") and closing restatements
  - rule-of-three padding, "not just X but Y", self-praise clauses
  - burstiness: humans vary sentence length a lot; models keep it even (GPTZero's second signal)
  - repeated sentence openers and identical bullet structure

Everything here is deterministic. detector.py holds the statistical score.
"""
import re
import statistics
from dataclasses import asdict, dataclass, field

# --- vocabulary -------------------------------------------------------------------------------
# Kobak et al. 2024 / Liang et al. 2024 excess words (post-ChatGPT frequency jump), trimmed to
# those plausible in career text, plus recruiter-named resume cliches. Matched as whole words,
# with common inflections.
EXCESS_WORDS = {
    "delve", "delves", "delved", "delving", "underscore", "underscores", "underscoring", "intricate", "intricacies",
    "pivotal", "crucial", "comprehensive", "showcase", "showcases", "showcasing", "showcased", "utilize", "utilise",
    "utilizing", "utilising", "utilized", "utilised", "notably", "meticulous", "meticulously", "realm", "tapestry",
    "landscape", "foster", "fosters", "fostering", "fostered", "robust", "leverage", "leverages", "leveraging",
    "leveraged", "seamless", "seamlessly", "cutting-edge", "streamline", "streamlined", "streamlining", "harness",
    "harnessing", "harnessed", "elevate", "elevating", "elevated", "empower", "empowering", "empowered", "spearhead",
    "spearheaded", "spearheading", "synergy", "synergies", "holistic", "dynamic", "passionate", "innovative",
    "transformative", "paramount", "multifaceted", "nuanced", "vibrant", "commendable", "invaluable", "adept",
    "endeavor", "endeavors", "bolster", "bolstered", "garner", "garnered", "unwavering", "testament", "beacon",
    "embark", "embarked", "navigate", "navigating", "unlock", "unlocking", "game-changer", "game-changing",
    "revolutionize", "revolutionized", "facilitate", "facilitated", "facilitating", "thrive", "thriving", "aspire",
    "aspiring", "actionable", "impactful",
}
EXCESS_PHRASES = [
    "results-driven", "proven track record", "track record of", "in today's", "fast-paced", "detail-oriented",
    "team player", "think outside the box", "go-getter", "self-starter", "hit the ground running", "best practices",
    "state-of-the-art", "next-level", "world-class", "at the forefront", "a wide range of", "a variety of",
    "plays a vital role", "plays a crucial role", "it is important to note", "it's worth noting", "in conclusion",
    "in summary", "to summarize", "overall,", "ultimately,", "i am writing to express", "i am excited to",
    "i am thrilled", "i am confident that", "i am eager to", "i would be a valuable", "perfect fit", "ideal candidate",
    "align with", "aligns with", "aligned with", "deep dive", "end-to-end solutions", "drive value", "add value",
    "value-add", "core competencies", "strong communication skills", "excellent communication",
    "demonstrating my", "demonstrating strong", "showcasing my", "highlighting my", "reflecting my", "underscoring my",
]
OPENERS = ["additionally", "furthermore", "moreover", "overall", "in conclusion", "ultimately", "importantly",
           "notably", "in essence", "in summary", "as such", "that said", "with that in mind", "not only"]
RESUME_OPENERS = ["responsible for", "duties included", "tasked with", "helped with", "worked on", "involved in"]

_PUNCT = {"—": "em dash", "–": "en dash", "‘": "curly quote", "’": "curly quote", "“": "curly quote",
          "”": "curly quote", "…": "ellipsis character"}
_RULE_OF_THREE = re.compile(r"\b(\w+), (\w+),? (?:and|&) (\w+)\b")
_NOT_JUST = re.compile(r"\bnot (?:just|only|merely|simply)\b.{3,80}?\bbut\b", re.I)
_PRAISE = re.compile(r"\b(demonstrat|showcas|highlight|exemplif|reflect|underscor|prov)(?:ing|es|e|ed)\s+(?:my|his|her|their|a|an|strong|deep|solid|the ability)\b", re.I)
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")
_WORD = re.compile(r"[A-Za-z][A-Za-z'\-]*")


@dataclass
class Finding:
    rule: str          # short slug, stable for the UI
    where: str         # the sentence / bullet it was found in (trimmed)
    detail: str        # what to change
    weight: int        # how much a reader notices it: 3 loud, 2 clear, 1 mild


@dataclass
class Stats:
    sentences: int = 0
    words: int = 0
    mean_len: float = 0.0
    burstiness: float = 0.0        # coefficient of variation of sentence length; humans ~0.5+, models often <0.3
    type_token_ratio: float = 0.0  # distinct / total words
    opener_repeat: float = 0.0     # share of sentences sharing their first word with another sentence


@dataclass
class TellReport:
    score: int                     # 0 = nothing found, 100 = reads as boilerplate
    label: str                     # "reads as your own" / "a few tells" / "reads as generated"
    findings: list[Finding] = field(default_factory=list)
    stats: Stats = field(default_factory=Stats)

    def as_dict(self) -> dict:
        return asdict(self)


def _units(text: str, kind: str) -> list[str]:
    """Prose is checked sentence by sentence; a bullet is one unit even when it holds two sentences."""
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip().lstrip("-•* ").strip()
        if not line:
            continue
        out.extend(s.strip() for s in (_SENT_SPLIT.split(line) if kind == "prose" else [line]) if s.strip())
    return out


def _trim(s: str, n: int = 110) -> str:
    return s if len(s) <= n else s[: n - 3].rsplit(" ", 1)[0] + "..."


def scan(text: str, kind: str = "prose") -> TellReport:
    """kind: "prose" (summary, cover letter, About) or "bullets" (resume/LinkedIn bullets)."""
    findings: list[Finding] = []
    units = _units(text, kind)
    lowered = text.lower()

    # 1. punctuation that is not on a keyboard
    for ch, name in _PUNCT.items():
        n = len(re.findall(r"[A-Za-z]\s?\u2013\s?[A-Za-z]", text)) if ch == "\u2013" else text.count(ch)
        if n:
            idx = text.find(ch)
            ctx = text[max(0, idx - 40): idx + 40].replace("\n", " ")
            plural = ("es" if name.endswith("sh") else "s") if n > 1 else ""
            # Word autocorrects " - " to an en dash, so humans produce those; em dashes are the loud one.
            findings.append(Finding("punctuation", _trim(ctx), f"{n} {name}{plural}. Use a comma, a full stop or \" - \".", 2 if ch == "\u2013" else 3))

    # 2. excess vocabulary and cliches
    seen: set[str] = set()
    for u in units:
        ul = u.lower()
        hits = [w for w in _WORD.findall(ul) if w in EXCESS_WORDS and w not in seen]
        for w in hits:
            seen.add(w)
            findings.append(Finding("vocabulary", _trim(u), f'"{w}" is on the post-2022 excess-usage list. Say what was actually done.', 2))
        for ph in EXCESS_PHRASES:
            if ph in ul and ph not in seen:
                seen.add(ph)
                findings.append(Finding("cliche", _trim(u), f'"{ph}" is boilerplate. Cut it or replace with a specific fact.', 2))

    # 3. sentence-level patterns
    for u in units:
        ul = u.lower()
        first = ul.split(",")[0].strip()
        for o in OPENERS:
            if first == o or ul.startswith(o + ",") or ul.startswith(o + " "):
                findings.append(Finding("opener", _trim(u), f'Starts with "{o}". Drop the connective; the sentence works without it.', 2))
                break
        if kind == "bullets":
            for o in RESUME_OPENERS:
                if ul.startswith(o):
                    findings.append(Finding("weak-verb", _trim(u), f'Starts with "{o}". Lead with what you did: Built, Migrated, Cut, Automated.', 2))
                    break
        m = _RULE_OF_THREE.search(u)
        if m and all(len(w) > 3 and not w[0].isupper() for w in m.groups()) and all(w.lower() not in ("data", "code") for w in m.groups()):
            a, b, c = m.groups()
            if all(w.endswith(("ive", "ble", "ous", "ful", "ent", "ant", "ic", "al", "ed", "ing")) for w in (a, b, c)):
                findings.append(Finding("triad", _trim(u), f'"{a}, {b} and {c}" is rule-of-three padding. Keep the one that is true.', 2))
        if _NOT_JUST.search(u):
            findings.append(Finding("not-just", _trim(u), '"not just X but Y" is a model tic. State Y.', 2))
        if _PRAISE.search(u):
            findings.append(Finding("self-praise", _trim(u), "A clause that grades the candidate. Delete it; the fact before it is the evidence.", 2))
        if u.count("!"):
            findings.append(Finding("exclamation", _trim(u), "No exclamation marks in a resume or cover letter.", 1))

    if kind == "bullets" and len(units) > 1:
        single = [u for u in units if len(_SENT_SPLIT.split(u)) == 1]
        dotted = [u for u in single if u.endswith(".")]
        if len(dotted) >= 2:
            findings.append(Finding("bullet-period", f"{len(dotted)} of {len(single)} one-sentence bullets", "One-sentence bullets do not take a trailing full stop.", 1))

    # 4. document statistics
    stats = Stats()
    lens = [len(_WORD.findall(u)) for u in units]
    lens = [n for n in lens if n > 0]
    words = _WORD.findall(lowered)
    stats.sentences, stats.words = len(lens), len(words)
    if lens:
        stats.mean_len = round(statistics.mean(lens), 1)
    if len(lens) >= 4:
        stats.burstiness = round(statistics.pstdev(lens) / statistics.mean(lens), 2)
        if stats.burstiness < 0.3 and kind == "prose":
            findings.append(Finding("even-rhythm", f"{len(lens)} sentences, {min(lens)}-{max(lens)} words each",
                                    "Every sentence is about the same length. Make one short. Let one run on.", 2))
    if words:
        stats.type_token_ratio = round(len(set(words)) / len(words), 2)
    if len(units) >= 4:
        firsts = [u.split(" ", 1)[0].lower() for u in units]
        repeated = sum(1 for f in firsts if firsts.count(f) > 1)
        stats.opener_repeat = round(repeated / len(firsts), 2)
        if stats.opener_repeat >= 0.5:
            top = max(set(firsts), key=firsts.count)
            findings.append(Finding("same-opener", f'"{top}" opens {firsts.count(top)} of {len(firsts)} {"bullets" if kind == "bullets" else "sentences"}',
                                    "Vary the first word.", 1))

    # 5. score: weighted findings per 100 words, capped
    per100 = (sum(f.weight for f in findings) / max(stats.words, 80)) * 100
    score = min(100, round(per100 * 7))
    label = "reads as your own" if score < 15 else "a few tells" if score < 40 else "reads as generated"
    findings.sort(key=lambda f: -f.weight)
    return TellReport(score=score, label=label, findings=findings, stats=stats)
