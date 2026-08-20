/**
 * Quick live sample: titles + relevance flags for a craft query.
 *   npx tsx scripts/sample-live-relevance.mts "react developer"
 */
import "./_env.mts";
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import { expandQuery } from "../src/lib/search/query-expander.ts";
import { searchAllSources } from "../src/lib/search/sources.server.ts";
import { isRelevantToQuery, isSellerOrProviderLead } from "../src/lib/validation.ts";

const q = process.argv.slice(2).join(" ") || "react developer";
const classified = classifyQuery(q);
classified.goal = "clients";
const expanded = expandQuery(q);
const t0 = Date.now();
const { leads, sources } = await searchAllSources({ classified, expanded } as never);
const ms = Date.now() - t0;

let relevant = 0;
let sellers = 0;
for (const l of leads as any[]) {
  if (isRelevantToQuery(l, classified.coreSkill, classified.relatedSkills, classified)) relevant++;
  if (isSellerOrProviderLead(l)) sellers++;
}

console.log(`\nQuery: "${q}"`);
console.log(
  `coreSkill: ${classified.coreSkill} | type: ${classified.type} | goal: ${classified.goal}`,
);
console.log(`Leads: ${leads.length} from ${sources.length} sources in ${ms}ms`);
console.log(`Relevant (isRelevantToQuery): ${relevant}/${leads.length}`);
console.log(`Seller/provider flagged: ${sellers}/${leads.length}`);
console.log("\n── Sample (first 12) ──");
for (const l of (leads as any[]).slice(0, 12)) {
  const rel = isRelevantToQuery(l, classified.coreSkill, classified.relatedSkills, classified);
  const sell = isSellerOrProviderLead(l);
  const flags = [rel ? "KEEP" : "DROP", sell ? "SELLER" : ""].filter(Boolean).join(" ");
  console.log(
    `  [${flags}] ${(l.platform || l.source || "?").padEnd(12)} ${(l.title || "").slice(0, 85)}`,
  );
}
