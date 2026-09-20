"""Binoculars score: the strongest open zero-shot AI-text detector, run locally.

Hans et al., "Spotting LLMs with Binoculars" (ICML 2024). Two sibling models read the text: a
base model (observer) and its instruction-tuned twin (performer). The score is

    perplexity(text | performer)  /  cross-perplexity(observer, performer)

i.e. how surprising the text is, normalised by how surprising the observer finds the performer's
own predictions. Model text sits low (predictable relative to the pair); human text sits high.
The paper reports 90%+ detection at 0.01% false positives with Falcon-7B / Falcon-7B-instruct.

This runs a smaller pair by default (Qwen2.5-1.5B and -Instruct, ~3 GB each, seconds on Apple
silicon or CPU) so it fits in a laptop tool. Smaller pairs keep the ranking but shift the
absolute values, so the thresholds below were set with calibrate() on this app's own data, not
copied from the paper. What that calibration showed (Sep 2026, 16 texts):

    0.76        generic cover-letter prose ("passion for data", "drive innovation")
    0.90-1.06   the candidate's original resume; the low end is its most boilerplate lines
    1.07-1.21   this app's tailored summaries, bullets, cover letters

In practice the score separates *generic* from *specific* text. The app's outputs read as
human because the prompts force concrete systems, names and numbers, which is also what a
recruiter or a commercial detector responds to. Read the result as a band, not a verdict: short,
jargon-dense resume text is exactly where every detector is least reliable.

Optional: needs `pip install torch transformers`. Without them available() is False and the
API says so instead of failing.
"""
import logging
import os
from dataclasses import asdict, dataclass

log = logging.getLogger("mct.detector")

OBSERVER = os.getenv("MCT_DETECTOR_OBSERVER", "Qwen/Qwen2.5-1.5B")
PERFORMER = os.getenv("MCT_DETECTOR_PERFORMER", "Qwen/Qwen2.5-1.5B-Instruct")
MAX_TOKENS = 512
MIN_WORDS = 40   # below this the score is noise

# From the calibration above. Below LOW reads as model text; above HIGH reads as human; between
# is the grey zone where the tell scanner is the better guide.
LOW = float(os.getenv("MCT_DETECTOR_LOW", "0.85"))
HIGH = float(os.getenv("MCT_DETECTOR_HIGH", "0.95"))

_models = None


def available() -> bool:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
        return True
    except ImportError:
        return False


@dataclass
class Score:
    score: float | None       # Binoculars score; None when the text is too short
    band: str                 # "model-like" | "borderline" | "human-like" | "too short"
    words: int
    observer: str = OBSERVER
    performer: str = PERFORMER

    def as_dict(self) -> dict:
        return asdict(self)


def _load():
    global _models
    if _models is None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        log.info("loading detector pair %s / %s on %s", OBSERVER, PERFORMER, device)
        tok = AutoTokenizer.from_pretrained(OBSERVER)
        obs = AutoModelForCausalLM.from_pretrained(OBSERVER, dtype=dtype).to(device).eval()
        perf = AutoModelForCausalLM.from_pretrained(PERFORMER, dtype=dtype).to(device).eval()
        _models = (tok, obs, perf, device)
    return _models


def binoculars(text: str) -> float:
    """Raw score, following the reference implementation (ahans30/Binoculars)."""
    import torch
    tok, obs, perf, device = _load()
    enc = tok(text, return_tensors="pt", truncation=True, max_length=MAX_TOKENS).to(device)
    with torch.inference_mode():
        o_logits = obs(**enc).logits[0, :-1].float()
        p_logits = perf(**enc).logits[0, :-1].float()
    labels = enc.input_ids[0, 1:]
    # perplexity of the text under the performer
    ppl = torch.nn.functional.cross_entropy(p_logits, labels).item()
    # cross-perplexity: the observer's distribution scored against the performer's log-probs
    x_ppl = -(torch.softmax(o_logits, -1) * torch.log_softmax(p_logits, -1)).sum(-1).mean().item()
    return ppl / x_ppl


def score(text: str) -> Score:
    words = len(text.split())
    if words < MIN_WORDS:
        return Score(None, "too short", words)
    s = round(binoculars(text), 3)
    band = "model-like" if s < LOW else "human-like" if s > HIGH else "borderline"
    return Score(s, band, words)


def calibrate(human: list[str], model: list[str]) -> dict:
    """Score two labelled sets and report where they separate. Used once to set LOW/HIGH."""
    h = sorted(binoculars(t) for t in human if len(t.split()) >= MIN_WORDS)
    m = sorted(binoculars(t) for t in model if len(t.split()) >= MIN_WORDS)
    return {"human": [round(x, 3) for x in h], "model": [round(x, 3) for x in m],
            "human_min": round(h[0], 3) if h else None, "model_max": round(m[-1], 3) if m else None}
