import React, { useEffect, useState } from "react";
import { api } from "../api";
import Stat from "../components/Stat.jsx";

const SURFACES = [
  { id: "all", label: "All surfaces" },
  { id: "cli", label: "CLI" },
  { id: "mcp", label: "MCP" },
  { id: "plugins", label: "Plugins" },
  { id: "cowork", label: "Cowork" },
];

const SEVERITY_COLORS = { critical: "#ef4444", high: "#f59e0b", medium: "#7c9bff", low: "#22c55e" };

export default function GovernanceTab() {
  const [mode, setMode] = useState("audit");
  const [surface, setSurface] = useState("all");
  const [data, setData] = useState(null);

  useEffect(() => {
    api.governance(mode, surface).then(setData).catch(() => setData(null));
  }, [mode, surface]);

  if (!data) return <div className="text-muted text-sm">Loading governance state…</div>;

  return (
    <div className="space-y-5">
      <ModeBanner mode={mode} setMode={setMode} version={data.policy_version} />

      <HeadlineStats data={data} />

      <PolicyTerminal mode={mode} data={data} />

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <PolicyList policies={data.policies} />
        <CoverageMap surfaces={data.surfaces} avg={data.coverage_pct} />
      </div>

      <AuditLog data={data} surface={surface} setSurface={setSurface} />

      <DesignNote />
    </div>
  );
}

/* -------- Mode toggle (audit-only vs enforced) -------- */
function ModeBanner({ mode, setMode, version }) {
  const isEnforced = mode === "enforced";
  return (
    <div className={`card flex items-start gap-4 ${isEnforced ? "border-bad/40 bg-bad/5" : "border-warn/40 bg-warn/5"}`}>
      <div className="text-2xl leading-none mt-0.5">{isEnforced ? "🛡️" : "👁️"}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${isEnforced ? "text-bad" : "text-warn"}`}>
            {isEnforced ? "Enforced mode" : "Audit-only mode"}
          </span>
          <span className="chip bg-panel2 text-muted">policy v{version}</span>
        </div>
        <div className="text-sm text-muted mt-1 leading-relaxed">
          {isEnforced
            ? "Risky actions are blocked at execution. The audit log records every decision. Recommended after 2-4 weeks of audit-only observation."
            : "All risky actions are logged but allowed to run — so the team can review what enforcement would block before turning it on. Slide-10 mitigation: 'start in audit-only mode; enforce after watching real usage.'"}
        </div>
      </div>
      <div className="flex bg-panel2 rounded-xl p-1 self-center">
        <button
          onClick={() => setMode("audit")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === "audit" ? "bg-warn text-ink" : "text-muted hover:text-white"}`}
        >
          Audit-only
        </button>
        <button
          onClick={() => setMode("enforced")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === "enforced" ? "bg-bad text-white" : "text-muted hover:text-white"}`}
        >
          Enforced
        </button>
      </div>
    </div>
  );
}

/* -------- Headline stats -------- */
function HeadlineStats({ data }) {
  const s = data.summary;
  const fmt = (n) => Number(n).toLocaleString();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Actions audited (7d)" value={fmt(s.total_actions)} sub="~300 engineers, ContentForge + Sentinel" />
      <Stat
        label={`Actions ${s.enforcement_label}`}
        value={fmt(s.enforcement_count)}
        tone="bad"
        sub={`${((s.enforcement_count / s.total_actions) * 100).toFixed(1)}% of activity`}
      />
      <Stat label="Flagged for review" value={fmt(s.flagged)} tone="warn" sub="awaiting human sign-off" />
      <Stat label="Policy coverage" value={`${data.coverage_pct}%`} tone="good" sub={`across ${data.surfaces.length} surfaces`} />
    </div>
  );
}

/* -------- The deck-style terminal mock that anchors the feature -------- */
function PolicyTerminal({ mode, data }) {
  const s = data.summary;
  const lines = [
    "$ claude /policy status",
    `policy: ${mode === "enforced" ? "enforced" : "audit-only"} (v${data.policy_version})`,
    `coverage: ${data.coverage_pct}% across cli, mcp, plugins, cowork`,
    `${mode === "enforced" ? "blocked" : "would block"}: ${s.enforcement_count.toLocaleString()} actions (7d)`,
    `flagged: ${s.flagged.toLocaleString()} awaiting review`,
    `audit: ${s.total_actions.toLocaleString()} actions logged`,
  ];
  return (
    <div className="card bg-ink/60 !p-4 font-mono text-xs">
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "text-accent" : "text-white/85"}>
          {l}
        </div>
      ))}
    </div>
  );
}

/* -------- Policy list -------- */
function PolicyList({ policies }) {
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-edge/60 text-sm font-semibold flex items-center justify-between">
        <span>Policies ({policies.length})</span>
        <span className="text-[11px] text-muted font-normal">single rule set across all surfaces</span>
      </div>
      <div className="divide-y divide-edge/40 max-h-[420px] overflow-auto">
        {policies.map((p) => (
          <div key={p.id} className={`px-4 py-3 ${p.enabled ? "" : "bg-warn/5"}`}>
            <div className="flex items-start gap-3">
              <span
                className="chip text-[10px] uppercase tracking-wide font-bold"
                style={{ background: `${SEVERITY_COLORS[p.severity]}22`, color: SEVERITY_COLORS[p.severity] }}
              >
                {p.severity}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted font-mono">{p.id}</span>
                  <span className="text-sm font-semibold">{p.name}</span>
                  {!p.enabled && <span className="chip bg-warn/20 text-warn text-[10px]">DRAFT</span>}
                </div>
                <div className="text-xs text-muted mt-0.5">{p.rule}</div>
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted">applies to:</span>
                  {p.applies_to.map((a) => (
                    <span key={a} className="chip bg-panel2 text-muted text-[10px] !px-1.5 !py-0">{a}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------- Coverage map across surfaces -------- */
function CoverageMap({ surfaces, avg }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Coverage by surface</h3>
        <span className="chip bg-good/15 text-good">{avg}% avg</span>
      </div>
      <div className="space-y-3">
        {surfaces.map((s) => (
          <div key={s.id}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium">{s.name}</span>
              <span className={s.coverage >= 0.8 ? "text-good" : s.coverage >= 0.6 ? "text-warn" : "text-bad"}>
                {Math.round(s.coverage * 100)}%
              </span>
            </div>
            <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${s.coverage * 100}%`,
                  background: s.coverage >= 0.8 ? "#22c55e" : s.coverage >= 0.6 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
            <div className="text-[11px] text-muted mt-1 leading-snug">{s.notes}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-muted leading-relaxed border-t border-edge/40 pt-2">
        <b className="text-white">The gap this closes:</b> today's controls live in different surfaces with different
        enforcement strength. One policy plane = one audit trail. Cowork (41%) is where the next
        sprint should focus.
      </div>
    </div>
  );
}

