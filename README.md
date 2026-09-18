# Career OS

A personal job-search system that closes the loop between *what the market wants* and *what I can prove*.

Paste a job description and it tells you honestly how well you fit — with evidence — then rewrites your resume for that job, tells you what **not** to claim, tracks the application, aggregates the gaps across every JD you've looked at, builds a learning plan around one portfolio project, and interviews you on your weak spots. When you learn something, the profile updates and every tracked application re-scores.

Built with Python, Streamlit, SQLite, Pydantic and the Claude API. Packaged as a native macOS app.

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
| **Applications** | Pipeline tracker (saved → applied → screening → interview → offer / rejected) with the full analysis attached. Re-score any application after the profile changes. |
| **Gap Analysis** | Every requirement from every tracked JD, weighted by importance and by how far the application progressed. Answers "what should I learn first?" with data from the jobs I'm actually pursuing. |
| **Interview Playground** | Multi-turn mock interview with a recruiter persona that has read the profile, the JD, and the fit assessment — so it goes straight for the gaps. Grades every answer (grade / critique / pro answer). Plus scenario-style MCQs generated from the current gap list, with accuracy tracked per topic. |
| **Learning Center** | A plan generated from the gap analysis: one portfolio project decomposed into per-skill steps, scoped to ≤12 weeks. Resources come from real web search (only URLs the search actually returned). "Mark as learned" promotes the skill in the profile. |
| **Dashboard** | Weekly activity, pipeline funnel, score per application, MCQ trend, plan progress. |

## How the AI parts work

- **Structured extraction everywhere.** Every LLM call returns a Pydantic model (`app/core/llm.py`). The API's constrained-output mode is used when the schema is small enough; large schemas hit the API's grammar-size limit, so `extract()` falls back to schema-in-prompt plus local validation. Same guarantee either way.
- **Judgments in, arithmetic out.** The model never picks the match score. It outputs per-requirement `importance` and `strength`; the score is computed with fixed weights (`app/core/models.py`, `MatchResult.score`). Two runs on the same JD land within a point of each other, and the number is explainable.
- **Evidence-gated claims.** The matcher can only mark a requirement `strong` if the profile has hands-on evidence; the tailor is instructed never to invent experience and to list what the candidate must not claim. Proficiency in the profile is graded from the resume text, not asserted.
- **Cached multi-turn context.** The interview's system prompt (persona + profile + JD + fit assessment) carries a `cache_control` breakpoint, so every turn after the first re-reads it from cache. Responses stream token-by-token into the chat.
- **Real links only.** The learning resources call uses the `web_search` server tool, collects the URLs the search returned, and has the model rank *those* — anything not in the returned set is dropped.
- **One model, effort as the dial.** Everything runs on `claude-opus-5`; per-call `effort` (`low` for ranking, `medium` for chat, `high` for matching/tailoring) is the cost/quality lever instead of a model cascade.

## Stack

Python 3.14 · Streamlit · SQLite (no ORM, JSON columns hold the Pydantic objects) · Pydantic v2 · Anthropic SDK · Altair · pywebview (native window) · pypdf

## Running it

```bash
git clone <this repo> && cd MYCAREERTRACKER
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then paste your Anthropic API key into .env
./run.sh                        # browser
# or, on macOS:
./packaging/build_mac_app.sh    # creates ~/Applications/CareerOS.app
```

First run: go to **Profile → Build from resume**, upload a PDF, and set the target role. Everything else reads from that profile.

Personal data (`data/master_profile.json`, `data/career.db`, `data/learning_plan.json`, `.env`) is gitignored. Three sample JDs live in `data/samples/` for trying the matcher.

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
  ui/
    dashboard.py   Streamlit app (all pages)
    charts.py      Altair chart builders
  desktop.py       native-window launcher
connectors/        resume PDF → text
learning_engine/   plan generation, web-search resources, mark_learned
prompts/           every system prompt, as plain text files
packaging/         macOS .app bundle builder + icon
```

## Status

Personal tool, actively used. Single-user by design. Not a distributable installer — the Mac app is a launcher pointing at this checkout.
