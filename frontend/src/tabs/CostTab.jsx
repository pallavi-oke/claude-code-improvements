import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, CartesianGrid, Legend,
} from "recharts";
import { api } from "../api";
import Stat from "../components/Stat.jsx";

const BARC = ["#7c9bff", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#34d399", "#f472b6", "#60a5fa"];
const fmt = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const MODES = [
  { id: "build", label: "Build-time" },
  { id: "run", label: "Run-time" },
  { id: "total", label: "Total (TCO)" },
];

const MODE_FROM_URL = () => {
  const m = new URLSearchParams(window.location.search).get("mode");
  return ["build", "run", "total"].includes(m) ? m : "total";
};

const VOLUME_FROM_URL = () => {
  const v = parseInt(new URLSearchParams(window.location.search).get("volume") || "", 10);
  return Number.isFinite(v) && v >= 500 ? v : 5000;
};

export default function CostTab({ source }) {
  const [mode, setMode] = useState(MODE_FROM_URL);
  const [data, setData] = useState(null);
  const [tco, setTco] = useState(null);
  const [articles, setArticles] = useState(VOLUME_FROM_URL);

  useEffect(() => {
    api.cost(source).then(setData).catch(() => setData(null));
  }, [source]);
  useEffect(() => {
    api.tco(source, articles).then(setTco).catch(() => setTco(null));
  }, [source, articles]);

  if (!data) return <Loading />;

  return (
    <div className="space-y-5">
      {/* mode switch + framing */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex bg-panel2 rounded-xl p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                mode === m.id ? "bg-accent text-ink" : "text-muted hover:text-white"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted">
          {mode === "build" && "Cost to build the agent with Claude Code (development spend)"}
          {mode === "run" && "Cost to operate the agent in production (ContentForge model calls)"}
          {mode === "total" && "Total cost of ownership = build-time + projected run-time"}
        </div>
      </div>

      {mode === "build" && <BuildView data={data} />}
      {mode === "run" && <RunView tco={tco} articles={articles} setArticles={setArticles} />}
      {mode === "total" && <TotalView tco={tco} articles={articles} setArticles={setArticles} />}
    </div>
  );
}

/* ---------------- BUILD-TIME (Claude Code dev spend) ---------------- */
function BuildView({ data }) {
  const fc = data.forecast || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Dev spend (window)" value={fmt(data.total_cost)} sub={`${data.session_count} sessions`} />
        <Stat label="Run rate / day" value={fmt(fc.run_rate_per_day || 0)} tone="warn" />
        <Stat label="Projected 30-day" value={fmt(fc.projected_30d || 0)} tone="bad"
          sub={`range ${fmt(fc.low || 0)} – ${fmt(fc.high || 0)}`} />
        <Stat label="Top cost driver" value={data.by_repo?.[0]?.name || "—"}
          sub={fmt(data.by_repo?.[0]?.cost || 0)} tone="good" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <AttributionCard title="By repository" rows={data.by_repo} />
        <AttributionCard title="By use case" rows={data.by_use_case} />
        <AttributionCard title="By owner" rows={data.by_owner} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Dev spend over time & forecast</h3>
          <span className="text-xs text-muted">
            actual daily spend → {fc.band?.length || 0}-day projection with confidence band
          </span>
        </div>
        <ForecastChart daily={data.daily} band={fc.band || []} />
      </div>
    </div>
  );
}

/* ---------------- RUN-TIME (agent production cost) ---------------- */
function RunView({ tco, articles, setArticles }) {
  const [measured, setMeasured] = useState(null);
  useEffect(() => {
    api.contentforgeRuns().then(setMeasured).catch(() => setMeasured(null));
  }, []);

  if (!tco) return <Loading />;
  const r = tco.runtime;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Cost / article (modeled)" value={`$${r.per_article.toFixed(3)}`} tone="good" sub="full 5-node pipeline" />
        <Stat label="Articles / month" value={Number(articles).toLocaleString()} />
        <Stat label="Run-time / month" value={fmt(r.monthly)} tone="warn" />
        <Stat label="Run-time / year" value={fmt(r.annual)} tone="bad" />
      </div>

      <VolumeControl articles={articles} setArticles={setArticles} />

      <ComparisonPanel articles={articles} />

      {measured?.available && <MeasuredRunsCard measured={measured} />}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card border-accent/30">
          <h3 className="font-semibold mb-1">Run-time spend by agent model</h3>
          <div className="text-xs text-muted mb-2">
            At {Number(articles).toLocaleString()} articles/mo · which model drives operating cost
          </div>
          <AttributionBars rows={r.by_model} height={170} />
        </div>
        <div className="card">
          <h3 className="font-semibold mb-1">Run-time spend by node</h3>
          <div className="text-xs text-muted mb-2">Per-node monthly cost across the pipeline</div>
          <AttributionBars rows={r.by_node} height={170} />
        </div>
      </div>

      <div className="text-[11px] text-muted">
        Modeled from ContentForge's per-node model assignment × indicative list prices. Becomes
        real once a live run's usage log is fed in — the per-article math is identical.
      </div>
    </div>
  );
}

