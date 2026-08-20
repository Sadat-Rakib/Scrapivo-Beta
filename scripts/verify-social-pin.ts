/**
 * Verify social pin + PIE targeting after Freelancer-heavy ranking.
 *   npx tsx scripts/verify-social-pin.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.USE_PAID_SOURCES = "true";

import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchSerpAPI } from "../src/lib/search/sources.server";
import { diversifiedTop12, type Lead } from "../src/lib/scoring";
import { enrichTopLeadContacts } from "../src/lib/contact/pie-top-leads.server";

const qx = expandFromClassified(classifyQuery("looking for a web designer"));
const serp = await searchSerpAPI(qx);
console.log(
  "serp",
  serp.length,
  Object.fromEntries(
    Object.entries(
      serp.reduce((a: Record<string, number>, l) => {
        a[l.source] = (a[l.source] ?? 0) + 1;
        return a;
      }, {}),
    ),
  ),
);

const filler: Lead[] = Array.from({ length: 30 }, (_, i) => ({
  source: "freelancer",
  platform: "Freelancer",
  title: `Logo Design Needed ${i}`,
  snippet: "Need a logo for my brand asap budget 50",
  full_post_url: `https://www.freelancer.com/projects/x${i}`,
  score: 70,
  demand_verified: true,
}));

const social = serp.map((l) => ({ ...l, score: l.score ?? 65 }));
const ranked = diversifiedTop12([...social, ...filler], {
  minSocial: 10,
  maxTotal: 80,
  maxFreelancer: 80,
  maxReddit: 80,
  maxPerPlatform: 80,
  minScore: 0,
  maxJobBoard: 2,
  maxCompanyAts: 20,
});

const top6 = ranked.slice(0, 6).map((l) => ({
  source: l.source,
  platform: l.platform,
  title: l.title?.slice(0, 40),
}));
console.log("top6", top6);
const socialTop = ranked
  .slice(0, 6)
  .filter((l) => /linkedin|twitter|facebook|instagram/i.test(`${l.source} ${l.platform}`)).length;
console.log("social_in_top6", socialTop);
if (socialTop < 2) {
  console.error("FAIL: expected >=2 social in top 6");
  process.exit(1);
}

const enriched = await enrichTopLeadContacts(ranked.slice(0, 12));
console.log(
  "enrich_sample",
  enriched.slice(0, 6).map((l) => ({
    source: l.source,
    emails: l.inline_contacts?.emails?.length ?? 0,
    phones: l.inline_contacts?.phones?.length ?? 0,
  })),
);
console.log("PASS social pin");
