import React from "react";

export default function Stat({ label, value, sub, tone = "default" }) {
  const toneCls =
    tone === "good"
      ? "text-good"
      : tone === "warn"
      ? "text-warn"
      : tone === "bad"
      ? "text-bad"
      : "text-white";
  return (
    <div className="card !p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
