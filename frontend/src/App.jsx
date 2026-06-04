import React, { useEffect, useState } from "react";
import { api } from "./api";
import ComposerTab from "./tabs/ComposerTab.jsx";
import HealthTab from "./tabs/HealthTab.jsx";
import CostTab from "./tabs/CostTab.jsx";

const TABS = [
  {
    id: "composer",
    label: "1 · Workflow Composer",
    pain: "I can watch agents run, but I can't shape how they fit together before they start.",
    fix: "Visual composer & inspector — see handoffs, branches, and parallel runs before execution.",
    anchor: "Wiring ContentForge's 5-node graph (scorer→planner→validator→generator→reviewer) was all hand-coded — I couldn't see the structure before running it.",
  },
  {
    id: "health",
    label: "2 · Session Health",
    pain: "In long sessions, output quality can quietly degrade before I notice.",
    fix: "A pre-emptive health signal + smart cleanup that preserves decisions and constraints.",
    anchor: "Building ContentForge was one long multi-hour session — exactly where context quietly fills up and output starts to drift.",
  },
  {
    id: "cost",
    label: "3 · Team Cost",
    pain: "As usage scales, spend is hard to attribute, predict, and compare to value.",
    fix: "Cost by repo, use case & owner, with forecast ranges — not just per-session totals.",
    anchor: "ContentForge is cross-model — GPT-5, Gemini, Claude. Knowing which agent/model/repo drives spend is what unlocks a team scale-up.",
  },
];

export default function App() {
  const [tab, setTab] = useState("composer");
  const [source, setSource] = useState("all");
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="px-6 pt-5 pb-3 border-b border-edge/60">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[13px] uppercase tracking-widest text-accent/80 font-semibold">
              Claude Code · PM Concept Demos
            </div>
            <div className="text-xs text-muted mt-0.5">
              Three product gaps, prototyped against real Claude Code telemetry
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
          <span className="text-accent font-semibold">From building ContentForge · </span>
          {active.anchor}
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 p-6 overflow-auto">
        {tab === "composer" && <ComposerTab />}
        {tab === "health" && <HealthTab source={source} />}
        {tab === "cost" && <CostTab source={source} />}
      </main>

      <footer className="px-6 py-2 text-[11px] text-muted/70 border-t border-edge/40">
        Prototype · reads ~/.claude transcripts (token usage, model, repo, branch,
        timestamps) with a synthetic team fallback. Dollar figures use indicative list pricing.
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
