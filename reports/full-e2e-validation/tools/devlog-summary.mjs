// QA-only: summarize every search in the dev-server log ([spec-run], [candidate-ledger],
// browser runtime). Writes evidence/devlog-summary.json and prints one line per run.
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("reports/full-e2e-validation/logs/dev.log", "utf8").split(/\r?\n/);
const parse = (line, tag) => { try { return JSON.parse(line.slice(line.indexOf(tag) + tag.length)); } catch { return null; } };
const runs = new Map();
const get = (id) => { if (!runs.has(id)) runs.set(id, { run: id }); return runs.get(id); };
for (const line of lines) {
  if (line.includes("[spec-run]")) {
    const s = parse(line, "[spec-run]");
    if (!s?.search_run_id) continue;
    const t = s.retrievalTrace ?? {};
    Object.assign(get(s.search_run_id), {
      query: s.query, entity: s.entity, outcome: s.outcome, signalRequired: s.signal_required,
      criteria: (s.criteria ?? []).map((c) => `${c.field}=${c.value}`), retrieved: s.retrieved, returned: s.returned,
      reason: t.reason ?? null, health: t.sourceHealth?.summary ?? null, totalMs: t.timings?.total_ms ?? null,
    });
  } else if (line.includes("[candidate-ledger]")) {
    const s = parse(line, "[candidate-ledger]");
    if (s?.search_run_id) Object.assign(get(s.search_run_id), { ledger: s.counts, rejectReasons: s.rejectReasons, streamed: s.streamed, streamedNotReturned: (s.streamedNotReturned ?? []).length });
  } else if (line.includes("[browser-live]") && line.includes('"action":"runtime"')) {
    const s = parse(line, "[browser-live]");
    if (s?.run) get(s.run).runtime = `${s.used}${s.reason ? ` (${s.reason})` : ""}`;
  }
}
const out = [...runs.values()].filter((r) => r.query);
writeFileSync("reports/full-e2e-validation/evidence/devlog-summary.json", JSON.stringify(out, null, 2));
for (const r of out) console.log(JSON.stringify({ q: r.query, outcome: r.outcome, returned: r.returned, criteria: r.criteria, runtime: r.runtime ?? "-", ledger: r.ledger, reasons: r.rejectReasons, streamed: r.streamed, health: r.health, s: r.totalMs ? Math.round(r.totalMs / 1000) : null }));
