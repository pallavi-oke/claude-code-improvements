"""Agent Governance & Audit — backend data model for the P0 prototype.

This prototype is tuned to Ironclad's surfaces (Workflow Designer, Compliance
API, AI Assist & Repository, third-party integrations) — so the policy list
and the coverage map read as policies a contract-lifecycle-management platform
would actually enforce, not generic IT controls.

What this demonstrates:
  1. A single policy plane — one place to define rules that apply across
     Claude Code's surfaces (CLI commands, MCP servers, plugins, Cowork).
  2. Risky-action gating — high-risk actions are blocked (or in audit-only
     mode, logged with a 'would_block' flag) before they run.
  3. Complete audit trail — every agent action logged with surface,
     actor/workspace, policy decision, and rationale.
  4. Coverage map — visualizes where policy enforcement reaches today vs.
     where it's stitched together (the slide-7 pain point).
  5. Audit-only -> enforcement graduation — the slide-10 mitigation
     ("start in audit-only mode; enforce after watching real usage").
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

# ----------------------------------------------------------------------------
# Policies — Ironclad-specific risk model
# ----------------------------------------------------------------------------
POLICIES = [
    {
        "id": "POL-001",
        "name": "Tenant boundary enforcement",
        "category": "Data isolation",
        "severity": "critical",
        "applies_to": ["workflow", "compliance-api", "ai-assist", "integrations"],
        "rule": "Agents cannot read or modify contracts outside their assigned workspace. Cross-tenant requests require explicit elevated approval.",
        "enabled": True,
    },
    {
        "id": "POL-002",
        "name": "Attorney-client privilege redaction",
        "category": "Privilege",
        "severity": "critical",
        "applies_to": ["ai-assist", "integrations"],
        "rule": "Contract clauses tagged 'privileged' must be redacted before any external model call. Privilege loss is not recoverable.",
        "enabled": True,
    },
    {
        "id": "POL-003",
        "name": "EU data residency (GDPR)",
        "category": "Data residency",
        "severity": "critical",
        "applies_to": ["ai-assist", "compliance-api"],
        "rule": "Contracts in EU workspaces route only to EU-region model endpoints (Bedrock EU, Vertex EU). Block any non-EU egress.",
        "enabled": True,
    },
    {
        "id": "POL-004",
        "name": "Approval matrix enforcement",
        "category": "Workflow",
        "severity": "high",
        "applies_to": ["workflow", "integrations"],
        "rule": "Agents cannot mark a contract 'approved for signature' without traversing the configured approval hierarchy (Finance >$1M, Legal for IP, etc.).",
        "enabled": True,
    },
    {
        "id": "POL-005",
        "name": "Executed-contract immutability",
        "category": "Chain of custody",
        "severity": "high",
        "applies_to": ["workflow", "integrations"],
        "rule": "Once a contract enters DocuSign envelope state or has a signature, agents may annotate or summarize but never edit content.",
        "enabled": True,
    },
    {
        "id": "POL-006",
        "name": "AI suggestion audit trail",
        "category": "AI accountability",
        "severity": "high",
        "applies_to": ["ai-assist", "compliance-api"],
        "rule": "Every clause suggestion, redline, or summary logs: model used, input clauses, output, and who accepted/rejected. Customers must be able to answer 'what did the AI see and propose?'",
        "enabled": True,
    },
    {
        "id": "POL-007",
        "name": "Forbidden clause patterns",
        "category": "Legal substance",
        "severity": "medium",
        "applies_to": ["ai-assist"],
        "rule": "Block AI from suggesting clauses violating jurisdiction (non-competes in CA post AB-1076, unconditional indemnities, perpetual royalty-free licenses).",
        "enabled": True,
    },
    {
        "id": "POL-008",
        "name": "Third-party sync gating",
        "category": "Integrations",
        "severity": "medium",
        "applies_to": ["integrations"],
        "rule": "Agent-driven Salesforce / DocuSign / Notion writes that change deal state or contract status require human confirmation before propagating.",
        "enabled": False,  # not yet enabled — the "draft policy" example
    },
]

# ----------------------------------------------------------------------------
# Surface coverage — Ironclad's own surfaces, not generic Claude Code ones
# ----------------------------------------------------------------------------
SURFACES = [
    {
        "id": "workflow",
        "name": "Workflow Designer",
        "coverage": 0.94,
        "notes": "Native workflow stages fully gated. Approval matrix + signature transitions enforced server-side.",
    },
    {
        "id": "compliance-api",
        "name": "Compliance API",
        "coverage": 0.78,
        "notes": "Customer-defined policy hooks enforced. Per-clause-type rules wired in; some legacy templates still lag.",
    },
    {
        "id": "ai-assist",
        "name": "AI Assist & Repository",
        "coverage": 0.66,
        "notes": "Redaction + audit trail live for suggestions. Forbidden-clause detection lands next sprint; older models still bypass.",
    },
    {
        "id": "integrations",
        "name": "3rd-party integrations",
        "coverage": 0.43,
        "notes": "Biggest gap. Salesforce + DocuSign + Notion writes inherit session role, not actor role. POL-008 drafted.",
    },
]

# Surface keys used for filtering (must match POLICIES.applies_to + SURFACES.id)
SURFACE_IDS = ("workflow", "compliance-api", "ai-assist", "integrations")

# ----------------------------------------------------------------------------
# Audit log — Ironclad-flavored, deterministic, representative of real ops
# ----------------------------------------------------------------------------
_AUDIT_TEMPLATES = [
    # (surface, action, policy_id, decision, rationale)
    ("ai-assist",       "repository / read_contract(workspace=globex)",        "POL-001", "blocked", "Actor workspace=acme; cross-tenant read denied."),
    ("workflow",        "approve_for_signature: NDA-2024-1142",                 "POL-004", "allowed", "Standard NDA template; under $250K threshold; approver=Legal/Sarah Chen."),
    ("workflow",        "approve_for_signature: MSA-IronCorp-$2.4M",            "POL-004", "blocked", "Contract value $2.4M exceeds CFO approval threshold; approver=Maya (Legal); CFO sign-off missing."),
    ("ai-assist",       "ai-assist / suggest_clause(jurisdiction=CA)",          "POL-007", "flagged", "Suggested 18-month non-compete; CA AB-1076 disallows. Suggestion withheld pending review."),
    ("ai-assist",       "ai-assist / summarize_contract(privileged=true)",      "POL-002", "blocked", "Clause marked attorney-client privileged; external model call would void privilege."),
    ("integrations",    "salesforce-sync / update_opportunity_stage=ClosedWon", "POL-008", "flagged", "Agent attempting deal-stage advance without human confirm; POL-008 still draft."),
    ("ai-assist",       "ai-assist / redline(workspace=eu-paris)",              "POL-003", "blocked", "EU workspace contract; agent attempted call to us-east-1 endpoint. Route via Bedrock EU."),
    ("workflow",        "create_envelope: SaaS-Renewal-Q3",                     "POL-005", "allowed", "Pre-signature state; edits permitted."),
    ("integrations",    "docusign / edit_envelope_document(after-signed)",      "POL-005", "blocked", "Envelope in 'Sent' state with countersignature; document is immutable to agents."),
    ("compliance-api",  "policy-hook / fired on clause=indemnification",        "POL-007", "flagged", "Unconditional indemnity language detected; customer hook blocks default templates."),
    ("ai-assist",       "ai-assist / propose_redline",                          "POL-006", "allowed", "Redline logged: model=claude-sonnet-4.6, 3 clauses input, 2 suggestions output, accepted by author."),
    ("ai-assist",       "repository / extract_metadata(workspace=loreal-eu)",   "POL-003", "blocked", "EU workspace; extractor instance is us-east. Routing failure flagged to InfoSec."),
    ("workflow",        "approve_for_signature: Vendor-MSA-Mastercard",         "POL-004", "allowed", "Approval matrix satisfied: Legal + Finance + Procurement signed off."),
    ("compliance-api",  "policy-hook / cross_workspace_read attempt",           "POL-001", "blocked", "Customer-defined policy hook blocked outside-workspace clause comparison."),
    ("ai-assist",       "ai-assist / suggest_clause(jurisdiction=EU)",          "POL-007", "allowed", "Suggested clause vetted against EU template set; permitted."),
    ("integrations",    "notion-write / sync_contract_summary",                 "POL-008", "flagged", "Workspace ACL drifted; agent's Notion token has broader scope than caller. POL-008 draft."),
    ("workflow",        "create_workflow: Healthcare Vendor Intake",            "POL-002", "flagged", "Healthcare-vertical workflow; privileged clause handling unverified — Sheriff review queued."),
    ("ai-assist",       "ai-assist / summarize(template=privileged-comms)",     "POL-002", "blocked", "Template tagged privileged; redaction required before external model call."),
    ("compliance-api",  "policy-hook / approval_matrix_bypass attempt",         "POL-004", "blocked", "Customer hook caught agent trying to skip CFO step on $3.1M MSA."),
    ("integrations",    "salesforce-sync / read_account_data",                  "POL-001", "allowed", "Same-tenant read; standard sync flow."),
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
        actor = ["amir", "blair", "chen", "dana", "evan", "maya", "sarah"][_seed(action) % 7]
        # Ironclad-flavored workspaces (customer tenants + internal)
        workspace = ["acme", "loreal-eu", "mastercard", "asana-internal", "globex", "ironcorp"][_seed(surface + action) % 6]
        out.append({
            "id": f"act_{i:03d}",
            "ts": ts.isoformat() + "Z",
            "surface": surface,
            "actor": actor,
            "repo": workspace,  # frontend labels this as workspace/tenant
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
    # a 7-day window for an org of ~300 engineers / legal-ops users.
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
    if surface not in ("all",) + SURFACE_IDS:
        surface = "all"

    audit = _audit_log(mode, surface)
    summary = _summary(audit, mode)

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
