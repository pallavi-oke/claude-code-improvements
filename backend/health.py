"""Session-health signal (pain point #2).

Turns a session's per-turn context load into a health timeline with zones and a
*pre-emptive* warning point — the turn at which the model recommends cleanup,
fired BEFORE the high-risk zone, not after quality has already dropped.
"""

from __future__ import annotations

from typing import Any

from transcripts import CONTEXT_WINDOW

# Utilization thresholds (fraction of context window).
HEALTHY = 0.45
CAUTION = 0.65
HIGH_RISK = 0.80


def zone(util: float) -> str:
    if util < HEALTHY:
        return "healthy"
    if util < CAUTION:
        return "caution"
    if util < HIGH_RISK:
        return "elevated"
    return "high_risk"


def session_health(session: dict[str, Any]) -> dict[str, Any]:
    timeline = []
    warning_turn = None
    for i, t in enumerate(session["turns"]):
        util = t["context_load"] / CONTEXT_WINDOW
        z = zone(util)
        timeline.append(
            {
                "turn": i + 1,
                "ts": t["ts"],
                "context_load": t["context_load"],
                "utilization": round(util, 4),
                "zone": z,
            }
        )
        # warn the first time we cross into 'caution' — i.e. before high risk
        if warning_turn is None and util >= CAUTION:
            warning_turn = i + 1

    peak = max((p["utilization"] for p in timeline), default=0)
    current = timeline[-1]["utilization"] if timeline else 0
    return {
        "session_id": session["session_id"],
        "title": session["title"],
        "turn_count": session["turn_count"],
        "timeline": timeline,
        "current_utilization": round(current, 4),
        "peak_utilization": round(peak, 4),
        "current_zone": zone(current),
        "warning_turn": warning_turn,
        "thresholds": {"healthy": HEALTHY, "caution": CAUTION, "high_risk": HIGH_RISK},
        "cleanup_preview": _cleanup_preview(session),
    }


def _cleanup_preview(session: dict[str, Any]) -> dict[str, Any]:
    """What 'smart cleanup' would preserve vs. compact.

    Illustrative: preserves decisions/constraints/memory, compacts bulky
    tool output and superseded exploration. Numbers are estimated from load.
    """
    peak = session.get("peak_context_load", 0)
    reclaimable = int(peak * 0.45)
    return {
        "preserve": [
            "Key decisions & rationale",
            "Active constraints (AWS, cross-model, pgvector)",
            "Project memory & open TODOs",
            "Current file/working state",
        ],
        "compact": [
            "Verbose tool output & file dumps",
            "Superseded exploration paths",
            "Resolved sub-threads",
        ],
        "estimated_reclaim_tokens": reclaimable,
        "estimated_reclaim_pct": 45,
    }
