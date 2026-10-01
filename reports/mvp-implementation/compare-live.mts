import { readFile } from "node:fs/promises";
import { extractFrameDeterministic } from "../../src/lib/understanding/fallback";
import { validateFrame } from "../../src/lib/understanding/validate";
import { frameToSearchSpec } from "../../src/lib/understanding/to-search-spec";

const rows = JSON.parse(await readFile("reports/mvp-implementation/LIVE_PROVIDER_RESULTS.json", "utf8")) as Array<{ query: string }>;
for (const [i, row] of rows.entries()) {
  const frame = validateFrame(extractFrameDeterministic(row.query)).frame;
  const spec = frameToSearchSpec(frame);
  console.log(JSON.stringify({
    case: i + 1,
    entity: spec.entity,
    purpose: spec.purpose,
    location: spec.locations,
    requested: spec.requested_fields,
    exclusions: spec.criteria.filter((c) => c.field.startsWith("exclude_")).map((c) => `${c.field}=${c.value}`),
    signal: spec.signal_required,
    social: spec.criteria.some((c) => /social|last_post/.test(c.field)),
  }));
}
