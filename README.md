# MYCAREERTRACKER

A personal job-search system that closes the loop between *what the market wants* and *what I can prove*.

Paste a job description and it tells you honestly how well you fit — with evidence — then rewrites your resume for that job, tells you what **not** to claim, tracks the application, aggregates the gaps across every JD you've looked at, builds a learning plan around one portfolio project, and interviews you on your weak spots. When you learn something, the profile updates and every tracked application re-scores.

Python + FastAPI backend, React + TypeScript frontend, SQLite, Pydantic, the Claude API. Packaged as a native macOS app.

```
Profile ──► JD match ──► Gaps ──► Learning plan + Mock interviews
   ▲                                            │
   └──────── skill learned / profile updated ◄──┘
                     Tracker records all of it
```

## What it does

| Page | Purpose |
|---|---|
| **Profile** | Built from a resume PDF by LLM extraction. Every skill carries a *proficiency* (`learning` / `familiar` / `hands_on` / `expert`) and the *evidence* that justifies it. Also produces the list of things a recruiter will probe (employment gaps, unevidenced skills, title mismatches). |
| **Resume Tailor** | JD → requirement extraction → per-requirement fit judgment with evidence → deterministic match score → honest verdict. Then: tailored summary, rewritten bullets mapped to specific requirements, a cover letter, and **honesty notes** (what the JD asks for that you must not claim, and what to say instead). |
| **Applications** | Drag-and-drop kanban (saved → applied → screening → interview → offer / rejected) with the full analysis attached to each card. Re-score any application after the profile changes. |
| **Gap Analysis** | Every requirement from every tracked JD, weighted by importance and by how far the application progressed. Answers "what should I learn first?" with data from the jobs I'm actually pursuing. |
| **Interview** | Streamed multi-turn mock interview with a recruiter persona that has read the profile, the JD, and the fit assessment — so it goes straight for the gaps. Grades every answer (grade / critique / pro answer). Plus scenario-style MCQs generated from the current gap list, with accuracy tracked per topic. |
| **Learning** | A plan generated from the gap analysis: one portfolio project decomposed into per-skill steps, scoped to ≤12 weeks. Resources come from real web search (only URLs the search actually returned). "Mark as learned" promotes the skill in the profile. |
| **Add to profile** | A certification, course, project or job, in your own words. The model says what it proves (skills with one-line evidence, the normalised entry, which recruiter risk flags it settles, what it does *not* prove); you review, then it is written with fixed rules: proficiency only rises, a certificate or course alone is capped at *familiar* unless you built something in it, nothing is removed. Then one click re-scores every open application against the new profile and shows each score before → after. |
| **GitHub sync** | Pulls your repositories (languages, file tree, README, commit count) and asks the model what they *prove*. Evidence is attached to skills as `repo-name: what the code shows`; proficiency only ever rises, capped at hands-on, and only where the code visibly uses the skill. Empty repos and forks are ignored; the model also lists what a recruiter will notice on your GitHub (e.g. "no AWS/Terraform code anywhere"). Public repos need no login; `GITHUB_TOKEN` in `.env` adds private repos and a higher rate limit. |
| **Dashboard** | KPIs, learn-next ranking, best current match, weekly activity, pipeline funnel, MCQ trend, plan progress. Dark and light themes; `g`+key keyboard navigation. |

## How the AI parts work

- **Structured extraction everywhere.** Every LLM call returns a Pydantic model (`app/core/llm.py`). The API's constrained-output mode is used when the schema is small enough; large schemas hit the API's grammar-size limit, so `extract()` falls back to schema-in-prompt plus local validation. Same guarantee either way.
- **Judgments in, arithmetic out.** The model never picks the match score. It outputs per-requirement `importance` and `strength`; the score is computed with fixed weights (`app/core/models.py`, `MatchResult.score`). Two runs on the same JD land within a point of each other, and the number is explainable.
- **Evidence-gated claims.** The matcher can only mark a requirement `strong` if the profile has hands-on evidence; the tailor is instructed never to invent experience and to list what the candidate must not claim. Proficiency in the profile is graded from the resume text, not asserted.
- **Cached multi-turn context.** The interview's system prompt (persona + profile + JD + fit assessment) carries a `cache_control` breakpoint, so every turn after the first re-reads it from cache. Responses stream token-by-token over server-sent events into the chat.
- **Real links only.** The learning resources call uses the `web_search` server tool, collects the URLs the search returned, and has the model rank *those* — anything not in the returned set is dropped.
- **One model, effort as the dial.** Everything runs on `claude-opus-5`; per-call `effort` (`low` for ranking, `medium` for chat, `high` for matching/tailoring) is the cost/quality lever instead of a model cascade.