/* -------- Audit log feed -------- */
function AuditLog({ data, surface, setSurface }) {
  const decisionColor = (d) =>
    d === "blocked" ? "bg-bad/20 text-bad"
    : d === "would_block" ? "bg-warn/20 text-warn"
    : d === "flagged" ? "bg-warn/15 text-warn"
    : "bg-good/15 text-good";
  const decisionLabel = (d) => (d === "would_block" ? "would block" : d);

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-edge/60 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold">Audit log <span className="text-muted font-normal">· last 7 days</span></div>
        <div className="flex gap-1">
          {SURFACES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSurface(s.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${
                surface === s.id ? "bg-accent text-ink" : "bg-panel2 text-muted hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-edge/40 max-h-[440px] overflow-auto">
        {data.audit_log.map((a) => (
          <div key={a.id} className="px-4 py-2.5 grid grid-cols-[80px_1fr_auto] gap-3 items-center text-xs">
            <span className={`chip ${decisionColor(a.decision)} justify-center !text-[10px] uppercase font-bold tracking-wide`}>
              {decisionLabel(a.decision)}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="chip bg-panel2 text-muted text-[10px] !px-1.5 !py-0 uppercase">{a.surface}</span>
                <span className="font-mono text-white/90 truncate">{a.action}</span>
              </div>
              <div className="text-muted mt-0.5 truncate">
                {a.policy_id} · {a.policy_name} — {a.rationale}
              </div>
            </div>
            <div className="text-right text-muted text-[11px] whitespace-nowrap">
              <div className="text-white/80">{a.actor}@{a.repo}</div>
              <div>{new Date(a.ts).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-t border-edge/40 text-[11px] text-muted">
        Sample of {data.audit_log.length} actions · scaled summary represents 7-day org-wide volume.
      </div>
    </div>
  );
}

/* -------- Design principle footer -------- */
function DesignNote() {
  return (
    <div className="card bg-panel2/40">
      <div className="text-xs leading-relaxed">
        <b className="text-white">Design principle (from the deck):</b> prefer honest signals over reassuring ones.
        Audit-only mode is the default for the first 2-4 weeks after rollout — the team sees what enforcement
        <i> would </i> block before it actually does, so legitimate workflows that the policy gets wrong get
        caught before they break the team. Graduation to enforced mode is a deliberate decision, not a default.
      </div>
    </div>
  );
}
