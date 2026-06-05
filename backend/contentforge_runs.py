"""Measure actual ContentForge runs from the original pilot's SSE log dumps.

The original ContentForge at ~/agentContentGen never captured token usage from
Gemini's responses — and several runs were on the free tier, so spend was $0.
But its SSE run logs DO contain the real generated text per node, so we can
measure *output volume* from the logs and price it at list rates. This gives a
defensible "what these runs would have cost on a paid plan" figure — grounded
in the actual outputs, not a model.

Honest caveats baked in:
  * output-only (input tokens were not captured)
  * char-based token estimate (~4 chars/token)
  * the reviewer echoes article text back; we de-dupe by measuring per-node
    unique text only

Reads logs read-only from a fixed path; if the directory isn't there (e.g. on a
fresh laptop) we return an empty result and the UI falls back to the model.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

# Gemini 2.5 indicative list prices (USD per 1M tokens). Output prices only —
# we have no captured input tokens for these runs.
PRICE_OUT_FLASH = 2.50
PRICE_OUT_PRO = 10.00
CHARS_PER_TOKEN = 4

ORIGINAL_LOGS_DIR = Path(
    os.path.expanduser("~/agentContentGen/backend")
)
LOG_FILES = ["full_run_test.txt", "full_run_test_4.txt", "run_test.txt"]


def _measure(raw: str) -> dict:
    """Sum unique output text emitted by each node in one SSE log."""
    by_node = {"scorer": 0, "planner": 0, "validator": 0, "generator": 0, "reviewer": 0}
    counts = {"outlines": 0, "articles": 0, "reviews": 0}

    for m in re.finditer(r"data: (\{.*)", raw):
        try:
            o = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        node = o.get("node")
        st = o.get("state") or {}
        if node == "scorer":
            by_node["scorer"] += len(st.get("score_reasoning", "") or "")
        elif node == "planner":
            outs = st.get("outlines", []) or []
            counts["outlines"] = max(counts["outlines"], len(outs))
            for ol in outs:
                by_node["planner"] += len(ol.get("primary_angle", "") or "")
                for s in ol.get("sections", []) or []:
                    by_node["planner"] += len(s)
        elif node == "validator":
            # validator just emits approved outlines; estimate small overhead
            by_node["validator"] += 80
        elif node == "generator":
            arts = st.get("generated_articles", []) or []
            counts["articles"] = max(counts["articles"], len(arts))
            for a in arts:
                by_node["generator"] += len(a.get("title", "") or "") + len(
                    a.get("content", "") or ""
                )
        elif node == "reviewer":
            revs = st.get("reviews", []) or []
            counts["reviews"] = max(counts["reviews"], len(revs))
            for r in revs:
                by_node["reviewer"] += len(r.get("feedback", "") or "")

    total_chars = sum(by_node.values())
    total_tokens = total_chars // CHARS_PER_TOKEN
    return {
        "by_node_chars": by_node,
        "by_node_tokens": {k: v // CHARS_PER_TOKEN for k, v in by_node.items()},
        "total_output_chars": total_chars,
        "total_output_tokens": total_tokens,
        "counts": counts,
    }


def measured_runs() -> dict:
    """Return per-run measurements + aggregate from the original ContentForge logs."""
    if not ORIGINAL_LOGS_DIR.exists():
        return {"available": False, "runs": [], "aggregate": None}

    runs = []
    for fn in LOG_FILES:
        path = ORIGINAL_LOGS_DIR / fn
        if not path.exists():
            continue
        raw = path.read_text(errors="ignore")
        m = _measure(raw)
        toks = m["total_output_tokens"]
        runs.append(
            {
                "file": fn,
                "output_tokens": toks,
                "cost_flash": round(toks * PRICE_OUT_FLASH / 1e6, 4),
                "cost_pro": round(toks * PRICE_OUT_PRO / 1e6, 4),
                "by_node_tokens": m["by_node_tokens"],
                "articles": m["counts"]["articles"],
                "outlines": m["counts"]["outlines"],
                "reviews": m["counts"]["reviews"],
            }
        )

    if not runs:
        return {"available": False, "runs": [], "aggregate": None}

    avg_tok = sum(r["output_tokens"] for r in runs) // len(runs)
    by_node_avg = {
        k: sum(r["by_node_tokens"].get(k, 0) for r in runs) // len(runs)
        for k in ["scorer", "planner", "validator", "generator", "reviewer"]
    }
    return {
        "available": True,
        "source": "original ContentForge SSE run logs (~/agentContentGen)",
        "runs": runs,
        "aggregate": {
            "run_count": len(runs),
            "avg_output_tokens": avg_tok,
            "avg_cost_flash": round(avg_tok * PRICE_OUT_FLASH / 1e6, 4),
            "avg_cost_pro": round(avg_tok * PRICE_OUT_PRO / 1e6, 4),
            "avg_by_node_tokens": by_node_avg,
            # honest scale-up estimates (output-only is ~30-40% of full cost
            # once you add inputs back in — we conservatively use 2.5x)
            "full_cost_low_2_5x": round(avg_tok * PRICE_OUT_FLASH / 1e6 * 2.5, 4),
            "full_cost_high_2_5x": round(avg_tok * PRICE_OUT_PRO / 1e6 * 2.5, 4),
        },
        "caveats": [
            "Output tokens only — input tokens were not captured by the original pipeline.",
            "Token counts are character-based estimates (~4 chars/token).",
            "Several of these runs hit Gemini free-tier quota — actual billed spend was $0.",
            "The reviewer echoes article text back in the logs; de-duped by measuring per-node unique text only.",
        ],
    }
