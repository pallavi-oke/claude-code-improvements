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

export default function CostTab({ source }) {
  const [mode, setMode] = useState("total");
  const [data, setData] = useState(null);
  const [tco, setTco] = useState(null);
  const [articles, setArticles] = useState(5000);

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
  if (!tco) return <Loading />;
  const r = tco.runtime;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Cost / article" value={`$${r.per_article.toFixed(3)}`} tone="good" sub="full 5-node pipeline" />
        <Stat label="Articles / month" value={Number(articles).toLocaleString()} />
        <Stat label="Run-time / month" value={fmt(r.monthly)} tone="warn" />
        <Stat label="Run-time / year" value={fmt(r.annual)} tone="bad" />
      </div>

      <VolumeControl articles={articles} setArticles={setArticles} />

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
  return (
    <div className="card !py-3 flex items-center gap-4">
      <span className="text-xs text-muted whitespace-nowrap">Production volume</span>
      <input
        type="range"
        min={500}
        max={50000}
        step={500}
        value={articles}
        onChange={(e) => setArticles(Number(e.target.value))}
        className="flex-1 accent-accent"
      />
      <span className="text-sm font-semibold w-28 text-right">{Number(articles).toLocaleString()} / mo</span>
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
