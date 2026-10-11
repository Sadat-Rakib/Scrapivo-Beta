// TEMP probe (Kiro final pass): query -> understanding frame -> SearchSpec, compact.
// Usage: npx tsx scripts/tmp-spec-probe.mts [--deterministic] ["query" ...]
import "./_env.mts";
import { understandFrame, frameToSearchSpec } from "../src/lib/understanding/to-search-spec";
import { extractFrameDeterministic } from "../src/lib/understanding/fallback";
import { validateFrame } from "../src/lib/understanding/validate";

const DEFAULT = [
  "find plumbers in Austin",
  "find SaaS founders globally",
  "find copywriters in Toronto",
  "plumbers in Austin and Dallas",
  "Founders complaining about lead generation",
  "find startup founders worldwide building fintech",
  "seed investors for AI startups in Canada",
  "companies hiring sales reps in Toronto",
  "find 25 marketing agencies in London with email addresses",
  "find unicorn ranchers in Atlantis",
  "People looking for a web designer",
  "React developer jobs in Calgary",
  "dentists in Toronto, Vancouver and Montreal with phone numbers",
];
const args = process.argv.slice(2);
const deterministic = args.includes("--deterministic");
const queries = args.filter((a) => !a.startsWith("--"));
for (const q of queries.length ? queries : DEFAULT) {
  const t0 = Date.now();
  try {
    const frame = deterministic
      ? validateFrame(extractFrameDeterministic(q)).frame
      : await understandFrame(q, {}, null);
    const spec = frameToSearchSpec(frame);
    console.log(JSON.stringify({
      q, ms: Date.now() - t0, extractor: frame.meta?.extractor, fallback: frame.meta?.fallback_used ?? false,
      entity: spec.entity, status: spec.status, locations: spec.locations ?? null,
      criteria: spec.criteria.map((c) => `${c.field}=${c.value}${c.stated ? "" : "(inferred)"}`),
      signal: spec.signal_required ? spec.signal_types : false, missing: spec.missing,
      unresolved: spec.unresolved ?? [],
    }));
  } catch (error) {
    console.log(JSON.stringify({ q, error: String(error).slice(0, 300) }));
  }
}
process.exit(0);
