"""Compare the 5-agent ContentForge pipeline against monolithic baselines.

The key question this answers: "Multi-agent costs N× more per article — is it
worth it?" Surfaces three things:
  1. The 5-agent cost across three Validator tiers (Opus / Sonnet / Haiku),
     so the biggest optimization lever is interactive.
  2. Monolithic baselines (Flash, GPT-5, Opus, with and without prompt caching,
     plus a "fair" GPT-5 generation + Opus compliance-review variant).
  3. A breakeven framing: how many compliance violations must the multi-agent
     pipeline prevent per month to justify the cost delta.

All math is `tokens × list price` via the same router as everything else, so
swapping prices in `pricing.py` reflects here too.
"""

from __future__ import annotations

from pricing import turn_cost

# ----------------------------------------------------------------------------
# 5-agent profile — Validator is the only variable
# ----------------------------------------------------------------------------
FIXED_NODES = [
    {"node": "Scorer",    "model": "gemini/gemini-2.5-flash", "in": 3500, "out": 700,  "cache_read": 4000},
    {"node": "Planner",   "model": "openai/gpt-5",            "in": 3500, "out": 1200, "cache_read": 6000},
    {"node": "Generator", "model": "openai/gpt-5",            "in": 6500, "out": 2600, "cache_read": 12000},
    {"node": "Reviewer",  "model": "gemini/gemini-3-pro",     "in": 6500, "out": 2600, "cache_read": 12000},
]

VALIDATOR_PROFILE = {"in": 3500, "out": 700, "cache_read": 8000}
VALIDATOR_MODELS = {
    "opus":   ("claude-opus-4-8",   "Claude Opus"),
    "sonnet": ("claude-sonnet-4-6", "Claude Sonnet"),
    "haiku":  ("claude-haiku-4-5",  "Claude Haiku"),
}

# ----------------------------------------------------------------------------
# Monolithic single-call profile (typical for a 2K-articles/day scenario)
# ----------------------------------------------------------------------------
MONO_INPUT_FRESH = 1000   # per-article dynamic input (keyword, meta)
MONO_INPUT_CACHED = 8000  # system prompt + policy doc, cacheable
MONO_OUTPUT = 2000        # full article + brief self-check


def _usage(in_, out_, cache_read=0):
    return {
        "input_tokens": in_,
        "output_tokens": out_,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": 0,
    }


def _five_agent_per_article(validator_tier: str) -> float:
    total = 0.0
    for n in FIXED_NODES:
        total += turn_cost(n["model"], _usage(n["in"], n["out"], n["cache_read"]))
    v_id, _ = VALIDATOR_MODELS[validator_tier]
    v = VALIDATOR_PROFILE
    total += turn_cost(v_id, _usage(v["in"], v["out"], v["cache_read"]))
    return total


def _monolithic_per_article(model: str, cached: bool) -> float:
    if cached:
        u = _usage(MONO_INPUT_FRESH, MONO_OUTPUT, MONO_INPUT_CACHED)
    else:
        u = _usage(MONO_INPUT_FRESH + MONO_INPUT_CACHED, MONO_OUTPUT, 0)
    return turn_cost(model, u)


def _gpt5_plus_opus_review_per_article() -> float:
    """A 'fair' monolithic: GPT-5 generates, Opus does an independent compliance pass."""
    gen = _monolithic_per_article("openai/gpt-5", cached=True)
    # Opus reviewer reads the article (~3k) with policy cached (~8k), emits ~300-tok verdict
    review = turn_cost("claude-opus-4-8", _usage(3000, 300, 8000))
    return gen + review


# Ordered list of monolithic options to compare against
MONOLITHIC_OPTIONS = [
    {"id": "flash-cached", "name": "Gemini Flash + cache",            "kind": "single",   "model": "gemini/gemini-2.5-flash", "cached": True,  "has_compliance": False},
    {"id": "gpt5-cached",  "name": "GPT-5 + cache",                   "kind": "single",   "model": "openai/gpt-5",            "cached": True,  "has_compliance": False},
    {"id": "gpt5",         "name": "GPT-5 (no cache)",                "kind": "single",   "model": "openai/gpt-5",            "cached": False, "has_compliance": False},
    {"id": "pro-cached",   "name": "Gemini Pro + cache",              "kind": "single",   "model": "gemini/gemini-3-pro",     "cached": True,  "has_compliance": False},
    {"id": "opus",         "name": "Claude Opus (no cache)",          "kind": "single",   "model": "claude-opus-4-8",         "cached": False, "has_compliance": False},
    {"id": "gpt5-opus-review", "name": "GPT-5 + Opus compliance pass", "kind": "compound", "has_compliance": True},
]


