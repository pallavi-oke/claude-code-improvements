import React, { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ReferenceArea,
} from "recharts";
import { api } from "../api";
import Stat from "../components/Stat.jsx";

const ZONE = {
  healthy: { c: "#22c55e", label: "Healthy" },
  caution: { c: "#f59e0b", label: "Caution" },
  elevated: { c: "#fb923c", label: "Elevated" },
  high_risk: { c: "#ef4444", label: "High risk" },
};

export default function HealthTab({ source }) {
  const [h, setH] = useState(null);
  useEffect(() => {
    api.health(source).then(setH).catch(() => setH(null));
  }, [source]);

  if (!h || h.error) return <div className="text-muted text-sm">Loading session health…</div>;

  const th = h.thresholds;
  const series = h.timeline.map((p) => ({
    turn: p.turn,
    util: Math.round(p.utilization * 100),
    zone: p.zone,
  }));
  const z = ZONE[h.current_zone] || ZONE.healthy;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Gauge util={h.current_utilization} zone={h.current_zone} />
        <Stat label="Session" value={`${h.turn_count} turns`} sub={h.title} />
        <Stat label="Peak utilization" value={`${Math.round(h.peak_utilization * 100)}%`}
          tone={h.peak_utilization >= th.high_risk ? "bad" : "warn"} />
        <Stat label="Pre-emptive warning"
          value={h.warning_turn ? `Turn ${h.warning_turn}` : "—"}
          tone="warn"
          sub={h.warning_turn ? "fired before high-risk zone" : "stayed healthy"} />
      </div>

      {h.warning_turn && (
        <div className="card border-warn/50 bg-warn/5 flex items-start gap-3">
          <div className="text-warn text-xl leading-none mt-0.5">⚠️</div>
          <div>
            <div className="font-semibold text-warn">
              Context pressure rising — quality risk ahead
            </div>
            <div className="text-sm text-muted mt-1">
              At <b className="text-white">turn {h.warning_turn}</b> the session crossed{" "}
              {Math.round(th.caution * 100)}% context utilization. This warning fires{" "}
              <b className="text-white">before</b> the high-risk zone ({Math.round(th.high_risk * 100)}%),
              so you can run smart cleanup while decisions are still intact — not after output degrades.
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Context utilization over the session</h3>
          <ZoneLegend />
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={series} margin={{ left: 2, right: 12, top: 8 }}>
            <defs>
              <linearGradient id="util" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={z.c} stopOpacity={0.5} />
                <stop offset="100%" stopColor={z.c} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#243150" strokeDasharray="3 3" />
            {/* zone bands */}
            <ReferenceArea y1={0} y2={th.healthy * 100} fill="#22c55e" fillOpacity={0.05} />
            <ReferenceArea y1={th.healthy * 100} y2={th.caution * 100} fill="#f59e0b" fillOpacity={0.05} />
            <ReferenceArea y1={th.caution * 100} y2={th.high_risk * 100} fill="#fb923c" fillOpacity={0.06} />
            <ReferenceArea y1={th.high_risk * 100} y2={100} fill="#ef4444" fillOpacity={0.08} />
            <XAxis dataKey="turn" tick={{ fill: "#8aa0c8", fontSize: 10 }} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "#8aa0c8", fontSize: 10 }} width={40} />
            <Tooltip
              contentStyle={{ background: "#161f3a", border: "1px solid #243150", borderRadius: 10, color: "#fff" }}
              formatter={(v) => [`${v}%`, "utilization"]}
              labelFormatter={(l) => `Turn ${l}`}
            />
            {h.warning_turn && (
              <ReferenceLine x={h.warning_turn} stroke="#f59e0b" strokeDasharray="4 3"
                label={{ value: "warn", fill: "#f59e0b", fontSize: 10, position: "top" }} />
            )}
            <Area type="monotone" dataKey="util" stroke={z.c} strokeWidth={2} fill="url(#util)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <CleanupPreview cleanup={h.cleanup_preview} />
    </div>
  );
}

function Gauge({ util, zone }) {
  const pct = Math.round(util * 100);
  const z = ZONE[zone] || ZONE.healthy;
  const angle = Math.min(util, 1) * 180;
  return (
    <div className="card !p-4 flex flex-col items-center justify-center">
      <div className="text-[11px] uppercase tracking-wider text-muted self-start">Current health</div>
      <div className="relative w-[150px] h-[80px] mt-2 overflow-hidden">
        <div className="absolute inset-0 rounded-t-full"
          style={{ background: "conic-gradient(from -90deg at 50% 100%, #22c55e 0deg, #f59e0b 90deg, #ef4444 170deg, #243150 180deg)" }} />
        <div className="absolute inset-[10px] rounded-t-full bg-panel" />
        <div className="absolute left-1/2 bottom-0 w-[2px] h-[64px] bg-white origin-bottom"
          style={{ transform: `translateX(-50%) rotate(${angle - 90}deg)` }} />
        <div className="absolute left-1/2 bottom-[-5px] w-2.5 h-2.5 rounded-full bg-white -translate-x-1/2" />
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: z.c }}>{pct}%</div>
      <div className="chip mt-1" style={{ background: `${z.c}22`, color: z.c }}>{z.label}</div>
    </div>
  );
}

function ZoneLegend() {
  return (
    <div className="flex gap-3 text-[11px]">
      {Object.values(ZONE).map((z) => (
        <span key={z.label} className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: z.c }} />
          <span className="text-muted">{z.label}</span>
        </span>
      ))}
    </div>
  );
}

function CleanupPreview({ cleanup }) {
  if (!cleanup) return null;
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Smart cleanup preview</h3>
        <span className="chip bg-good/15 text-good">
          ~{cleanup.estimated_reclaim_pct}% context reclaimable · {cleanup.estimated_reclaim_tokens.toLocaleString()} tok
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-good mb-2">✓ Preserved</div>
          <ul className="space-y-1.5">
            {cleanup.preserve.map((x) => (
              <li key={x} className="text-sm text-white/90 flex items-center gap-2">
                <span className="text-good">●</span> {x}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted mb-2">↓ Compacted</div>
          <ul className="space-y-1.5">
            {cleanup.compact.map((x) => (
              <li key={x} className="text-sm text-muted flex items-center gap-2">
                <span className="text-warn">●</span> {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
