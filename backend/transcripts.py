"""Read real Claude Code session transcripts from ~/.claude/projects.

Each project dir holds *.jsonl transcripts. Assistant records carry a
`message.usage` block; user/title/system records give context (repo, branch,
session title). We fold these into per-session and per-turn summaries that the
three demos consume.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from pricing import context_load, turn_cost

CLAUDE_PROJECTS = Path(os.path.expanduser("~/.claude/projects"))

# 200K-token context window (Opus/Sonnet 4.x) — used for health utilization %.
CONTEXT_WINDOW = 200_000


def _iter_records(path: Path) -> Iterable[dict]:
    with open(path, "r") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _repo_of(cwd: str | None) -> str:
    if not cwd:
        return "unknown"
    return Path(cwd).name or "unknown"


def parse_session(path: Path) -> dict[str, Any] | None:
    """Parse one transcript file into a session summary with per-turn rows."""
    turns: list[dict] = []
    title = ""
    repo = "unknown"
    branch = "unknown"
    model = "unknown"

    for rec in _iter_records(path):
        rtype = rec.get("type")
        if rtype in ("ai-title", "custom-title"):
            # title records carry the human/AI session title in `content`
            t = rec.get("content") or rec.get("title")
            if t:
                title = t
            continue

        msg = rec.get("message") or {}
        usage = msg.get("usage") if isinstance(msg, dict) else None
        if not usage:
            continue

        model = msg.get("model", model)
        repo = _repo_of(rec.get("cwd")) if rec.get("cwd") else repo
        branch = rec.get("gitBranch") or branch
        ts = rec.get("timestamp")
        turns.append(
            {
                "ts": ts,
                "model": model,
                "cost": turn_cost(model, usage),
                "context_load": context_load(usage),
                "output_tokens": usage.get("output_tokens", 0),
                "input_tokens": usage.get("input_tokens", 0),
                "cache_read": usage.get("cache_read_input_tokens", 0),
            }
        )

    if not turns:
        return None

    total_cost = sum(t["cost"] for t in turns)
    peak_load = max(t["context_load"] for t in turns)
    return {
        "session_id": path.stem,
        "title": title or "(untitled session)",
        "repo": repo,
        "branch": branch,
        "model": model,
        "owner": "you",
        "started": turns[0]["ts"],
        "ended": turns[-1]["ts"],
        "turns": turns,
        "turn_count": len(turns),
        "cost": round(total_cost, 4),
        "output_tokens": sum(t["output_tokens"] for t in turns),
        "peak_context_load": peak_load,
        "peak_utilization": round(peak_load / CONTEXT_WINDOW, 4),
        "source": "live",
    }


def load_live_sessions() -> list[dict]:
    """All real sessions found under ~/.claude/projects (may be empty)."""
    if not CLAUDE_PROJECTS.exists():
        return []
    out = []
    for path in sorted(CLAUDE_PROJECTS.glob("**/*.jsonl")):
        parsed = parse_session(path)
        if parsed:
            out.append(parsed)
    return out


def _day(ts: str | None) -> str:
    if not ts:
        return "unknown"
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return "unknown"


def aggregate(sessions: list[dict]) -> dict[str, Any]:
    """Roll sessions up into the cost-dashboard payload (attribution + forecast)."""
    by_repo: dict[str, float] = {}
    by_use_case: dict[str, float] = {}
    by_owner: dict[str, float] = {}
    by_model: dict[str, float] = {}
    by_model_cf: dict[str, float] = {}  # cross-model pipeline runs only
    by_day: dict[str, float] = {}

    for s in sessions:
        by_repo[s["repo"]] = by_repo.get(s["repo"], 0) + s["cost"]
        by_use_case[s["title"]] = by_use_case.get(s["title"], 0) + s["cost"]
        by_owner[s.get("owner", "you")] = by_owner.get(s.get("owner", "you"), 0) + s["cost"]
        is_cross = s.get("model") == "cross-model"
        for t in s["turns"]:
            d = _day(t["ts"])
            by_day[d] = by_day.get(d, 0) + t["cost"]
            label = _model_label(t.get("model", "unknown"))
            by_model[label] = by_model.get(label, 0) + t["cost"]
            if is_cross:
                by_model_cf[label] = by_model_cf.get(label, 0) + t["cost"]

    days = sorted(d for d in by_day if d != "unknown")
    series = [{"day": d, "cost": round(by_day[d], 2)} for d in days]
    forecast = _forecast(series)

    def topn(d: dict[str, float], n: int = 8) -> list[dict]:
        items = sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:n]
        return [{"name": k, "cost": round(v, 2)} for k, v in items]

    total = round(sum(s["cost"] for s in sessions), 2)
    return {
        "total_cost": total,
        "session_count": len(sessions),
        "by_repo": topn(by_repo),
        "by_use_case": topn(by_use_case),
        "by_owner": topn(by_owner),
        "by_model": topn(by_model),
        "by_model_contentforge": topn(by_model_cf),
        "daily": series,
        "forecast": forecast,
    }


def _model_label(model: str) -> str:
    """Human-friendly provider/model label for cross-model attribution."""
    m = (model or "").lower()
    if "gpt-5" in m:
        return "GPT-5 (OpenAI)"
    if "gemini" in m and "flash" in m:
        return "Gemini Flash (Google)"
    if "gemini" in m:
        return "Gemini Pro (Google)"
    if "opus" in m:
        return "Claude Opus"
    if "sonnet" in m:
        return "Claude Sonnet"
    if "haiku" in m:
        return "Claude Haiku"
    return model or "unknown"


def _forecast(series: list[dict], horizon: int = 14) -> dict[str, Any]:
    """Naive run-rate forecast with a +/- band, derived from daily spend."""
    if not series:
        return {"projected_30d": 0, "low": 0, "high": 0, "band": []}
    costs = [p["cost"] for p in series]
    avg = sum(costs) / len(costs)
    # crude volatility band
    var = sum((c - avg) ** 2 for c in costs) / len(costs)
    std = var ** 0.5
    band = []
    running = 0.0
    for i in range(1, horizon + 1):
        running += avg
        spread = std * (i ** 0.5)
        band.append(
            {
                "day": f"+{i}d",
                "expected": round(running, 2),
                "low": round(max(running - spread, 0), 2),
                "high": round(running + spread, 2),
            }
        )
    return {
        "projected_30d": round(avg * 30, 2),
        "run_rate_per_day": round(avg, 2),
        "low": round(max(avg * 30 - std * 30 ** 0.5, 0), 2),
        "high": round(avg * 30 + std * 30 ** 0.5, 2),
        "band": band,
    }
