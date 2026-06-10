const BASE = ""; // same-origin in prod; Vite proxies /api in dev

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

export const api = {
  meta: () => get("/api/meta"),
  cost: (source) => get(`/api/cost?source=${source}`),
  tco: (source, articles) => get(`/api/tco?source=${source}&articles=${articles}`),
  contentforgeRuns: () => get("/api/contentforge-runs"),
  comparison: (articles, tier) => get(`/api/comparison?articles=${articles}&validator_tier=${tier}`),
  sessions: (source) => get(`/api/sessions?source=${source}`),
  governance: (mode, surface) => get(`/api/governance?mode=${mode}&surface=${surface}`),
  workflowSample: () => get("/api/workflow/sample"),
  examples: () => get("/api/workflow/examples"),
  workflow: (script) => post("/api/workflow", { script }),
};
