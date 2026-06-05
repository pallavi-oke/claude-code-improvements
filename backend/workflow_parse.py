"""Parse a Claude Code Workflow script into a DAG for the Composer/Inspector.

Claude Code workflows are JS scripts using agent()/parallel()/pipeline()/phase().
You only ever *watch* them run — never see the structure first. This lightweight
parser extracts phases, agents, and the parallel/pipeline structure so the UI can
render the dependency graph BEFORE execution (pain point #1).

This is a pragmatic regex/structure parser for demo purposes, not a full JS AST.
"""

from __future__ import annotations

import re
from typing import Any

_PHASE_RE = re.compile(r"phase\(\s*['\"]([^'\"]+)['\"]\s*\)")
_AGENT_RE = re.compile(r"agent\(\s*([`'\"])(.+?)\1", re.DOTALL)
_LABEL_RE = re.compile(r"label:\s*['\"`]([^'\"`]+)['\"`]")


def parse_workflow(script: str) -> dict[str, Any]:
    """Return {nodes, edges, phases} describing the workflow structure.

    Agents are grouped by their enclosing phase(); each phase fans OUT from the
    previous phase's exit node(s) and fans BACK IN to the next phase. So a phase
    with multiple agents — a conditional branch (if/else) or a parallel fan-out —
    renders as diverging arrows rather than a single chain.
    """
    nodes: list[dict] = [{"id": "start", "type": "input", "label": "Input", "phase": ""}]
    edges: list[dict] = []
    phases: list[str] = _PHASE_RE.findall(script)

    # Detect orchestration constructs (structure-level, regex-based).
    has_pipeline = "pipeline(" in script
    has_parallel = "parallel(" in script
    has_conditional = bool(re.search(r"\bif\s*\(", script))

    phase_positions = [(m.start(), m.group(1)) for m in _PHASE_RE.finditer(script)]

    def phase_for(pos: int) -> str:
        current = phases[0] if phases else "main"
        for p_pos, name in phase_positions:
            if p_pos <= pos:
                current = name
            else:
                break
        return current

    # Build agent nodes, grouped by phase in order of first appearance.
    ordered_phases: list[str] = []
    grouped: dict[str, list[str]] = {}
    for i, m in enumerate(_AGENT_RE.finditer(script)):
        nid = f"agent{i}"
        prompt = m.group(2).strip().replace("\n", " ")
        short = (prompt[:48] + "…") if len(prompt) > 48 else prompt
        ph = phase_for(m.start())
        nodes.append({"id": nid, "type": "agent", "label": short or f"agent {i+1}", "phase": ph})
        if ph not in grouped:
            grouped[ph] = []
            ordered_phases.append(ph)
        grouped[ph].append(nid)

    agent_count = sum(len(v) for v in grouped.values())

    # Fan out / fan in per phase.
    prev_exit: list[str] = ["start"]
    for ph in ordered_phases:
        members = grouped[ph]
        multi = len(members) > 1
        if multi and has_parallel:
            kind = "parallel"
        elif multi and has_conditional:
            kind = "branch"
        else:
            kind = "seq"
        for nid in members:
            for src in prev_exit:
                edges.append({"source": src, "target": nid, "kind": kind})
            node = next(n for n in nodes if n["id"] == nid)
            node["parallel"] = kind == "parallel"
            node["branch"] = kind == "branch"
        prev_exit = members

    nodes.append({"id": "end", "type": "output", "label": "Result", "phase": ""})
    for src in prev_exit:
        if src != "start":
            edges.append({"source": src, "target": "end", "kind": "seq"})

    return {
        "nodes": nodes,
        "edges": edges,
        "phases": phases,
        "constructs": {
            "pipeline": has_pipeline,
            "parallel": has_parallel,
            "conditional": has_conditional,
            "agent_count": agent_count,
        },
    }