- **Reads as your own.** Resume and LinkedIn text go through `app/core/text.py` (keyboard punctuation only) and a shared voice rule (`prompts/voice.txt`); the PDF carries no library name. Then a check you can run on any output (`app/core/tells.py`): a deterministic scan that names the sentence and the reason (post-2022 excess vocabulary, connective openers, rule-of-three padding, self-praise clauses, even sentence rhythm) plus, optionally, the [Binoculars](https://arxiv.org/abs/2401.12070) score computed locally by a Qwen2.5-3B base/instruct pair (`app/core/detector.py`; `pip install torch transformers`, ~12 GB of weights on first use; env vars select the 1.5B pair for less disk). The bands are measured, not copied from the paper: `scripts/calibrate_detector.py` scores 40 pre-ChatGPT self-descriptions from Hacker News hiring threads (`data/samples/human/`) against 20 the app's model wrote for the same genre (`data/samples/model/`). The two overlap (80% best-case accuracy with the 3B pair, 72% with 1.5B, against Sonnet 5 text), so the UI only calls text model-like below the lowest human score or human-like above the 90th-percentile model score, and reports everything between as borderline. Generic boilerplate still scores far below any human sample. Short resume bullets are not scored at all: every detector is unreliable there. **Fix** sends only the flagged sentences back to the model with the reasons (`prompts/tell_fixer.txt`: every fact stays, nothing added, same line count), rescans, shows before/after, and **Apply** writes the result back into the profile or the application's tailored output.

## Stack

**Backend:** Python 3.14 · FastAPI + uvicorn · SQLite (no ORM, JSON columns hold the Pydantic objects) · Pydantic v2 · Anthropic SDK · pypdf · pywebview (native window)

**Frontend:** React 19 · TypeScript · Vite · Tailwind CSS v4 · TanStack Query · Recharts · dnd-kit · Framer Motion · lucide icons

## Running it

```bash
git clone <this repo> && cd MYCAREERTRACKER
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
(cd frontend && npm install && npm run build)   # needs Node 20+
cp .env.example .env            # then paste your Anthropic API key into .env
./run.sh                        # serves API + built UI on http://127.0.0.1:8765
./run.sh dev                    # hot-reload dev mode (API :8765, Vite :5173)
# or, on macOS:
./packaging/build_mac_app.sh    # creates ~/Applications/MYCAREERTRACKER.app
```

First run: go to **Profile → Build from resume**, upload a PDF, and set the target role. Everything else reads from that profile.

Personal data (`data/master_profile.json`, `data/career.db`, `data/learning_plan.json`, `data/github_repos.json`, `.env`) is gitignored. Four sample JDs live in `data/samples/` for trying the matcher.

## Layout

```
app/
  core/
    llm.py         complete / extract / stream wrapper around the Anthropic SDK
    models.py      all Pydantic schemas (Profile, JobAnalysis, MatchResult, TailoredOutput, LearningPlan, MCQ…)
    profile.py     resume → Profile
    matcher.py     analyze_jd → match → tailor
    tracker.py     applications, status history, aggregate_gaps, rescore
    interview.py   InterviewSession (streamed), MCQ generation, per-topic stats
    analytics.py   dashboard aggregations
    db.py          SQLite schema + connection
  server.py        FastAPI: JSON API + SSE streaming + serves frontend/dist
  desktop.py       native-window launcher
frontend/
  src/pages/       Dashboard, Tailor, Applications, Gaps, Interview, Learning, Profile
  src/components/  ui primitives, charts, drawer, toasts, app shell
  src/lib/api.ts   typed API client + SSE reader
connectors/        resume PDF → text
learning_engine/   plan generation, web-search resources, mark_learned
prompts/           every system prompt, as plain text files
packaging/         macOS .app bundle builder + icon
```

## Status

Personal tool, actively used. Single-user by design. Not a distributable installer — the Mac app is a launcher pointing at this checkout.
