import { buildSpec } from "../src/lib/search/search-spec";
import { runLiveGapfill } from "../src/lib/search/live-gapfill";

const spec = buildSpec({
  entity: "business",
  raw_query: "active HVAC contractors in Toronto with phone",
  criteria: [
    { field: "category", value: "HVAC", stated: true, confidence: 1 },
    { field: "location", value: "Toronto", stated: true, confidence: 1 },
    { field: "required_field", value: "phone", stated: true, confidence: 1 },
  ],
});

const started = Date.now();
const result = await runLiveGapfill(spec, { web: null });
process.stdout.write(JSON.stringify({
  engine: result.engine,
  rows: result.rows.length,
  scanned: result.scanned,
  elapsedMs: Date.now() - started,
  diagnostics: result.diagnostics?.map((item) => ({
    provider: item.provider,
    attempted: item.attempted,
    succeeded: item.succeeded,
    found: item.artifactsFound,
    error: item.error ?? null,
  })),
}) + "\n");
