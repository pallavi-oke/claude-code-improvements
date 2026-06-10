"""Agent Governance & Audit — backend data model for the P0 prototype.

What this prototype demonstrates:
  1. A single policy plane — one place to define rules that apply across
     Claude Code's surfaces (CLI commands, MCP servers, plugins, Cowork).
  2. Risky-action gating — high-risk actions are blocked (or in audit-only
     mode, logged with a 'would_block' flag) before they run.
  3. Complete audit trail — every agent action logged with surface,
     command, policy decision, and rationale.
  4. Coverage map — visualizes where policy enforcement reaches today vs.
     where it's stitched together (the slide-7 pain point).
  5. Audit-only -> enforcement graduation — the slide-10 mitigation
     ("start in audit-only mode; enforce after watching real usage").
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from typing import Literal

# ----------------------------------------------------------------------------
# Policies (the rule set)
# ----------------------------------------------------------------------------

# severity: how risky the action is if allowed to run un-gated
# applies_to: which Claude Code surfaces this policy covers
POLICIES = [
    {
        "id": "POL-001",
        "name": "Block prod deployments without approval",
        "category": "Deploy",
        "severity": "critical",
        "applies_to": ["cli", "mcp", "plugins"],
        "rule": "Deny `git push` to main/prod branches and CI/CD deploy MCP calls unless approver != actor.",
        "enabled": True,
    },
    {
        "id": "POL-002",
        "name": "Gate secret/credential access",
        "category": "Secrets",
        "severity": "critical",
        "applies_to": ["cli", "mcp", "plugins", "cowork"],
        "rule": "Require justification + audit log for reads of AWS Secrets Manager, .env, ssh keys, cloud creds.",
        "enabled": True,
    },
    {
        "id": "POL-003",
        "name": "Restrict MCP server installs to allowlist",
        "category": "Supply chain",
        "severity": "high",
        "applies_to": ["mcp", "cowork"],
        "rule": "Only servers on the org allowlist can be added. Block unsigned or unknown publishers.",
        "enabled": True,
    },
    {
        "id": "POL-004",
        "name": "Forbid network egress to non-allowlisted domains",
        "category": "Data exfiltration",
        "severity": "high",
        "applies_to": ["cli", "plugins"],
        "rule": "Block curl/wget/fetch to domains not on the allowlist. Includes outbound webhooks.",
        "enabled": True,
    },
    {
        "id": "POL-005",
        "name": "Require justification for destructive shell commands",
        "category": "Destructive",
        "severity": "high",
        "applies_to": ["cli"],
        "rule": "rm -rf, drop table, force push to shared branches need user justification before execution.",
        "enabled": True,
    },
    {
        "id": "POL-006",
        "name": "Compliance review required for regulated content",
        "category": "Compliance",
        "severity": "medium",
        "applies_to": ["cli", "plugins"],
        "rule": "Any file under /content/{legal,finance,healthcare}/* must pass Sheriff before commit.",
        "enabled": True,
    },
    {
        "id": "POL-007",
        "name": "PII redaction before external API calls",
        "category": "Privacy",
        "severity": "high",
        "applies_to": ["cli", "mcp", "plugins"],
        "rule": "Redact emails, SSN, customer names before outbound model calls if request leaves VPC.",
        "enabled": True,
    },
    {
        "id": "POL-008",
        "name": "Cowork tool permissions follow least-privilege",
        "category": "Access",
        "severity": "medium",
        "applies_to": ["cowork"],
        "rule": "Cowork-launched tools inherit caller role, not session role. Block elevation.",
        "enabled": False,  # not yet enabled — example of "draft policy"
    },
]

# ----------------------------------------------------------------------------
# Surface coverage (the slide-7 pain point: gaps across MCP/plugins/Cowork)
# ----------------------------------------------------------------------------
SURFACES = [
    {
        "id": "cli",
        "name": "Native CLI commands",
        "coverage": 0.95,
        "notes": "Native commands fully gated by policy engine. Bash + git wrapped.",
    },
    {
        "id": "mcp",
        "name": "MCP servers",
        "coverage": 0.72,
        "notes": "Allowlist + signed-publisher checks live. Per-tool permission inheritance still spotty.",
    },
    {
        "id": "plugins",
        "name": "Plugins & subagents",
        "coverage": 0.68,
        "notes": "Permissions flow at install. Runtime tool-use audit landed last sprint; older plugins lag.",
    },
    {
        "id": "cowork",
        "name": "Cowork tools",
        "coverage": 0.41,
        "notes": "Biggest gap. Cowork-launched tools run with session role, not actor role. POL-008 drafted.",
    },
]

# ----------------------------------------------------------------------------
# Audit log — synthetic but deterministic, representative of real ops
# ----------------------------------------------------------------------------
_AUDIT_TEMPLATES = [
    # (surface, command/action, policy_id, decision, rationale)
    ("cli", "git push origin main", "POL-001", "blocked", "Push to protected branch by actor=author; no approver."),
    ("cli", "git push origin staging", "POL-001", "allowed", "Non-prod branch; policy permits."),
    ("mcp", "aws-secrets / get_secret_value", "POL-002", "flagged", "Read of prod credential — justification provided."),
    ("cli", "cat .env.production", "POL-002", "blocked", "Direct read of secrets file. Use vault MCP."),
    ("mcp", "install: unknown-publisher/agent-x", "POL-003", "blocked", "Publisher not on org allowlist."),
    ("mcp", "install: anthropic/postgres-mcp", "POL-003", "allowed", "Allowlisted publisher; signed."),
    ("cli", "curl https://exfil.suspicious.io", "POL-004", "blocked", "Domain not on egress allowlist."),
    ("cli", "rm -rf node_modules/", "POL-005", "allowed", "Scoped to working dir; not shared resource."),
    ("cli", "rm -rf ~/Documents/", "POL-005", "blocked", "Home directory — high blast radius."),
    ("plugins", "commit: /content/healthcare/dosage-guide.md", "POL-006", "flagged", "Healthcare content; Sheriff review queued."),
    ("plugins", "commit: /content/finance/q3-outlook.md", "POL-006", "allowed", "Passed Sheriff compliance gate."),
    ("mcp", "openai-direct / chat.completion (PII detected)", "POL-007", "blocked", "Email + customer name in payload; redact first."),
    ("cli", "git push --force origin feature/x", "POL-005", "flagged", "Force push to shared feature branch."),
    ("cowork", "launch: db-migrate as session role", "POL-008", "flagged", "Role elevation in audit-only — POL-008 not enforced yet."),
    ("mcp", "github-mcp / create_pull_request", "POL-001", "allowed", "Standard PR flow; no protected branch involved."),
    ("plugins", "compliance-scan-skill: full repo", "POL-006", "allowed", "Read-only scan; permitted."),
    ("cli", "DROP TABLE customers", "POL-005", "blocked", "Destructive SQL on prod DB. Use migration MCP."),
    ("mcp", "datadog-mcp / fetch_metrics", "POL-002", "allowed", "Read-only telemetry; no credential exposure."),
    ("plugins", "publish-content-skill: gated content", "POL-006", "blocked", "Article failed Sheriff compliance check."),
    ("cowork", "tool: notion-write to private workspace", "POL-008", "flagged", "Workspace ACL drifted; POL-008 still draft."),
]


def _audit_log(mode: str, surface_filter: str) -> list[dict]:
    """Build a deterministic, recent audit log filtered by surface."""
    now = datetime(2026, 6, 6, 11, 0, 0)
    out = []
    for i, (surface, action, pol_id, decision, rationale) in enumerate(_AUDIT_TEMPLATES):
        if surface_filter not in ("all", surface):
            continue
        ts = now - timedelta(minutes=i * 17 + 3)
        # In audit-only mode, "blocked" decisions become "would_block" (logged, not enforced)
        effective = decision
        if mode == "audit" and decision == "blocked":
            effective = "would_block"
        actor = ["amir", "blair", "chen", "dana", "evan"][_seed(action) % 5]
        repo = ["contentforge-cc", "payments-api", "sentinel-vantage", "web-dashboard", "infra-iac"][_seed(surface + action) % 5]
        out.append({
            "id": f"act_{i:03d}",
            "ts": ts.isoformat() + "Z",
            "surface": surface,
            "actor": actor,
            "repo": repo,
            "action": action,
            "policy_id": pol_id,
            "policy_name": next((p["name"] for p in POLICIES if p["id"] == pol_id), pol_id),
            "decision": effective,
            "rationale": rationale,
        })
    return out


def _seed(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


def _summary(audit: list[dict], mode: str) -> dict:
    """Aggregate counts for the headline stats."""
    total = len(audit)
    by_decision: dict[str, int] = {}
    by_surface: dict[str, int] = {}
    by_policy: dict[str, int] = {}
    for a in audit:
        by_decision[a["decision"]] = by_decision.get(a["decision"], 0) + 1
        by_surface[a["surface"]] = by_surface.get(a["surface"], 0) + 1
        by_policy[a["policy_name"]] = by_policy.get(a["policy_name"], 0) + 1

    enforce_key = "blocked" if mode == "enforced" else "would_block"
    enforcement = by_decision.get(enforce_key, 0)
    flagged = by_decision.get("flagged", 0)
    allowed = by_decision.get("allowed", 0)

    # Scale the audit window so the numbers feel real — these are samples from
    # a 7-day window for an org of ~300 engineers.
    SCALE = 65
    return {
        "window_days": 7,
        "total_actions": total * SCALE,
        "enforcement_count": enforcement * SCALE,
        "enforcement_label": "blocked" if mode == "enforced" else "would block",
        "flagged": flagged * SCALE,
        "allowed": allowed * SCALE,
        "by_surface": [{"name": s, "count": n * SCALE} for s, n in sorted(by_surface.items(), key=lambda x: -x[1])],
        "by_policy": [{"name": p, "count": n * SCALE} for p, n in sorted(by_policy.items(), key=lambda x: -x[1])[:5]],
    }


def governance_state(mode: str = "audit", surface: str = "all") -> dict:
    if mode not in ("audit", "enforced"):
        mode = "audit"
    if surface not in ("all", "cli", "mcp", "plugins", "cowork"):
        surface = "all"

    audit = _audit_log(mode, surface)
    summary = _summary(audit, mode)

    # average surface coverage as a single headline number
    avg_coverage = sum(s["coverage"] for s in SURFACES) / len(SURFACES)

    return {
        "mode": mode,
        "surface_filter": surface,
        "policies": POLICIES,
        "surfaces": SURFACES,
        "summary": summary,
        "audit_log": audit,
        "coverage_pct": round(avg_coverage * 100, 1),
        "policy_version": 3,  # matches the deck mock: "policy: enforced (v3)"
    }
