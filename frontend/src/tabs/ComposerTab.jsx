import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background, Controls, MarkerType, Handle, Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../api";

const PHASE_COLORS = ["#7c9bff", "#22c55e", "#f59e0b", "#a78bfa", "#34d399", "#f472b6"];

function phaseColor(phases, phase) {
  const i = phases.indexOf(phase);
  return i >= 0 ? PHASE_COLORS[i % PHASE_COLORS.length] : "#60a5fa";
}

/* ---- custom nodes ---- */
function AgentNode({ data }) {
  return (
    <div className="rounded-xl px-3 py-2 text-xs shadow-lg border"
      style={{ background: "#161f3a", borderColor: data.color, minWidth: 150, maxWidth: 200 }}
      onClick={data.onClick}>
      <Handle type="target" position={Position.Left} style={{ background: data.color }} />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ background: data.color }} />
        <span className="text-[10px] uppercase tracking-wide text-muted">{data.phase || "agent"}</span>
        {data.parallel && <span className="chip bg-accent/20 text-accent !px-1.5 !py-0 text-[9px]">∥</span>}
      </div>
      <div className="text-white/90 leading-snug">{data.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: data.color }} />
    </div>
  );
}
function IONode({ data }) {
  return (
    <div className="rounded-full px-4 py-2 text-xs font-semibold shadow-lg"
      style={{ background: data.out ? "#22c55e22" : "#7c9bff22", color: data.out ? "#22c55e" : "#7c9bff", border: `1px solid ${data.out ? "#22c55e" : "#7c9bff"}` }}>
      {!data.out && <Handle type="source" position={Position.Right} style={{ background: "#7c9bff" }} />}
      {data.out && <Handle type="target" position={Position.Left} style={{ background: "#22c55e" }} />}
      {data.label}
    </div>
  );
}
const NODE_TYPES = { agent: AgentNode, io: IONode };

export default function ComposerTab() {
  const [script, setScript] = useState("");
  const [graph, setGraph] = useState(null);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.workflowSample().then((d) => {
      setScript(d.script);
      setGraph(d.graph);
    });
  }, []);

  const reparse = useCallback(async (text) => {
    try {
      const g = await api.workflow(text);
      setGraph(g);
      setErr("");
    } catch (e) {
      setErr("Could not parse workflow");
    }
  }, []);

  const { nodes, edges } = useMemo(
    () => layout(graph, setSelected),
    [graph]
  );

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-4 h-full">
      {/* left: script + palette */}
      <div className="space-y-3">
        <div className="card !p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Workflow script</h3>
            <button onClick={() => reparse(script)}
              className="tab-btn bg-accent text-ink !py-1 !px-3 text-xs">Inspect →</button>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
            className="w-full h-[320px] bg-ink/60 border border-edge rounded-lg p-3 font-mono text-[11px] text-white/85 leading-relaxed resize-none focus:outline-none focus:border-accent"
          />
          {err && <div className="text-bad text-xs mt-1">{err}</div>}
        </div>
        <Palette onInsert={(snip) => { const next = script + "\n" + snip; setScript(next); reparse(next); }} />
      </div>

      {/* right: graph + inspector */}
      <div className="grid grid-rows-[1fr_auto] gap-3 min-h-[520px]">
        <div className="card !p-0 overflow-hidden relative" style={{ height: 480 }}>
          {graph && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              fitView
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              defaultEdgeOptions={{
                type: "smoothstep",
                animated: true,
                markerEnd: { type: MarkerType.ArrowClosed, color: "#3a4a73" },
                style: { stroke: "#3a4a73" },
              }}
            >
              <Background color="#1c2742" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
          {graph && (
            <div className="absolute top-3 left-3 flex gap-2 text-[11px]">
              {(graph.constructs?.parallel) && <span className="chip bg-accent/20 text-accent">parallel fan-out</span>}
              {(graph.constructs?.pipeline) && <span className="chip bg-good/20 text-good">pipeline</span>}
              <span className="chip bg-panel2 text-muted">{graph.constructs?.agent_count} agents · {graph.phases.length} phases</span>
            </div>
          )}
        </div>
        <Inspector selected={selected} graph={graph} />
      </div>
    </div>
  );
}

function Palette({ onInsert }) {
  const items = [
    { label: "+ Agent step", snip: "const step = await agent('New agent task here', {label: 'step'})" },
    { label: "+ Parallel fan-out", snip: "const fan = await parallel(items.map(x => () => agent('Process ' + x, {label: 'fan'})))" },
    { label: "+ Conditional branch", snip: "if (result.passed) { await agent('On pass path', {label: 'pass'}) } else { await agent('On fail path', {label: 'fail'}) }" },
    { label: "+ New phase", snip: "phase('New Phase')" },
  ];
  return (
    <div className="card !p-3">
      <h3 className="font-semibold text-sm mb-2">Compose</h3>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <button key={it.label} onClick={() => onInsert(it.snip)}
            className="text-left text-xs bg-panel2 hover:bg-edge rounded-lg px-2.5 py-2 text-white/85 transition-colors">
            {it.label}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-muted mt-2">
        Add steps to see the dependency graph update <b>before</b> running anything.
      </div>
    </div>
  );
}

function Inspector({ selected, graph }) {
  return (
    <div className="card !p-3">
      <h3 className="font-semibold text-sm mb-2">Inspector</h3>
      {!selected && (
        <div className="text-xs text-muted">
          Click a node to inspect its role, phase, and handoffs.{" "}
          {graph && <>This workflow has <b className="text-white">{graph.constructs?.agent_count} agents</b> across <b className="text-white">{graph.phases.length} phases</b>.</>}
        </div>
      )}
      {selected && (
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <Field k="Node" v={selected.label} />
          <Field k="Phase" v={selected.phase || "—"} />
          <Field k="Runs in parallel" v={selected.parallel ? "Yes (fan-out)" : "Sequential"} />
        </div>
      )}
    </div>
  );
}
function Field({ k, v }) {
  return (
    <div className="bg-panel2 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className="text-white/90 mt-0.5">{v}</div>
    </div>
  );
}

/* ---- layout: columns by phase order ---- */
function layout(graph, setSelected) {
  if (!graph) return { nodes: [], edges: [] };
  const phases = graph.phases.length ? graph.phases : ["main"];
  const colOf = (n) => {
    if (n.type === "input") return 0;
    if (n.type === "output") return phases.length + 1;
    const i = phases.indexOf(n.phase);
    return (i < 0 ? 0 : i) + 1;
  };
  const colCounts = {};
  const nodes = graph.nodes.map((n) => {
    const col = colOf(n);
    const row = (colCounts[col] = (colCounts[col] || 0) + 1) - 1;
    const isIO = n.type === "input" || n.type === "output";
    return {
      id: n.id,
      type: isIO ? "io" : "agent",
      position: { x: col * 240, y: 60 + row * 110 },
      data: {
        label: n.label,
        phase: n.phase,
        parallel: n.parallel,
        out: n.type === "output",
        color: phaseColor(phases, n.phase),
        onClick: () => setSelected(n),
      },
    };
  });
  const edges = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
  }));
  return { nodes, edges };
}
