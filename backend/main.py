"""FastAPI backend for the Claude Code product-improvement prototypes.

Three prototypes, one API:
  /api/cost      -> team cost attribution + forecast (gap #3)
  /api/health/*  -> session health timeline + cleanup preview (gap #2)
  /api/workflow  -> parse a workflow script into a DAG (gap #1)

Data source toggle: ?source=live (real ~/.claude transcripts),
?source=sample (synthetic team), or ?source=all (both merged).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from health import session_health
from sample_data import build_team_sessions
from transcripts import aggregate, load_live_sessions
from workflow_parse import EXAMPLES, SAMPLE_WORKFLOW, parse_workflow

app = FastAPI(title="Claude Code Product Improvement Prototypes")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_sessions(source: str) -> list[dict]:
    live = load_live_sessions()
    sample = build_team_sessions()
    if source == "live":
        return live or sample  # fall back so the demo is never empty
    if source == "sample":
        return sample
    return live + sample  # "all"


@app.get("/api/meta")
def meta() -> dict:
    live = load_live_sessions()
    return {
        "live_sessions": len(live),
        "has_live": len(live) > 0,
        "live_repos": sorted({s["repo"] for s in live}),
    }


@app.get("/api/cost")
def cost(source: str = "all") -> dict:
    return aggregate(get_sessions(source))


@app.get("/api/sessions")
def sessions(source: str = "all") -> list[dict]:
    # lightweight list (no per-turn payload)
    out = []
    for s in get_sessions(source):
        out.append(
            {k: v for k, v in s.items() if k != "turns"}
            | {"turns_available": s["turn_count"]}
        )
    return sorted(out, key=lambda s: s["cost"], reverse=True)


@app.get("/api/health/{session_id}")
def health_one(session_id: str, source: str = "all") -> dict:
    for s in get_sessions(source):
        if s["session_id"] == session_id:
            return session_health(s)
    return {"error": "not found"}


@app.get("/api/health")
def health_default(source: str = "all") -> dict:
    """Health of the most demonstrative session (prefers the hero, else the
    highest-utilization session)."""
    sessions_ = get_sessions(source)
    if not sessions_:
        return {"error": "no sessions"}
    hero = next((s for s in sessions_ if s["session_id"] == "demo-hero"), None)
    chosen = hero or max(sessions_, key=lambda s: s["peak_utilization"])
    return session_health(chosen)


class WorkflowReq(BaseModel):
    script: str | None = None


@app.post("/api/workflow")
def workflow(req: WorkflowReq) -> dict:
    return parse_workflow(req.script or SAMPLE_WORKFLOW)


@app.get("/api/workflow/sample")
def workflow_sample() -> dict:
    return {"script": SAMPLE_WORKFLOW, "graph": parse_workflow(SAMPLE_WORKFLOW)}


@app.get("/api/workflow/examples")
def workflow_examples() -> dict:
    """Selectable example workflows (real pilots) for the Composer switcher."""
    return {
        "examples": [
            {"id": e["id"], "name": e["name"], "description": e["description"],
             "script": e["script"], "graph": parse_workflow(e["script"])}
            for e in EXAMPLES
        ]
    }


# Serve the built frontend if present (single-binary demo).
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="static")