/* ---- Compare 5-agent vs monolithic baselines + Validator tier lever ---- */
function ComparisonPanel({ articles }) {
  const [tier, setTier] = useState("opus");
  const [data, setData] = useState(null);
  useEffect(() => {
    api.comparison(articles, tier).then(setData).catch(() => setData(null));
  }, [articles, tier]);
  if (!data) return null;

  const rows = data.rows.map((r) => ({
    ...r,
    color:
      r.kind === "5-agent" && r.selected ? "#7c9bff"
      : r.kind === "5-agent" ? "#3a4a73"
      : r.has_compliance ? "#f59e0b"
      : "#22c55e",
  }));

  const cur = data.five_agent_current;
  const fairMonthly = data.breakeven.extra_monthly_vs_fair;
  const unsafeMonthly = data.breakeven.extra_monthly_vs_unsafe;
  const b1k = data.breakeven.violations_to_breakeven.find((v) => v.cost_per_violation === 1000);

  return (
    <div className="card border-warn/30">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-semibold">
          Compare to monolithic <span className="chip bg-warn/15 text-warn ml-1">value of guardrails</span>
        </h3>
        <div className="text-xs text-muted">
          What does the 5-agent system actually buy you over a single-prompt approach?
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 mt-2">
        <span className="text-xs text-muted">5-agent Validator tier:</span>
        <div className="flex bg-panel2 rounded-lg p-1">
          {["opus", "sonnet", "haiku"].map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize ${
                tier === t ? "bg-accent text-ink" : "text-muted hover:text-white"
              }`}
            >
              Claude {t}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">at {Number(articles).toLocaleString()} articles/mo · {data.articles_per_day}/day</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={`5-agent (${cur.validator})`} value={fmt(cur.monthly)} tone="bad" sub={`$${cur.per_article.toFixed(3)}/article`} />
        <Stat label="Validator lever: → Sonnet" value={`-${data.savings.opus_to_sonnet_pct}%`} tone="good"
          sub={`saves ${fmt(data.savings.opus_to_sonnet_monthly)}/mo vs Opus`} />
        <Stat label="vs fair monolithic" value={`+${fmt(fairMonthly)}/mo`} tone="warn"
          sub={data.breakeven.fair_baseline_name} />
        <Stat label="Breakeven @ $1k/violation" value={`${b1k?.needed || 0}/mo`} tone="good"
          sub="violations 5-agent must prevent" />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-xs text-muted">Monthly cost — all options sorted (5-agent vs single-prompt)</span>
          <div className="flex gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: "#7c9bff" }} /> 5-agent (selected)</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: "#3a4a73" }} /> 5-agent (other tier)</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: "#f59e0b" }} /> monolithic + compliance</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: "#22c55e" }} /> monolithic, no compliance</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 32)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={220} tick={{ fill: "#cbd5ff", fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: "#ffffff10" }}
              contentStyle={{ background: "#161f3a", border: "1px solid #243150", borderRadius: 10, color: "#fff" }}
              formatter={(v) => fmt(v)}
            />
            <Bar dataKey="monthly" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mt-3 text-xs">
        <div className="bg-panel2/60 rounded-lg p-3">
          <div className="font-semibold text-warn mb-1.5">What guardrails buy you (and monolithic can't)</div>
          <ul className="space-y-1 text-white/85">
            <li>• <b>Junk filtered before spend</b> — Scorer drops low-value keywords before generation cost</li>
            <li>• <b>Independent compliance</b> — Reviewer is a different model family than Generator (no self-grading)</li>
            <li>• <b>Per-stage auditability</b> — when something fails, you know exactly which gate</li>
            <li>• <b>Quality compounding</b> — Validator pre-selects the best outline before drafting</li>
          </ul>
        </div>
        <div className="bg-panel2/60 rounded-lg p-3">
          <div className="font-semibold text-good mb-1.5">Breakeven framing</div>
          <div className="text-white/85 leading-relaxed">
            5-agent costs <b className="text-bad">{fmt(unsafeMonthly)}/mo</b> more than the cheapest
            (unsafe) monolithic. To justify that delta, it must prevent compliance violations worth:
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono">
            {data.breakeven.violations_to_breakeven.map((v) => (
              <div key={v.cost_per_violation} className="bg-ink/50 rounded px-2 py-1 text-[11px]">
                @ ${v.cost_per_violation}/violation → <b className="text-warn">{v.needed}/mo</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-muted leading-relaxed">
        <b className="text-white">Read:</b> Going Validator → Sonnet (still cross-model from GPT-5 Planner) saves{" "}
        <b className="text-good">{data.savings.opus_to_sonnet_pct}%</b> with no compliance loss. The
        5-agent system then sits within striking distance of monolithic + an Opus compliance pass —
        but adds junk filtering, outline validation, and auditability on top.
      </div>
    </div>
  );
}

/* ---- Real ContentForge runs, measured from original pilot's SSE logs ---- */
function MeasuredRunsCard({ measured }) {
  const a = measured.aggregate;
  const perNode = Object.entries(a.avg_by_node_tokens).map(([name, cost]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    cost,
  }));
  return (
    <div className="card border-good/40">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-semibold">
          Real ContentForge runs <span className="chip bg-good/15 text-good ml-1">measured</span>
        </h3>
        <span className="text-[11px] text-muted">{measured.source}</span>
      </div>
      <div className="text-xs text-muted mb-3">
        Parsed from the original pilot's SSE run logs — output volume is real; input tokens were
        never captured. Several runs hit Gemini free-tier quota, so billed spend was $0.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Runs measured" value={a.run_count} sub="from disk" />
        <Stat
          label="Avg output / run"
          value={`${a.avg_output_tokens.toLocaleString()} tok`}
          tone="good"
          sub="char-based estimate"
        />
        <Stat
          label="Output-only cost"
          value={`$${a.avg_cost_flash.toFixed(4)}–$${a.avg_cost_pro.toFixed(4)}`}
          sub="Flash → Pro list prices"
        />
        <Stat
          label="Est. full run (≈2.5×)"
          value={`$${a.full_cost_low_2_5x.toFixed(3)}–$${a.full_cost_high_2_5x.toFixed(3)}`}
          tone="warn"
          sub="adding back inputs"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-3">
        <div>
          <div className="text-xs text-muted mb-2">Output tokens by node (avg per run)</div>
          <AttributionBars rows={perNode} height={150} />
        </div>
        <div>
          <div className="text-xs text-muted mb-2">Per-run detail</div>
          <div className="space-y-1.5">
            {measured.runs.map((r) => (
              <div key={r.file} className="flex items-center justify-between bg-panel2/60 rounded-lg px-3 py-1.5 text-xs">
                <span className="font-mono text-muted truncate">{r.file}</span>
                <span className="text-white/90">
                  {r.output_tokens.toLocaleString()} tok · {r.articles} article{r.articles === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-muted leading-relaxed">
        <b className="text-white">Read:</b> Generator dominates output volume (~{Math.round(
          (a.avg_by_node_tokens.generator / a.avg_output_tokens) * 100
        )}% of tokens) — consistent with the modeled view above. The absence of usage logging in
        the original pilot is itself the gap this prototype's run-time view closes.
      </div>
    </div>
  );
}

/* ---------------- TOTAL (TCO) ---------------- */
function TotalView({ tco, articles, setArticles }) {
  if (!tco) return <Loading />;
  const t = tco.tco;
  const split = [
    { name: "Build-time (one-time dev)", cost: t.build_to_date },
    { name: "Run-time (year 1)", cost: t.runtime_annual },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Build-time (to date)" value={fmt(t.build_to_date)} tone="good"
          sub={`${tco.build.session_count} Claude Code sessions`} />
        <Stat label="Run-time / year" value={fmt(t.runtime_annual)} tone="warn"
          sub={`@ ${Number(articles).toLocaleString()} articles/mo`} />
        <Stat label="Year-one TCO" value={fmt(t.total_year_one)} tone="bad" />
        <Stat label="Build : Run ratio"
          value={`1 : ${Math.round(t.runtime_annual / Math.max(t.build_to_date, 1))}`}
          sub="dev cost vs first-year operating cost" />
      </div>

      <VolumeControl articles={articles} setArticles={setArticles} />

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-1">Build vs. run (year one)</h3>
          <div className="text-xs text-muted mb-2">
            What it cost to build the agent vs. to operate it for a year
          </div>
          <AttributionBars rows={split} height={140} />
        </div>
        <div className="card border-accent/30">
          <h3 className="font-semibold mb-1">Run-time by agent model (annual)</h3>
          <div className="text-xs text-muted mb-2">The recurring cost — where to optimize</div>
          <AttributionBars
            rows={tco.runtime.by_model.map((m) => ({ name: m.name, cost: m.cost * 12 }))}
            height={140}
          />
        </div>
      </div>

      <div className="card bg-panel2/40">
        <div className="text-sm">
          <b className="text-white">Read:</b> building ContentForge cost{" "}
          <b className="text-good">{fmt(t.build_to_date)}</b> of Claude Code dev spend — but operating it at{" "}
          {Number(articles).toLocaleString()} articles/mo runs <b className="text-warn">{fmt(t.runtime_annual)}/yr</b>.
          Run-time dominates at scale, and <b className="text-claude">Claude validation</b> is the largest
          slice — the clearest optimization lever.
        </div>
      </div>
    </div>
  );
}

function VolumeControl({ articles, setArticles }) {
  const presets = [
    { label: "100/day", value: 3000 },
    { label: "500/day", value: 15000 },
    { label: "2K/day", value: 60000 },
    { label: "5K/day", value: 150000 },
  ];
  return (
    <div className="card !py-3 space-y-2">
      <div className="flex items-center gap-4">
        <span className="text-xs text-muted whitespace-nowrap">Production volume</span>
        <input
          type="range"
          min={500}
          max={300000}
          step={500}
          value={articles}
          onChange={(e) => setArticles(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <span className="text-sm font-semibold w-32 text-right">
          {Number(articles).toLocaleString()} / mo
          <span className="block text-[10px] text-muted">≈ {Math.round(articles / 30).toLocaleString()}/day</span>
        </span>
      </div>
      <div className="flex gap-1.5 text-[11px]">
        <span className="text-muted">Quick set:</span>
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setArticles(p.value)}
            className={`px-2 py-0.5 rounded ${articles === p.value ? "bg-accent text-ink" : "bg-panel2 text-muted hover:text-white"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AttributionCard({ title, rows }) {
  return (
    <div className="card">
      <h3 className="font-semibold mb-3">{title}</h3>
      <AttributionBars rows={rows} height={200} />
    </div>
  );
}

function AttributionBars({ rows, height = 200 }) {
  const top = (rows || []).slice(0, 6);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={140} tick={{ fill: "#8aa0c8", fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: "#ffffff10" }}
          contentStyle={{ background: "#161f3a", border: "1px solid #243150", borderRadius: 10, color: "#fff" }}
          formatter={(v) => fmt(v)}
        />
        <Bar dataKey="cost" radius={[0, 6, 6, 0]} isAnimationActive={false}>
          {top.map((_, i) => <Cell key={i} fill={BARC[i % BARC.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ForecastChart({ daily, band }) {
  const actual = (daily || []).map((d) => ({ x: d.day.slice(5), actual: d.cost }));
  const proj = band.map((b) => ({ x: b.day, expected: b.expected, low: b.low, high: b.high }));
  const merged = [...actual, ...proj];
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={merged} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#243150" strokeDasharray="3 3" />
        <XAxis dataKey="x" tick={{ fill: "#8aa0c8", fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#8aa0c8", fontSize: 10 }} tickFormatter={fmt} width={48} />
        <Tooltip
          contentStyle={{ background: "#161f3a", border: "1px solid #243150", borderRadius: 10, color: "#fff" }}
          formatter={(v, n) => [fmt(v), n]}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#8aa0c8" }} />
        <Area isAnimationActive={false} type="monotone" dataKey="high" stroke="none" fill="url(#band)" name="forecast high" />
        <Area isAnimationActive={false} type="monotone" dataKey="low" stroke="none" fill="#0b1020" name="forecast low" />
        <Area isAnimationActive={false} type="monotone" dataKey="expected" stroke="#f59e0b" strokeDasharray="5 4" fill="none" name="forecast" />
        <Area isAnimationActive={false} type="monotone" dataKey="actual" stroke="#7c9bff" strokeWidth={2} fill="#7c9bff22" name="actual spend" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Loading() {
  return <div className="text-muted text-sm">Loading cost data…</div>;
}
