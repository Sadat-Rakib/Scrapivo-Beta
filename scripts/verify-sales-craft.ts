/**
 * When the user's craft IS sales, sales-shaped titles must survive.
 *
 * Reported from a live "sales" demo search: socialdorks returned LinkedIn /
 * Instagram / Facebook rows, but validate wiped every one of them
 * (offSkillRole:32). The sales-partner and off-skill guards were written for
 * designers who must not see "Sales Closer at a Design Agency" — they fire
 * unconditionally, so a sales search deletes its own craft.
 *
 *   npx tsx scripts/verify-sales-craft.ts
 */
import {
  isOffSkillRole,
  isSellerOrProviderLead,
  validateLeads,
} from "../src/lib/validation";
import type { Lead } from "../src/lib/scoring";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";

function lead(over: Partial<Lead> & { title: string }): Lead {
  return {
    source: over.source ?? "linkedin",
    platform: over.platform ?? "LinkedIn",
    title: over.title,
    snippet: over.snippet ?? over.title,
    full_post_url:
      over.full_post_url ?? `https://linkedin.com/posts/demo_${Math.random().toString(36).slice(2)}`,
    author: over.author ?? "Jane Founder",
    demand_verified: over.demand_verified ?? true,
    ...over,
  } as Lead;
}

const salesKeep = [
  "Looking for a sales rep to join our startup",
  "Need a sales closer — commission only — SaaS",
  "Hiring Sales Manager for outbound team",
  "Anyone recommend a good sales executive?",
  "Sales Strategy & Operations @ openai",
];

const designDrop = [
  "[HIRING] Remote Sales Closer – Web Design Agency – Commission Only – Leads Provided",
  "Sales Rep needed for our design studio",
];

let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 90)}`);
  if (!ok) failures++;
};

console.log("\nSales craft — sales titles must KEEP ─────────────────────");
for (const t of salesKeep) {
  check(
    `offSkill "${t}"`,
    !isOffSkillRole(lead({ title: t }), "sales", ["selling", "sdr", "bdr"]),
  );
  check(
    `seller  "${t}"`,
    !isSellerOrProviderLead(lead({ title: t, source: "linkedin" }), "sales", ["selling", "sdr"]),
  );
}

console.log("\nDesign craft — sales-at-design-agency must DROP ──────────");
for (const t of designDrop) {
  check(`offSkill "${t}"`, isOffSkillRole(lead({ title: t, source: "reddit" }), "design", ["logo"]));
}

console.log("\nFull validate on a sales search keeps social ─────────────");
const classified = classifyQuery("sales");
const expanded = expandFromClassified(classified);
const social = salesKeep.map((t, i) =>
  lead({
    title: t,
    source: i % 2 ? "instagram" : "linkedin",
    platform: i % 2 ? "Instagram" : "LinkedIn",
    demand_verified: true,
    score: 50,
  }),
);
const kept = validateLeads(social, classified, expanded, { preferJunior: false });
check(`kept ${kept.length}/${social.length} social sales leads`, kept.length >= 3);

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
