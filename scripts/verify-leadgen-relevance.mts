/**
 * Relevance purity for "lead generation services".
 *   npx tsx scripts/verify-leadgen-relevance.mts
 */
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import { expandFromClassified } from "../src/lib/search/query-expander.ts";
import {
  isRelevantToQuery,
  isOffSkillRole,
  isSellerOrProviderLead,
  isSalesFamilyCraft,
} from "../src/lib/validation.ts";
import { isStronglyRelevantToSkill, getSkillSynonyms } from "../src/lib/search/query-expander.ts";

let pass = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
};

const cq = classifyQuery("lead generation services");
cq.goal = "clients";

console.log("\n── Classification ───────────────────────────────────────");
check("not misclassified as product", cq.type !== "product", cq.type);
check("sales-family craft", isSalesFamilyCraft(cq.coreSkill, cq.relatedSkills), cq.coreSkill);
check(
  "relatedSkills has no bare lead/generation/services",
  !cq.relatedSkills.some((s) => /^(lead|leads|generation|service|services)$/i.test(s)),
  cq.relatedSkills,
);
const syns = getSkillSynonyms(cq.coreSkill);
check(
  "synonyms exclude bare lead",
  !syns.some((s) => s === "lead" || s === "leads" || s === "generation" || s === "services"),
  syns,
);

const expanded = expandFromClassified(cq);
check(
  "expanded skill is not bare lead",
  !/^(lead|leads|generation|services)$/i.test(expanded.skill),
  expanded.skill,
);
check(
  "no reddit best lead fanout",
  !expanded.redditBuyerQueries.some((q) => /\bbest lead\b/i.test(q) && !/lead gen/i.test(q)),
  expanded.redditBuyerQueries.slice(0, 8),
);

console.log("\n── Reject junk ──────────────────────────────────────────");
const junk = [
  "Construction company seeking Lead Man in Berea, KY area",
  "Rhythm Guitarist Wanted for Alternative Rock Band",
  "Create a Small WordPress Website for Mobile Notary Services",
  "Automated Long-Form Video Generation System, Tool or Web",
  "Oxide Computer raises $445M (SEC Form D)",
  "WE'RE HIRING!! Best Ever Food Review Show",
  "Swap Randy Levensalor for Ben Hepworth as CodeOwner",
  "Hydro Jetting Services in Bangkok/Nonthaburi",
  "I'm officially looking for a lead guitarist to join me!",
  "Ask HN Who Is Hiring (August 2026)",
  "Oscilar.com | Site Lead, Sr/Staff Software Engineers",
];

for (const title of junk) {
  const lead = { title, snippet: title, source: "freelancer", platform: "Freelancer" } as any;
  const ok =
    isRelevantToQuery(lead, cq.coreSkill, cq.relatedSkills, cq) &&
    !isOffSkillRole(lead, cq.coreSkill, cq.relatedSkills);
  check(`reject: ${title.slice(0, 48)}`, !ok);
}

const buska = {
  title: "Buska - Social Listening for Lead Generation | Finds Buyers ...",
  snippet: "our social listening tool for lead generation finds buyers",
  source: "linkedin",
  platform: "LinkedIn",
} as any;
check(
  "reject seller product pitch Buska",
  isSellerOrProviderLead(buska, cq.coreSkill, cq.relatedSkills) ||
    !isRelevantToQuery(buska, cq.coreSkill, cq.relatedSkills, cq),
);

console.log("\n── Keep real buyers ─────────────────────────────────────");
const good = [
  "Hiring Freelance Lead Generation & Business Development Specialists",
  "Need 100 verified leads for Fitness Industry",
  "Google & Meta Ads Lead Generation",
  "Commission-Based Lead Generation BDE",
  "Looking for project-based/part-time lead-sourcing (automation) specialist",
  "B2B Sales Lead Email Copy",
];
for (const title of good) {
  const lead = {
    title,
    snippet: `looking to hire ${title}`,
    source: "freelancer",
    platform: "Freelancer",
  } as any;
  check(`keep: ${title.slice(0, 48)}`, isRelevantToQuery(lead, cq.coreSkill, cq.relatedSkills, cq));
}

check(
  "Team Lead alone is NOT strong skill match",
  !isStronglyRelevantToSkill("Hiring a Team Lead for engineering", cq.coreSkill),
);

console.log(`\n${pass}/${pass + fails.length} correct`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  " + f);
}
process.exit(fails.length ? 1 : 0);
