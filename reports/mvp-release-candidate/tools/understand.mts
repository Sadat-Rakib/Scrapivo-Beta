// Inspect the live understanding path for one query (provider on, no persistence).
// usage: npx tsx reports/mvp-release-candidate/tools/understand.mts "<query>" [--det]
import { loadEnvFile } from "node:process";
process.env.SCRAPIVO_LOCAL_NO_PERSIST = "true";
loadEnvFile(".env");
process.env.SCRAPIVO_LOCAL_NO_PERSIST = "true";
const [query, flag] = process.argv.slice(2);
await (await import("../../../src/lib/search/gazetteer.server")).ensureCityGazetteer();
const { understandSearchSpec, frameToSearchSpec, applyClarificationToFrame } = await import("../../../src/lib/understanding/to-search-spec");
const { extractFrameDeterministic } = await import("../../../src/lib/understanding/fallback");
const { validateFrame } = await import("../../../src/lib/understanding/validate");
const { decideSpecClarification } = await import("../../../src/lib/search/spec-clarification");
const spec = flag === "--det"
  ? frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}))
  : await understandSearchSpec(query, {});
const f = spec.understanding!;
console.log(JSON.stringify({
  extractor: f.meta.extractor, provider: (f.meta as Record<string, unknown>).provider ?? null, fallback: f.meta.fallback_used, notes: f.meta.notes,
  entity: f.target.entity_type, category: f.target.category, industry: f.target.industry, role: f.target.role,
  relation: f.relation, location: f.location?.value, locations: f.locations.map((l) => l.value), required: f.required_fields.map((x) => x.value),
  objective: f.user_context.objective?.value ?? null, clarification: f.clarification,
  spec: { entity: spec.entity, criteria: spec.criteria.map((c) => `${c.field}=${c.value}`), purpose: spec.purpose ?? null },
  decision: decideSpecClarification(spec, false)?.id ?? null, forcedDecision: decideSpecClarification(spec, true)?.id ?? null,
}, null, 1));
process.exit(0);