SAMPLE_WORKFLOW = """export const meta = {
  name: 'contentforge-pipeline',
  description: 'ContentForge — 5-agent cross-model content pipeline with two compliance gates',
  phases: [
    { title: 'Score' }, { title: 'Plan' }, { title: 'Validate' },
    { title: 'Generate' }, { title: 'Review' },
  ],
}

phase('Score')
const scored = await agent('Scorer (Gemini Flash): rate keyword viability & intent', {label: 'scorer'})
if (!scored.viable) return 'dropped: low commercial value'   // gate 1

phase('Plan')
const outlines = await agent('Planner (GPT-5): generate 3 distinct SEO outlines', {label: 'planner'})

phase('Validate')
const checked = await agent('Validator (Claude): AI-Eval gate on the outlines', {label: 'validator'})
if (!checked.passed) return 'dropped: outline failed validation'   // gate 2

phase('Generate')
const draft = await agent('Generator (GPT-5 + RAG): draft article grounded in policy docs', {label: 'generator'})

phase('Review')
const verdict = await agent('Reviewer / Sheriff (Gemini): compliance gate vs policy', {label: 'reviewer'})
return verdict.passed ? 'published' : 'blocked: policy violations'
"""

# Kept for reference: the previous generic example.
REVIEW_WORKFLOW = """export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, then verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

phase('Review')
const bugs = await agent('Find correctness bugs in the diff', {label: 'review:bugs'})
const perf = await agent('Find performance issues in the diff', {label: 'review:perf'})
const sec  = await agent('Find security issues in the diff', {label: 'review:security'})

phase('Verify')
const verified = await parallel(findings.map(f => () =>
  agent('Adversarially verify: ' + f.title, {label: 'verify'})))

phase('Synthesize')
const report = await agent('Synthesize confirmed findings into a report', {label: 'synthesize'})
return report
"""


# A second real pilot — MerchantMind / Sentinel Vantage — to show the Composer
# generalizes. Note the conditional governance branch in the 'Reason' phase.
SENTINEL_WORKFLOW = """export const meta = {
  name: 'sentinel-vantage',
  description: 'MerchantMind / Sentinel Vantage — voice-first agentic rewards analysis with hard-enforced governance',
  phases: [
    { title: 'Transcribe' }, { title: 'Route' }, { title: 'Reason' },
    { title: 'Visualize' }, { title: 'Synthesize' },
  ],
}

phase('Transcribe')
const query = await agent('Transcribe voice query — Gemini 2.5 Pro (auto-discovery failover)', {label: 'transcribe'})

phase('Route')
const route = await agent('Detect governance triggers / PII in the query', {label: 'router'})

phase('Reason')
// Path A — query is safe -> Analyst
const insight = await agent('Victoria · Analyst (Gemini 2.5 Pro): lead-with-numbers insight', {label: 'analyst'})
// Path B — PII detected -> bypass Analyst, route to Sheriff
if (route.pii) {
  const safe = await agent('Mike · Sheriff (Claude Opus): privacy-safe team-level alternative', {label: 'sheriff'})
}

phase('Visualize')
const chart = await agent('Voice-to-Viz: select optimal Plotly chart (bar/line)', {label: 'viz'})

phase('Synthesize')
const voice = await agent('ElevenLabs Turbo v2.5: synthesize distinct agent voice', {label: 'voice'})
return voice
"""


# Registry of selectable examples for the Composer's "Load example" switcher.
EXAMPLES = [
    {
        "id": "contentforge",
        "name": "ContentForge",
        "description": "5-agent cross-model content pipeline with two compliance gates",
        "script": SAMPLE_WORKFLOW,
    },
    {
        "id": "sentinel",
        "name": "Sentinel Vantage",
        "description": "Voice-first agentic rewards analysis with a PII→Sheriff governance branch",
        "script": SENTINEL_WORKFLOW,
    },
    {
        "id": "review",
        "name": "Code Review",
        "description": "Parallel multi-dimension review → adversarial verify → synthesize",
        "script": REVIEW_WORKFLOW,
    },
]
