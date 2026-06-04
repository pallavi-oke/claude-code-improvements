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
    """Return {nodes, edges, phases} describing the workflow structure."""
    nodes: list[dict] = []
    edges: list[dict] = []
    phases: list[str] = _PHASE_RE.findall(script)

    # Detect orchestration constructs (very rough, structure-level)
    has_pipeline = "pipeline(" in script
    has_parallel = "parallel(" in script

    # Each agent() call becomes a node; we infer its phase by nearest preceding phase().
    agent_iter = list(_re_with_pos(_AGENT_RE, script))
    phase_positions = [(m.start(), m.group(1)) for m in _PHASE_RE.finditer(script)]

    def phase_for(pos: int) -> str:
        current = phases[0] if phases else "main"
        for p_pos, name in phase_positions:
            if p_pos <= pos:
                current = name
            else:
                break
        return current

    start = {"id": "start", "type": "input", "label": "Input", "phase": ""}
    nodes.append(start)
    prev_by_phase: dict[str, str] = {}
    last_node = "start"

    for i, m in enumerate(agent_iter):
        nid = f"agent{i}"
        prompt = m.group(2).strip().replace("\n", " ")
        short = (prompt[:48] + "…") if len(prompt) > 48 else prompt
        ph = phase_for(m.start())
        nodes.append(
            {
                "id": nid,
                "type": "agent",
                "label": short or f"agent {i+1}",
                "phase": ph,
                "parallel": has_parallel,
            }
        )
        # connect from the previous phase's last node (or start) to model handoffs
        src = prev_by_phase.get(ph) or last_node
        edges.append({"source": src, "target": nid, "branch": False})
        prev_by_phase[ph] = nid
        last_node = nid

    end = {"id": "end", "type": "output", "label": "Result", "phase": ""}
    nodes.append(end)
    if last_node != "start":
        edges.append({"source": last_node, "target": "end", "branch": False})

    return {
        "nodes": nodes,
        "edges": edges,
        "phases": phases,
        "constructs": {
            "pipeline": has_pipeline,
            "parallel": has_parallel,
            "agent_count": len(agent_iter),
        },
    }


def _re_with_pos(rx: re.Pattern, text: str):
    return list(rx.finditer(text))


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
