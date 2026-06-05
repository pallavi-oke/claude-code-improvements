import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, CartesianGrid, Legend,
} from "recharts";
import { api } from "../api";
import Stat from "../components/Stat.jsx";

const BARC = ["#7c9bff", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#34d399", "#f472b6", "#60a5fa"];
const fmt = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function CostTab({ source }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.cost(source).then(setData).catch(() => setData(null));
  }, [source]);

  if (!data) return <Loading />;

  const fc = data.forecast || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Spend (window)" value={fmt(data.total_cost)} sub={`${data.session_count} sessions`} />
        <Stat label="Run rate / day" value={fmt(fc.run_rate_per_day || 0)} tone="warn" />
        <Stat label="Projected 30-day" value={fmt(fc.projected_30d || 0)} tone="bad"
          sub={`range ${fmt(fc.low || 0)} – ${fmt(fc.high || 0)}`} />
        <Stat label="Top cost driver" value={data.by_repo?.[0]?.name || "—"}
          sub={fmt(data.by_repo?.[0]?.cost || 0)} tone="good" />
      </div>

      <div className="card !pb-3 border-accent/30">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">ContentForge · cross-model spend by agent model</h3>
          <span className="text-xs text-muted">
            GPT-5 generation · Gemini scoring/compliance · Claude validation
          </span>
        </div>
        <div className="text-xs text-muted mb-2">
          Per-node model attribution for the system I built — the view that answers
          "which model is driving cost, and is it worth it?"
        </div>
        <AttributionBars
          rows={(data.by_model_contentforge?.length ? data.by_model_contentforge : data.by_model)}
          height={150}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <AttributionCard title="By repository" rows={data.by_repo} />
        <AttributionCard title="By use case" rows={data.by_use_case} />
        <AttributionCard title="By owner" rows={data.by_owner} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Spend over time & forecast</h3>
          <span className="text-xs text-muted">
            actual daily spend → {fc.band?.length || 0}-day projection with confidence band
          </span>
        </div>
        <ForecastChart daily={data.daily} band={fc.band || []} />
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
