/**
 * Live "need a design" with paid sources — what survives into Posts?
 *   npx tsx scripts/verify-design-mix.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.SCRAPIVO_DEBUG_STAGES = "1";
process.env.USE_PAID_SOURCES = "true";

import { paidDiscoveryEnabled } from "../src/lib/search/paid-discovery";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchAllSources } from "../src/lib/search/sources.server";
import { validateLeads } from "../src/lib/validation";
import { segmentLeads } from "../src/lib/search/lead-segments";
import { diversifiedTop12, type Lead } from "../src/lib/scoring";
import { isStronglyRelevantToSkill } from "../src/lib/search/query-expander";

console.log("paidDiscoveryEnabled", paidDiscoveryEnabled());
console.log("SERPAPI set", !!process.env.SERPAPI_KEY);

const classified = classifyQuery("need a design");
const expanded = expandFromClassified(classified);
console.log("classified", {
  core: classified.coreSkill,
  goal: classified.goal,
  signal: classified.signalMode,
  type: classified.type,
});

const { leads: raw, debug } = await searchAllSources({ classified, expanded });
const by: Record<string, number> = {};
for (const l of raw) by[l.source] = (by[l.source] ?? 0) + 1;
console.log("\nraw top:", Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 20));
console.log("debug sourceCounts", debug?.sourceCounts ?? "(none)");

const socialish = Object.entries(by).filter(([s]) =>
  ["linkedin", "instagram", "facebook", "twitter", "threads", "quora", "serpapi", "tavily", "hn", "github", "discourse", "lemmy", "mastodon", "secedgar", "tenders", "news"].includes(s),
);
console.log("non-reddit interesting:", socialish);

const validated = validateLeads(raw as Lead[], classified, expanded, { preferJunior: false });
const vBy: Record<string, number> = {};
for (const l of validated) vBy[l.source] = (vBy[l.source] ?? 0) + 1;
console.log("validated:", vBy);

const quality = validated.filter((l) => {
  const text = `${l.title} ${l.snippet}`;
  return (
    isStronglyRelevantToSkill(text, classified.coreSkill) ||
    classified.relatedSkills.some((s) => isStronglyRelevantToSkill(text, s)) ||
    l.demand_verified === true ||
    ["greenhouse", "ashby", "jobicy", "arbeitnow", "lever"].includes(l.source)
  );
});
const div = diversifiedTop12(quality as Lead[], {
  maxJobBoard: 2,
  maxCompanyAts: 36,
  minSocial: 8,
  maxTotal: 120,
  minScore: 22,
  maxPerPlatform: 20,
});
const posts = segmentLeads(div).posts;
const pBy: Record<string, number> = {};
for (const l of posts) pBy[l.source] = (pBy[l.source] ?? 0) + 1;
console.log("\nPosts:", posts.length, pBy);

const nonReddit = posts.filter((l) => l.source !== "reddit" && l.source !== "redditrss");
console.log(nonReddit.length >= 2 ? "PASS" : "FAIL", "non-reddit posts", nonReddit.length);
process.exit(nonReddit.length >= 2 ? 0 : 1);
