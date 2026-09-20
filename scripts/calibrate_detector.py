"""Measure how well the local Binoculars pair separates human from model text in the
"describe yourself for a job" genre, and print the band edges detector.py should use.

    PYTHONPATH=. python scripts/calibrate_detector.py [--pair Qwen/Qwen2.5-3B Qwen/Qwen2.5-3B-Instruct]

Samples:
  data/samples/human/  40 self-descriptions from Hacker News "Who wants to be hired?" threads,
                       2019-2021, i.e. written before ChatGPT existed. Public comments; each file
                       carries its URL.
  data/samples/model/  20 written by the app's model for the same genre: 10 from a plain prompt,
                       10 told to be specific (named tools, employers, numbers, no buzzwords).

Band edges are set where the data supports a claim: LOW = just under the lowest human score
(nothing human scored below it), HIGH = above the 90th percentile of model scores. Everything
between is reported as borderline.
"""
import glob
import os
import statistics
import sys

if "--pair" in sys.argv:
    i = sys.argv.index("--pair")
    os.environ["MCT_DETECTOR_OBSERVER"], os.environ["MCT_DETECTOR_PERFORMER"] = sys.argv[i + 1], sys.argv[i + 2]

from app.core import detector, tells  # noqa: E402  (after the env override)


def load(pattern):
    return [(f.rsplit("/", 1)[-1], open(f).read().split("\n\n", 1)[1].strip()) for f in sorted(glob.glob(pattern))]


human, model = load("data/samples/human/*.txt"), load("data/samples/model/*.txt")
print(f"pair: {detector.OBSERVER} / {detector.PERFORMER}")
hs = sorted(detector.binoculars(t) for _, t in human)
ms = sorted((detector.binoculars(t), n) for n, t in model)
mv = [s for s, _ in ms]
print(f"human n={len(hs)}  min {hs[0]:.3f}  median {statistics.median(hs):.3f}  max {hs[-1]:.3f}")
print(f"model n={len(mv)}  min {mv[0]:.3f}  median {statistics.median(mv):.3f}  p90 {mv[int(len(mv) * .9)]:.3f}  max {mv[-1]:.3f}")
print("  generic :", [round(s, 3) for s, n in ms if n.startswith("generic")])
print("  specific:", [round(s, 3) for s, n in ms if n.startswith("specific")])
grid = [x / 1000 for x in range(700, 1300)]
acc, thr = max(((sum(s >= t for s in hs) + sum(s < t for s in mv)) / (len(hs) + len(mv)), t) for t in grid)
print(f"best single threshold {thr:.3f} -> accuracy {acc:.0%}")
low, high = round(hs[0] - 0.005, 3), round(mv[int(len(mv) * .9)] + 0.005, 3)
print(f"suggested bands: model-like < {low}  |  borderline  |  human-like > {high}")
print(f"  model-like catches {sum(s < low for s in mv)}/{len(mv)} model, 0/{len(hs)} human")
print(f"  human-like admits {sum(s > high for s in mv)}/{len(mv)} model, {sum(s > high for s in hs)}/{len(hs)} human")
th = [tells.scan(t).score for _, t in human]
print(f"tell scanner: human median {statistics.median(th):.0f} (max {max(th)}) | model generic",
      sorted(tells.scan(t).score for n, t in model if n.startswith("generic")), "| specific",
      sorted(tells.scan(t).score for n, t in model if n.startswith("specific")))
