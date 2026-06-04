"""Deterministic synthetic 'team' dataset.

Real ~/.claude history is usually a single user. To demo *team* cost attribution
and forecasting we synthesize a believable multi-engineer org spanning several
repos, use cases, and days. Fully deterministic (seeded) so the demo is stable.
"""

from __future__ import annotations

from pricing import turn_cost

# Deterministic pseudo-random walk (no Math.random equivalent needed).
def _lcg(seed: int):
    x = seed
    while True:
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        yield x / 0x7FFFFFFF


_OWNERS = ["amir", "blair", "chen", "dana", "evan"]
_REPOS = ["contentforge-cc", "payments-api", "web-dashboard", "ml-pipeline", "infra-iac"]
_USE_CASES = [
    "Feature implementation",
    "Bug investigation",
    "Code review",
    "Test generation",
    "Refactor / cleanup",
    "Docs & onboarding",
]
_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]
_BASE_DATE = "2026-05-21"  # demo window start


def _date_plus(days: int) -> str:
    from datetime import date, timedelta

    y, m, d = (int(x) for x in _BASE_DATE.split("-"))
    return (date(y, m, d) + timedelta(days=days)).isoformat()


def build_team_sessions() -> list[dict]:
    rng = _lcg(42)
    sessions: list[dict] = []
    sid = 0
    for day in range(14):  # two weeks
        n_sessions = 3 + int(next(rng) * 4)
        for _ in range(n_sessions):
            sid += 1
            owner = _OWNERS[int(next(rng) * len(_OWNERS))]
            repo = _REPOS[int(next(rng) * len(_REPOS))]
            use_case = _USE_CASES[int(next(rng) * len(_USE_CASES))]
            model = _MODELS[0] if next(rng) > 0.55 else _MODELS[1 + int(next(rng) * 2)]
            n_turns = 8 + int(next(rng) * 40)

            turns = []
            ctx = 18_000 + int(next(rng) * 8000)
            ts = f"{_date_plus(day)}T{9 + int(next(rng) * 8):02d}:00:00Z"
            for _t in range(n_turns):
                out = 500 + int(next(rng) * 2500)
                cache_read = ctx
                inp = 4000 + int(next(rng) * 5000)
                usage = {
                    "input_tokens": inp,
                    "output_tokens": out,
                    "cache_read_input_tokens": cache_read,
                    "cache_creation_input_tokens": int(next(rng) * 3000),
                }
                turns.append(
                    {
                        "ts": ts,
                        "model": model,
                        "cost": turn_cost(model, usage),
                        "context_load": inp + cache_read,
                        "output_tokens": out,
                        "input_tokens": inp,
                        "cache_read": cache_read,
                    }
                )
                ctx += 1200 + int(next(rng) * 2600)  # context grows over the session

            total_cost = sum(t["cost"] for t in turns)
            peak = max(t["context_load"] for t in turns)
            sessions.append(
                {
                    "session_id": f"team-{sid:03d}",
                    "title": use_case,
                    "repo": repo,
                    "branch": "main" if next(rng) > 0.4 else "feature/wip",
                    "model": model,
                    "owner": owner,
                    "started": turns[0]["ts"],
                    "ended": turns[-1]["ts"],
                    "turns": turns,
                    "turn_count": len(turns),
                    "cost": round(total_cost, 4),
                    "output_tokens": sum(t["output_tokens"] for t in turns),
                    "peak_context_load": peak,
                    "peak_utilization": round(peak / 200_000, 4),
                    "source": "sample",
                }
            )
    sessions.extend(_contentforge_sessions())
    sessions.append(_hero_session())
    return sessions


# ContentForge's per-node model assignment (cross-model pipeline).
_CF_NODE_MODELS = [
    ("Scorer", "gemini/gemini-2.5-flash"),
    ("Planner", "openai/gpt-5"),
    ("Validator", "claude-opus-4-8"),
    ("Generator", "openai/gpt-5"),
    ("Reviewer", "gemini/gemini-3-pro"),
]


