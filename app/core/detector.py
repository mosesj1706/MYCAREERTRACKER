"""Binoculars score: the strongest open zero-shot AI-text detector, run locally.

Hans et al., "Spotting LLMs with Binoculars" (ICML 2024). Two sibling models read the text: a
base model (observer) and its instruction-tuned twin (performer). The score is

    perplexity(text | performer)  /  cross-perplexity(observer, performer)

i.e. how surprising the text is, normalised by how surprising the observer finds the performer's
own predictions. Model text sits low (predictable relative to the pair); human text sits high.
The paper reports 90%+ detection at 0.01% false positives with Falcon-7B / Falcon-7B-instruct.

This runs a smaller pair by default (Qwen2.5-1.5B and -Instruct, ~3 GB each, seconds on Apple
silicon or CPU) so it fits in a laptop tool. The band edges were measured, not copied from the
paper: scripts/calibrate_detector.py scores 40 pre-ChatGPT self-descriptions from Hacker News
hiring threads against 20 written by this app's model. Result (Sep 2026, Sonnet 5 text):

    human  0.94-1.16, median 1.02
    model  0.90-1.10, median 1.00     best single threshold: 72% accuracy

That overlap is the honest state of the art for a small pair against a current model. So the
bands only claim what the data supports: below LOW nothing human scored (model-like), above
HIGH almost nothing model scored (human-like), and most text lands in between as borderline.
Generic boilerplate ("passion for data, drive innovation") still scores far below anything
human (0.76). Short resume bullets are not scored at all.

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

# From scripts/calibrate_detector.py. Below LOW nothing human scored; above HIGH almost nothing
# model scored; between is borderline, where the tell scanner is the better guide.
LOW = float(os.getenv("MCT_DETECTOR_LOW", "0.935"))
HIGH = float(os.getenv("MCT_DETECTOR_HIGH", "1.075"))

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


