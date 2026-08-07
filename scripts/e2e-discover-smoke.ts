/**
 * End-to-end Discover smoke: SERP adapter → searchAllSources → diversify → top-3 PIE.
 *   npx tsx scripts/e2e-discover-smoke.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.USE_PAID_SOURCES = "true";

import { paidDiscoveryEnabled } from "../src/lib/search/paid-discovery";
import { hasGoogleSerpProvider, searchGoogleSerp } from "../src/lib/search/serp-providers.server";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchAllSources, searchSerpAPI } from "../src/lib/search/sources.server";
import { validateLeads } from "../src/lib/validation";
import { diversifiedTop12, type Lead } from "../src/lib/scoring";
import { enrichTopLeadContacts } from "../src/lib/contact/pie-top-leads.server";

const fail: string[] = [];
const ok: string[] = [];

function assert(cond: boolean, msg: string) {
  if (cond) ok.push(msg);
  else fail.push(msg);
}

console.log("=== E2E Discover smoke ===");
console.log({
  paid: paidDiscoveryEnabled(),
  hasSerp: hasGoogleSerpProvider(),
  serper: !!process.env.SERPER_API_KEY,
  dog: !!process.env.SCRAPINGDOG_API_KEY,
  enrichment: !!process.env.ENRICHMENTAPI_KEY,
  tavily: !!process.env.TAVILY_API_KEY,
});

assert(paidDiscoveryEnabled(), "USE_PAID_SOURCES=true");
assert(hasGoogleSerpProvider(), "hasGoogleSerpProvider");

// 1) Adapter unit: one LinkedIn dork via Serper
const serpSample = await searchGoogleSerp(
  `site:linkedin.com/posts ("looking for a web designer" OR "need a web designer")`,
  { tbs: "qdr:w", num: 8 },
);
assert(!!serpSample && serpSample.organic_results.length > 0, `searchGoogleSerp LinkedIn n=${serpSample?.organic_results.length ?? 0} provider=${serpSample?.provider}`);
assert(serpSample?.provider === "serper" || serpSample?.provider === "scrapingdog", `provider is hosted (${serpSample?.provider})`);

// 2) searchSerpAPI multi-dork
const serpLeads = await searchSerpAPI(
  expandFromClassified(classifyQuery("looking for a web designer")),
);
const serpBySource: Record<string, number> = {};
for (const l of serpLeads) serpBySource[l.source] = (serpBySource[l.source] ?? 0) + 1;
console.log("searchSerpAPI leads", serpLeads.length, serpBySource);
assert(serpLeads.length > 0, `searchSerpAPI returned ${serpLeads.length} leads`);
const socialFromSerp = serpLeads.filter((l) =>
  ["linkedin", "twitter", "facebook", "instagram"].includes(l.source),
).length;
assert(socialFromSerp > 0, `searchSerpAPI social platforms count=${socialFromSerp}`);

// 3) Full Discover fan-out
const classified = classifyQuery("looking for a web designer");
classified.goal = "clients";
const expanded = expandFromClassified(classified);
console.log("classified", { core: classified.coreSkill, goal: classified.goal, signal: classified.signalMode });

const t0 = Date.now();
const { leads: raw, debug, sources } = await searchAllSources({ classified, expanded });
const elapsed = Date.now() - t0;
const by: Record<string, number> = {};
for (const l of raw) by[l.source] = (by[l.source] ?? 0) + 1;
console.log(`searchAllSources ${raw.length} leads in ${elapsed}ms`);
console.log("sources used:", sources?.slice?.(0, 30) ?? sources);
console.log(
  "top sources:",
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15),
);

assert(raw.length >= 20, `volume: raw leads >= 20 (got ${raw.length})`);
const hasSocial = ["linkedin", "twitter", "facebook", "instagram"].some((s) => (by[s] ?? 0) > 0);
const hasFiller = ["freelancer", "hn", "reddit", "redditrss", "tavily"].some((s) => (by[s] ?? 0) > 0);
assert(hasSocial, `social present in mix: ${JSON.stringify(Object.fromEntries(Object.entries(by).filter(([k]) => ["linkedin","twitter","facebook","instagram"].includes(k))))}`);
assert(hasFiller || raw.length > 40, `filler or high volume present`);

const validated = validateLeads(raw as Lead[], classified, expanded, { preferJunior: false });
const quality = validated.filter((l) => (l.score ?? 0) >= 45 || l.demand_verified);
const ranked = diversifiedTop12(quality.length ? quality : validated, {
  directoryMode: false,
  maxJobBoard: 2,
  maxCompanyAts: 120,
  minSocial: 10,
  maxReddit: 450,
  maxTotal: 450,
  minScore: 45,
  maxPerPlatform: 450,
  maxFreelancer: 450,
});
console.log("ranked", ranked.length);
assert(ranked.length >= 8, `ranked results >= 8 (got ${ranked.length})`);

const rankedSocial = ranked.filter((l) =>
  /linkedin|twitter|facebook|instagram|x\.com/i.test(`${l.source} ${l.platform} ${l.full_post_url}`),
).length;
console.log("ranked social-ish", rankedSocial);
assert(rankedSocial > 0 || socialFromSerp > 0, "social survives into ranked or SERP path");

// 4) Top-3 PIE
const withContacts = await enrichTopLeadContacts(ranked.slice(0, 12));
const top3 = withContacts.slice(0, 3);
const contactHits = top3.filter(
  (l) => (l.inline_contacts?.emails?.length ?? 0) + (l.inline_contacts?.phones?.length ?? 0) > 0,
).length;
console.log(
  "top3 contacts:",
  top3.map((l) => ({
    title: l.title?.slice(0, 60),
    source: l.source,
    emails: l.inline_contacts?.emails ?? [],
    phones: l.inline_contacts?.phones ?? [],
  })),
);
// Soft assert: PIE path runs without throw; contacts optional depending on public data
assert(top3.length === 3, "top3 enriched array length 3");
ok.push(`PIE path completed; contacts on ${contactHits}/3 top cards`);

console.log("\n=== PASS ===");
for (const m of ok) console.log(" ✓", m);
if (fail.length) {
  console.log("\n=== FAIL ===");
  for (const m of fail) console.log(" ✗", m);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
