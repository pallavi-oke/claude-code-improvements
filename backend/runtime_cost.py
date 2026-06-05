"""Run-time cost model for the ContentForge agent (vs. build-time dev spend).

Build-time = what it cost to *build* the agent with Claude Code (from ~/.claude
transcripts). Run-time = what it costs to *operate* the agent in production —
ContentForge's own cross-model calls per article.

This models run-time from ContentForge's real per-node model assignment × the
same indicative list prices used elsewhere. It's illustrative until fed a live
run's usage log, but the per-article math is exactly how you'd compute it for
real: tokens-per-node × price-per-model.
"""

from __future__ import annotations

from pricing import turn_cost
from transcripts import _model_label

# One pass of the 5-node pipeline for a single article (typical token profile).
# Generator/Reviewer handle full article text, so they're heavier.
NODE_PROFILE = [
    {"node": "Scorer",    "model": "gemini/gemini-2.5-flash", "in": 3500, "out": 700,  "cache_read": 4000},
    {"node": "Planner",   "model": "openai/gpt-5",            "in": 3500, "out": 1200, "cache_read": 6000},
    {"node": "Validator", "model": "claude-opus-4-8",         "in": 3500, "out": 700,  "cache_read": 8000},
    {"node": "Generator", "model": "openai/gpt-5",            "in": 6500, "out": 2600, "cache_read": 12000},
    {"node": "Reviewer",  "model": "gemini/gemini-3-pro",     "in": 6500, "out": 2600, "cache_read": 12000},
]


def _node_costs() -> list[dict]:
    out = []
    for p in NODE_PROFILE:
        usage = {
            "input_tokens": p["in"],
            "output_tokens": p["out"],
            "cache_read_input_tokens": p["cache_read"],
            "cache_creation_input_tokens": 0,
        }
        out.append(
            {
                "node": p["node"],
                "model": _model_label(p["model"]),
                "cost": turn_cost(p["model"], usage),
            }
        )
    return out


def runtime(articles_per_month: int = 5000) -> dict:
    nodes = _node_costs()
    per_article = sum(n["cost"] for n in nodes)

    by_model: dict[str, float] = {}
    for n in nodes:
        by_model[n["model"]] = by_model.get(n["model"], 0) + n["cost"]

    def scaled(d):
        return sorted(
            [{"name": k, "cost": round(v * articles_per_month, 2)} for k, v in d.items()],
            key=lambda x: x["cost"],
            reverse=True,
        )

    return {
        "per_article": round(per_article, 4),
        "articles_per_month": articles_per_month,
        "monthly": round(per_article * articles_per_month, 2),
        "annual": round(per_article * articles_per_month * 12, 2),
        "by_node": [
            {"name": f"{n['node']} · {n['model']}", "cost": round(n["cost"] * articles_per_month, 2)}
            for n in nodes
        ],
        "by_model": scaled(by_model),
        # per-article breakdown (unit economics), unscaled
        "unit_by_node": [
            {"name": f"{n['node']} · {n['model']}", "cost": round(n["cost"], 4)} for n in nodes
        ],
    }