def compare(articles_per_month: int, validator_tier: str = "opus") -> dict:
    if validator_tier not in VALIDATOR_MODELS:
        validator_tier = "opus"

    # 5-agent at every validator tier
    tiers = []
    for tid in ("opus", "sonnet", "haiku"):
        per = _five_agent_per_article(tid)
        tiers.append({
            "id": tid,
            "validator": VALIDATOR_MODELS[tid][1],
            "per_article": round(per, 4),
            "monthly": round(per * articles_per_month, 2),
            "annual": round(per * articles_per_month * 12, 2),
        })
    current = next(t for t in tiers if t["id"] == validator_tier)

    # Monolithic options
    monos = []
    for opt in MONOLITHIC_OPTIONS:
        if opt["kind"] == "compound":
            per = _gpt5_plus_opus_review_per_article()
        else:
            per = _monolithic_per_article(opt["model"], opt["cached"])
        monos.append({
            "id": opt["id"],
            "name": opt["name"],
            "kind": opt["kind"],
            "has_compliance": opt["has_compliance"],
            "per_article": round(per, 4),
            "monthly": round(per * articles_per_month, 2),
            "annual": round(per * articles_per_month * 12, 2),
        })

    # Unified, sorted comparison rows for the chart
    rows = [
        {
            "name": f"5-agent · {t['validator']} validator",
            "kind": "5-agent",
            "per_article": t["per_article"],
            "monthly": t["monthly"],
            "selected": t["id"] == validator_tier,
            "has_compliance": True,  # 5-agent always has compliance
        }
        for t in tiers
    ] + [
        {
            "name": m["name"],
            "kind": "monolithic",
            "per_article": m["per_article"],
            "monthly": m["monthly"],
            "selected": False,
            "has_compliance": m["has_compliance"],
        }
        for m in monos
    ]
    rows.sort(key=lambda r: r["monthly"], reverse=True)

    # Lever savings — Opus -> Sonnet / Haiku
    opus = next(t for t in tiers if t["id"] == "opus")
    sonnet = next(t for t in tiers if t["id"] == "sonnet")
    haiku = next(t for t in tiers if t["id"] == "haiku")
    savings = {
        "opus_to_sonnet_monthly": round(opus["monthly"] - sonnet["monthly"], 2),
        "opus_to_haiku_monthly":  round(opus["monthly"] - haiku["monthly"], 2),
        "opus_to_sonnet_pct":     round((opus["per_article"] - sonnet["per_article"]) / opus["per_article"] * 100, 1),
        "opus_to_haiku_pct":      round((opus["per_article"] - haiku["per_article"]) / opus["per_article"] * 100, 1),
    }

    # Breakeven — vs. the cheapest monolithic option with no compliance
    cheapest_unsafe = min((m for m in monos if not m["has_compliance"]), key=lambda m: m["monthly"])
    fair_baseline = next(m for m in monos if m["id"] == "gpt5-opus-review")
    delta_vs_unsafe = max(round(current["monthly"] - cheapest_unsafe["monthly"], 2), 0)
    delta_vs_fair = max(round(current["monthly"] - fair_baseline["monthly"], 2), 0)
    breakeven = {
        "extra_monthly_vs_unsafe": delta_vs_unsafe,
        "extra_monthly_vs_fair": delta_vs_fair,
        "cheapest_unsafe_name": cheapest_unsafe["name"],
        "fair_baseline_name": fair_baseline["name"],
        "violations_to_breakeven": [
            {"cost_per_violation": v, "needed": round(delta_vs_unsafe / v, 1) if delta_vs_unsafe > 0 else 0}
            for v in (100, 500, 1000, 5000)
        ],
    }

    return {
        "articles_per_month": articles_per_month,
        "articles_per_day": round(articles_per_month / 30, 0),
        "validator_tier": validator_tier,
        "five_agent_current": current,
        "five_agent_tiers": tiers,
        "monolithic": monos,
        "rows": rows,
        "savings": savings,
        "breakeven": breakeven,
    }
