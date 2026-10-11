/**
 * Focused discovery diagnostic (controlled delivery test): drives
 * discoverWithBrowser directly with seeded real sources and full trace
 * output, so per-page/per-entity outcomes are visible without a full run.
 *
 * Usage: npx tsx scripts/diag-browser-discovery.mts [query] [seedUrl...]
 */
import { loadEnvFile } from "node:process";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".env")) loadEnvFile(".env");

const query = process.argv[2] ?? "Find solar installation companies in Windhoek, Namibia.";
const seeds = process.argv.slice(3);

const { buildSpec } = await import("../src/lib/search/search-spec");
const { extractFrameDeterministic } = await import("../src/lib/understanding/fallback");
const { frameToSearchSpec } = await import("../src/lib/understanding/to-search-spec");
const { discoverWithBrowser } = await import("../src/lib/search/browser-live.server");

const frame = extractFrameDeterministic(query);
const spec = frameToSearchSpec(frame);
console.log("[diag] entity:", spec.entity, "criteria:", JSON.stringify(spec.criteria.map((c) => [c.field, c.value])));

const traces: unknown[] = [];
const started = Date.now();
const rows = await discoverWithBrowser(spec, {
  searchRunId: `diag_${Date.now().toString(36)}`,
  seedUrls: seeds,
  timeoutMs: 100_000,
  onTrace: (event) => traces.push(event),
  onProgress: (event) => console.log("[progress]", event.action, event.source ?? "", event.detail ?? "", event.count ?? ""),
});
console.log(`[diag] elapsed=${Date.now() - started}ms rows=${rows.length}`);
for (const row of rows) {
  console.log(`[diag-row] ${row.title} | kind=${row.kind} | industry=${row.industry ?? "-"} | location=${row.location ?? "-"} | detail=${(row.detail ?? "").slice(0, 160)}`);
  console.log(`           evidence=${(row.evidence ?? []).map((e) => `${e.evidence_type}:${e.excerpt.slice(0, 90)}`).join(" || ")}`);
}
const interesting = traces.filter((t) => (t as { kind?: string }).kind === "entity" || (t as { kind?: string }).kind === "page");
writeFileSync("reports/diag-browser-discovery-traces.json", JSON.stringify(traces, null, 1));
console.log(`[diag] traces=${traces.length} (entity/page=${interesting.length}) written to reports/diag-browser-discovery-traces.json`);
