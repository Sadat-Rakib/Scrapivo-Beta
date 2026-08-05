/**
 * "sales teams" must classify as sales and surface non-ATS Posts.
 *   npx tsx scripts/verify-sales-teams.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.SCRAPIVO_DEBUG_STAGES = "1";
process.env.SEARXNG_URL = (process.env.SEARXNG_URL || "http://127.0.0.1:8888").replace(
  /:\/\/localhost(?=[:/]|$)/i,
  "://127.0.0.1",
);

import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified, isStronglyRelevantToSkill } from "../src/lib/search/query-expander";
import { personNoun, matchesCraft, craftVariants } from "../src/lib/search/demand-classifier";
import { searchAllSources } from "../src/lib/search/sources.server";
import { validateLeads } from "../src/lib/validation";
import { segmentLeads } from "../src/lib/search/lead-segments";
import { diversifiedTop12, type Lead } from "../src/lib/scoring";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) fail++;
};

const c = classifyQuery("sales teams");
const x = expandFromClassified(c);
console.log("classified", { core: c.coreSkill, role: c.roleTitle, type: c.type, skill: x.skill });
check("coreSkill is sales (not sales team)", c.coreSkill === "sales" || c.coreSkill.startsWith("sales"));
check("personNoun is sales rep-ish", /sales\s*rep|salesperson/i.test(personNoun(x.skill, x.role)));
check(
  "matches 'Hiring a sales rep'",
  !!matchesCraft("Hiring a sales rep for our startup", craftVariants(x.skill)),
);

const { leads: raw } = await searchAllSources({ classified: c, expanded: x });
const by: Record<string, number> = {};
for (const l of raw) by[l.source] = (by[l.source] ?? 0) + 1;
console.log(
  "\nraw top:",
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15),
);
const socialRaw = raw.filter((l) =>
  ["linkedin", "instagram", "facebook", "twitter", "threads", "quora", "reddit", "hn", "github"].includes(
    l.source,
  ),
);
check(`social/community raw >= 2 (got ${socialRaw.length})`, socialRaw.length >= 2);

const validated = validateLeads(raw as Lead[], c, x, { preferJunior: false });
const quality = validated.filter((l) => {
  const text = `${l.title} ${l.snippet}`;
  return (
    isStronglyRelevantToSkill(text, c.coreSkill) ||
    c.relatedSkills.some((s) => isStronglyRelevantToSkill(text, s)) ||
    l.demand_verified === true
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
const src: Record<string, number> = {};
for (const l of posts) src[l.source] = (src[l.source] ?? 0) + 1;
console.log("\nPosts sources:", src);
const nonAts = posts.filter(
  (l) => !["jobicy", "arbeitnow", "greenhouse", "ashby", "lever", "remoteok"].includes(l.source),
);
check(`Posts has non-ATS sources (got ${nonAts.length})`, nonAts.length >= 2);

console.log(`\n${fail === 0 ? "PASS" : `FAIL — ${fail}`}`);
process.exit(fail === 0 ? 0 : 1);