def _contentforge_sessions() -> list[dict]:
    """Cross-model runs of the ContentForge pipeline, so the Cost tab's
    per-model attribution reflects GPT-5 / Gemini / Claude spend on the
    very system the candidate built."""
    rng = _lcg(7)
    out = []
    for k in range(6):
        owner = _OWNERS[int(next(rng) * len(_OWNERS))]
        n_keywords = 6 + int(next(rng) * 10)  # each keyword runs the 5 nodes
        ts_day = _date_plus(2 + k * 2)
        turns = []
        ctx = 20_000
        for _kw in range(n_keywords):
            for node, model in _CF_NODE_MODELS:
                # generator/reviewer handle long article text -> more tokens
                heavy = node in ("Generator", "Reviewer")
                inp = (6000 if heavy else 3000) + int(next(rng) * 2000)
                out_tok = (2600 if heavy else 700) + int(next(rng) * 1200)
                usage = {
                    "input_tokens": inp,
                    "output_tokens": out_tok,
                    "cache_read_input_tokens": ctx,
                    "cache_creation_input_tokens": int(next(rng) * 2000),
                }
                turns.append(
                    {
                        "ts": f"{ts_day}T{10 + len(turns) % 8:02d}:00:00Z",
                        "model": model,
                        "cost": turn_cost(model, usage),
                        "context_load": inp + ctx,
                        "output_tokens": out_tok,
                        "input_tokens": inp,
                        "cache_read": ctx,
                    }
                )
                ctx += 600
        peak = max(t["context_load"] for t in turns)
        out.append(
            {
                "session_id": f"cf-run-{k+1:02d}",
                "title": "Cross-model content run",
                "repo": "contentforge-cc",
                "branch": "main",
                "model": "cross-model",
                "owner": owner,
                "started": turns[0]["ts"],
                "ended": turns[-1]["ts"],
                "turns": turns,
                "turn_count": len(turns),
                "cost": round(sum(t["cost"] for t in turns), 4),
                "output_tokens": sum(t["output_tokens"] for t in turns),
                "peak_context_load": peak,
                "peak_utilization": round(peak / 200_000, 4),
                "source": "sample",
            }
        )
    return out


def _hero_session() -> dict:
    """A long session that climbs cleanly healthy -> high-risk, for the Health demo.

    The warning fires at the caution crossing (~65%), well before the red zone,
    illustrating a *pre-emptive* signal rather than an after-the-fact one.
    """
    turns = []
    ctx = 22_000          # start comfortably healthy
    step = 2_900          # steady context growth per turn
    for i in range(58):
        inp = 5_000
        cache_read = ctx
        out = 1_400
        usage = {
            "input_tokens": inp,
            "output_tokens": out,
            "cache_read_input_tokens": cache_read,
            "cache_creation_input_tokens": 1_500,
        }
        turns.append(
            {
                "ts": f"2026-06-03T{9 + i // 8:02d}:{(i * 7) % 60:02d}:00Z",
                "model": "claude-opus-4-8",
                "cost": turn_cost("claude-opus-4-8", usage),
                "context_load": inp + cache_read,
                "output_tokens": out,
                "input_tokens": inp,
                "cache_read": cache_read,
            }
        )
        ctx += step
    peak = max(t["context_load"] for t in turns)
    return {
        "session_id": "demo-hero",
        "title": "ContentForge build — 5-agent cross-model pipeline",
        "repo": "contentforge-cc",
        "branch": "main",
        "model": "claude-opus-4-8",
        "owner": "you",
        "started": turns[0]["ts"],
        "ended": turns[-1]["ts"],
        "turns": turns,
        "turn_count": len(turns),
        "cost": round(sum(t["cost"] for t in turns), 4),
        "output_tokens": sum(t["output_tokens"] for t in turns),
        "peak_context_load": peak,
        "peak_utilization": round(peak / 200_000, 4),
        "source": "sample",
    }
