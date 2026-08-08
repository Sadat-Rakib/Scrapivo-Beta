/**
 * End-to-end Discover smoke: classify → fan-out → quality pool → segment counts.
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
process.env.USE_PAID_SOURCES = process.env.USE_PAID_SOURCES || "true";

const q =
  process.argv[2] ||
  "I'm a designer looking for people and companies who need designers";

console.log("── Discover E2E:", q, "──");

const { classifyQuery, inferGoalFromQuery } = await import(
  "../src/lib/search/query-classifier.ts"
);
const { expandFromClassified } = await import("../src/lib/search/query-expander.ts");
const { searchAllSources } = await import("../src/lib/search/sources.server.ts");
const { segmentLeads } = await import("../src/lib/search/lead-segments.ts");
const { dedupeByUrl, fuzzyDedupeLeads, diversifiedTop12 } = await import("../src/lib/scoring.ts");
const { validateLeads } = await import("../src/lib/validation.ts");

const classified = classifyQuery(q);
classified.goal = inferGoalFromQuery(q) ?? "clients";
classified.audience = "all";
const expanded = expandFromClassified(classified);

console.log("classified", {
  skill: classified.coreSkill,
  goal: classified.goal,
  signal: classified.signalMode,
  type: classified.type,
});

const t0 = Date.now();
const { leads, debug } = await searchAllSources({ classified, expanded });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const bySrc: Record<string, number> = {};
for (const l of leads) bySrc[l.source ?? "?"] = (bySrc[l.source ?? "?"] ?? 0) + 1;

const deduped = fuzzyDedupeLeads(dedupeByUrl(leads));
const validated = validateLeads(deduped, classified, expanded, {});
const pool = [...validated].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 500);
const posts = diversifiedTop12(pool, {
  maxTotal: 500,
  minSocial: 15,
  maxReddit: 60,
  minScore: 35,
  maxFreelancer: 60,
  maxCompanyAts: 150,
  maxJobBoard: 2,
  maxPerPlatform: 500,
});
const segments = segmentLeads(pool, { craft: classified.coreSkill || expanded.skill });

const socialKeys = ["linkedin", "twitter", "facebook", "instagram", "socialdorks", "serpapi"];
const socialInRaw = socialKeys.reduce((n, k) => n + (bySrc[k] || 0), 0);
const socialFetch = socialKeys.reduce(
  (n, k) => n + (debug?.sourceCounts?.[k] ?? 0),
  0,
);

const report = {
  elapsed_s: elapsed,
  raw: leads.length,
  validated: validated.length,
  pool: pool.length,
  posts: posts.length,
  companies: segments.companies.slice(0, 150).length,
  people: segments.people.slice(0, 150).length,
  social_in_raw: socialInRaw,
  social_fetch_counts: socialFetch,
  top_sources: Object.entries(bySrc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10),
  fetch_social: {
    socialdorks: debug?.sourceCounts?.socialdorks ?? 0,
    serpapi: debug?.sourceCounts?.serpapi ?? 0,
    linkedin: debug?.sourceCounts?.linkedin ?? 0,
    twitter: debug?.sourceCounts?.twitter ?? 0,
    facebook: debug?.sourceCounts?.facebook ?? 0,
    instagram: debug?.sourceCounts?.instagram ?? 0,
  },
};

console.log(JSON.stringify(report, null, 2));

const pass =
  leads.length >= 80 &&
  posts.length >= 30 &&
  segments.companies.length >= 10 &&
  segments.people.length >= 5 &&
  (socialFetch > 0 || socialInRaw > 0);

console.log(pass ? "DISCOVER E2E PASS" : "DISCOVER E2E FAIL (volume/social below demo threshold)");
process.exit(pass ? 0 : 1);
