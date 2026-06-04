"""Indicative model pricing (USD per 1M tokens).

These are illustrative published list prices used to turn token counts into
dollar figures for the demo. Tune freely — they are isolated here on purpose.
"""

from __future__ import annotations

# (input, output, cache_write, cache_read) per 1M tokens.
# Cross-model: substring-matched against the model id, so "openai/gpt-5",
# "gemini/gemini-3-pro", "claude-opus-4-8" all resolve here.
PRICING: dict[str, tuple[float, float, float, float]] = {
    # Anthropic
    "opus":   (15.0, 75.0, 18.75, 1.50),
    "sonnet": (3.0, 15.0, 3.75, 0.30),
    "haiku":  (0.80, 4.0, 1.0, 0.08),
    # OpenAI
    "gpt-5":  (1.25, 10.0, 1.25, 0.125),
    # Google
    "gemini": (1.25, 10.0, 1.25, 0.31),
}

_DEFAULT = PRICING["sonnet"]


def _rates(model: str) -> tuple[float, float, float, float]:
    m = (model or "").lower()
    for key, rates in PRICING.items():
        if key in m:
            return rates
    return _DEFAULT


def turn_cost(model: str, usage: dict) -> float:
    """Cost in USD for a single assistant turn given its usage block."""
    p_in, p_out, p_cw, p_cr = _rates(model)
    inp = usage.get("input_tokens", 0)
    out = usage.get("output_tokens", 0)
    cw = usage.get("cache_creation_input_tokens", 0)
    cr = usage.get("cache_read_input_tokens", 0)
    return (inp * p_in + out * p_out + cw * p_cw + cr * p_cr) / 1_000_000


def context_load(usage: dict) -> int:
    """Tokens the model actually saw this turn (proxy for context-window pressure)."""
    return usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
