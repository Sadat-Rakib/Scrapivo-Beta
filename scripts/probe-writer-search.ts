/**
 * Live probe: uncommon craft "writer" through full Discover pipeline.
 *   npx tsx scripts/probe-writer-search.ts
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
import { expandFromClassified, isStronglyRelevantToSkill } from "../src/lib/search/query-expander";
import { searchAllSources } from "../src/lib/search/sources.server";
import { validateLeads } from "../src/lib/validation";
import { segmentLeads } from "../src/lib/search/lead-segments";
import { diversifiedTop12, type Lead } from "../src/lib/scoring";

const q = process.argv[2] || "need a writer";
console.log("QUERY:", q);
console.log("paidDiscoveryEnabled", paidDiscoveryEnabled());
console.log("SERPAPI", !!process.env.SERPAPI_KEY, "SEARXNG", process.env.SEARXNG_URL || "(unset)");

const classified = classifyQuery(q);
classified.goal = "clients";
classified.audience = "all";
// Preserve product / role-template expanders. Only force buying_signal for
// craft client-hunts — product pitches and investor/tutor templates own their mode.
if (classified.type !== "product" && classified.signalMode !== "buying_signal") {
  classified.signalMode = "buying_signal";
}
const expanded = expandFromClassified(classified);
console.log("classified", {
  core: classified.coreSkill,
  goal: classified.goal,
  type: classified.type,
  signal: classified.signalMode,
  audience: classified.audience,
  location: classified.location,
});
console.log("expanded skill", expanded.skill, "phrases", expanded.buyerPhrases.slice(0, 3));

const t0 = Date.now();
const { leads: raw, debug } = await searchAllSources({ classified, expanded });
console.log("raw leads", raw.length, "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
const by: Record<string, number> = {};
for (const l of raw) by[l.source] = (by[l.source] ?? 0) + 1;
console.log(
  "raw sources",
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25),
);
console.log("debug sourceCounts", debug?.sourceCounts ?? "(none)");

const validated = validateLeads(raw as Lead[], classified, expanded, { preferJunior: false });
console.log("validated", validated.length);

const quality = validated.filter((l) => {
  const text = `${l.title || ""} ${l.snippet || ""}`;
  const skillOk =
    isStronglyRelevantToSkill(text, classified.coreSkill) ||
    (classified.relatedSkills || []).some((s) => isStronglyRelevantToSkill(text, s));
  const productOk =
    classified.type === "product" &&
    /invoice|invoicing|billing|client|freelance|crm|bookkeep/i.test(text);
  const tutorOk =
    /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${classified.raw}`) &&
    /\b(tutor|tutoring|homework|lessons|instructor)\b/i.test(text);
  return (
    skillOk ||
    productOk ||
    tutorOk ||
    l.demand_verified === true ||
    [
      "greenhouse",
      "ashby",
      "jobicy",
      "arbeitnow",
      "lever",
      "dealroom",
      "tenders",
      "workatastartup",
      "startupsgallery",
      "stackexchange",
      "neuronfeed",
      "freelancer",
    ].includes(l.source)
  );
});
console.log("quality pool", quality.length);

const volumePersona =
  classified.type === "product" ||
  /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${classified.raw}`);
const pool = [...quality]
  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  .slice(0, 500) as Lead[];
const div = diversifiedTop12(pool, {
  maxJobBoard: 2,
  maxCompanyAts: 150,
  minSocial: 15,
  maxReddit: volumePersona ? 60 : 40,
  maxTotal: 500,
  minScore: 45,
  maxPerPlatform: 500,
  maxFreelancer: 50,
});
console.log("diversified", div.length);

const segs = segmentLeads(pool);
const posts = div;
const cos = segs.companies.slice(0, 150);
const ppl = segs.people.slice(0, 150);
console.log("\n=== TAB COUNTS ===");
console.log("Posts", posts.length);
console.log("Companies", cos.length);
console.log("People", ppl.length);

const pBy: Record<string, number> = {};
for (const l of posts) pBy[l.source] = (pBy[l.source] ?? 0) + 1;
console.log(
  "Posts sources",
  Object.entries(pBy).sort((a, b) => b[1] - a[1]),
);

const tiers = { hot: 0, warm: 0, other: 0 };
for (const l of div) {
  const t = l.intent_tier || l.tier;
  if (t === "hot") tiers.hot++;
  else if (t === "warm") tiers.warm++;
  else tiers.other++;
}
console.log("tiers (all ranked)", tiers);

console.log("\nSample posts:");
for (const l of posts.slice(0, 8)) {
  console.log("-", l.tier || l.intent_tier || "?", l.source, "|", (l.title || "").slice(0, 70));
}
console.log("\nSample companies:");
for (const c of cos.slice(0, 6)) {
  console.log(
    "-",
    c.name,
    "|",
    c.leads?.[0]?.source,
    "| email?",
    !!c.inline_contacts?.emails?.[0],
  );
}
console.log("\nSample people:");
for (const p of ppl.slice(0, 6)) {
  console.log(
    "-",
    p.name,
    "|",
    p.leads?.[0]?.source,
    "| email?",
    !!p.inline_contacts?.emails?.[0],
  );
}

const nonReddit = posts.filter(
  (l) => l.source !== "reddit" && l.source !== "redditrss" && l.source !== "hn",
);
console.log("\nnon-reddit/hn posts", nonReddit.length);
console.log(tiers.other === 0 ? "PASS hot/warm only" : `FAIL has other tiers: ${tiers.other}`);
