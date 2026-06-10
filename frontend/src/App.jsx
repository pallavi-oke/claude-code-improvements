import React, { useEffect, useState } from "react";
import { api } from "./api";
import GovernanceTab from "./tabs/GovernanceTab.jsx";
import ComposerTab from "./tabs/ComposerTab.jsx";
import CostTab from "./tabs/CostTab.jsx";

const TABS = [
  {
    id: "governance",
    label: "1 · Agent Governance & Audit",
    badge: "P0",
    pain: "Control today is stitched from managed settings, a Compliance API, telemetry, and a proxy — with gaps across MCP, plugins, and Cowork. No single policy or complete audit trail.",
    fix: "One place to define policy, gate risky actions, and review what agents did — with an audit-only mode you can graduate to enforcement.",
    anchor: "Tuned to a contract-lifecycle-management (CLM) platform's surfaces: Workflow Designer, Compliance API, AI Assist & Repository, and 3rd-party integrations (Salesforce, DocuSign, Notion). The policies are the ones a CLM platform actually has to enforce — tenant isolation, privilege protection, EU residency, approval matrices.",
  },
  {
    id: "composer",
    label: "2 · Agent Plan & Run Inspector",
    badge: "P1",
    pain: "Runtime already shows a live run. The gap is the build phase — while wiring up a multi-agent system, there is no map of how the agents connect and hand off.",
    fix: "A native inspector that maps the system as you build it: agents, handoffs, branches, parallel runs — visible before you execute.",
    anchor: "Wiring ContentForge's 5-node graph (scorer→planner→validator→generator→reviewer) was all hand-coded. I couldn't see the structure before running it. Same for Sentinel's 6-agent governance branch.",
  },
  {
    id: "cost",
    label: "3 · Team Cost",
    badge: "P2",
    pain: "Spend shows up by user and model, but not by team, repo, or workflow. So there's no way to see what an agent workflow costs, or forecast it before scaling.",
    fix: "Spend broken down by repo, workflow, and use case, with forecasts shown as ranges — enough to budget agent work, not just watch the total.",
    anchor: "ContentForge is cross-model — GPT-5, Gemini, Claude. Knowing which agent / model / repo drives spend is what unlocks a team scale-up decision.",
  },
];

const VALID_TABS = ["governance", "composer", "cost"];
const tabFromHash = () => {
  const h = (window.location.hash || "").replace("#", "");
  return VALID_TABS.includes(h) ? h : "governance";
};

const sourceFromUrl = () => {
  const s = new URLSearchParams(window.location.search).get("source");
  return ["all", "sample", "live"].includes(s) ? s : "all";
};

export default function App() {
  const [tab, setTabState] = useState(tabFromHash);
  const [source, setSource] = useState(sourceFromUrl);
  const [meta, setMeta] = useState(null);

  const setTab = (id) => {
    setTabState(id);
    window.location.hash = id; // deep-linkable
  };

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="px-6 pt-5 pb-3 border-b border-edge/60">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[13px] uppercase tracking-widest text-accent/80 font-semibold">
              Claude Code · Product Improvement Prototypes
            </div>
            <div className="text-xs text-muted mt-0.5">
              Three product gaps for the enterprise agent builder, prototyped against real telemetry
            </div>
          </div>
          <DataSourceToggle source={source} setSource={setSource} meta={meta} />
        </div>

        <nav className="mt-4 flex gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab-btn ${
                tab === t.id
                  ? "bg-accent text-ink"
                  : "bg-panel2 text-muted hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Gap -> Fix caption for the active demo */}
      <div className="px-6 py-3 bg-panel/40 border-b border-edge/40">
        <div className="grid sm:grid-cols-2 gap-2 max-w-5xl">
          <div className="gap-caption">
            <span className="text-bad font-semibold">The gap · </span>
            {active.pain}
          </div>
          <div className="gap-caption">
            <span className="text-good font-semibold">The fix · </span>
            {active.fix}
          </div>
        </div>
        <div className="gap-caption mt-2 max-w-5xl border-l-2 border-accent/60 pl-2.5">
          <span className="text-accent font-semibold">From building ContentForge & Sentinel Vantage · </span>
          {active.anchor}
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 p-6 overflow-auto">
        {tab === "governance" && <GovernanceTab />}
        {tab === "composer" && <ComposerTab />}
        {tab === "cost" && <CostTab source={source} />}
      </main>

      <footer className="px-6 py-2 text-[11px] text-muted/70 border-t border-edge/40">
        Prototype · reads ~/.claude transcripts (token usage, model, repo, branch,
        timestamps) with a synthetic team fallback. Validated on two shipped pilots:
        ContentForge (5-agent) and Sentinel Vantage (6-agent).
      </footer>
    </div>
  );
}

function DataSourceToggle({ source, setSource, meta }) {
  const opts = [
    { id: "all", label: "Team + You" },
    { id: "sample", label: "Sample Team" },
    { id: "live", label: "Live (~/.claude)" },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted">Data source</span>
      <div className="flex bg-panel2 rounded-xl p-1">
        {opts.map((o) => (
          <button
            key={o.id}
            onClick={() => setSource(o.id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
              source === o.id ? "bg-accent text-ink" : "text-muted hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {meta && (
        <span className="text-[11px] text-muted/80">
          {meta.has_live ? `${meta.live_sessions} live session(s)` : "no live history"}
        </span>
      )}
    </div>
  );
}
