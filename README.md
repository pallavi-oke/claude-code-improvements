# Claude Code · PM Concept Demos

Three product-improvement prototypes for Claude Code, built for a senior PM
interview. Each maps a **named pain point** to a **proposed fix**, and — crucially
— is prototyped against the **real telemetry Claude Code already emits** (its
`~/.claude` JSONL session transcripts: per-turn token usage, model, repo path,
git branch, timestamps), with a synthetic "team" dataset as a fallback so it runs
on any laptop.

| # | Pain point | Prototype |
|---|-----------|-----------|
| 1 | Can watch agents run, but can't shape how they fit together before they start | **Visual Workflow Composer & Inspector** — renders a workflow script as a DAG (phases, handoffs, parallel fan-out) *before* execution; compose steps and watch the graph update |
| 2 | In long sessions, output quality can quietly degrade before you notice | **Active Session Health** — a context-utilization gauge + zone timeline that fires a *pre-emptive* warning before the high-risk zone, plus a smart-cleanup preview that preserves decisions/constraints |
| 3 | As usage scales, spend is hard to attribute, predict, and compare to value | **Team Cost Attribution & Forecasting** — spend by repo / use case / owner + a run-rate forecast with a confidence band |

## Why this is credible (the PM angle)

These are standalone prototypes, **not** edits to Claude Code's closed source.
The differentiator: they read the product's *actual* data surface. Demos 2 and 3
compute real numbers from your `~/.claude` history (e.g. context-load growth,
per-turn cost from token usage × list pricing); demo 1 parses real Workflow-tool
scripts. Toggle the **data source** (Team+You / Sample Team / Live) in the header.

## Architecture

```
backend/   FastAPI — reads ~/.claude transcripts, computes cost/health/forecast,
           parses workflow scripts, and serves the built frontend on one port
frontend/  React + Vite + Tailwind + Recharts + React Flow (3 tabs)
```

## Run (one port)

```bash
# 1. backend
cd backend
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 2. build the frontend once (served by the backend)
cd ../frontend && npm install && npm run build

# 3. launch — open http://localhost:8000
cd ../backend && uvicorn main:app --port 8000
```

For frontend hot-reload during development, run `npm run dev` (port 5180) in a
second terminal — it proxies `/api` to the backend on 8000.

## Demo script (talking points)

1. **Composer** — "Today I write a workflow as code and only *watch* it run. Here
   I see the dependency graph first: three reviewers fan out in parallel, results
   funnel into a verify step, then synthesis. I can add a branch and the graph
   updates *before* I spend a token."
2. **Health** — "This 58-turn session climbs from healthy to 96% context use. The
   warning fires at **turn 37** — *before* the high-risk zone — so I clean up while
   the key decisions are still intact, instead of noticing after output degrades."
3. **Cost** — "Per-session spend is fine for one person. A team lead needs this:
   spend by repo, use case, and engineer, plus a 30-day forecast range — the view
   that unlocks a scale-up decision."

## Notes

- Dollar figures use indicative published list pricing (see `backend/pricing.py`),
  isolated so they're easy to update.
- Zero real spend or API keys involved — everything is computed from local
  transcript token counts.
