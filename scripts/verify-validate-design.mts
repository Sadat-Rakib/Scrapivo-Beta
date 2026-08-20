/**
 * Ensure "need a design" leads survive validateLeads (was 8→0).
 * Run: npx tsx scripts/verify-validate-design.mts
 */
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import { expandFromClassified } from "../src/lib/search/query-expander.ts";
import { validateLeads, isOffSkillRole } from "../src/lib/validation.ts";
import type { Lead } from "../src/lib/scoring.ts";

const fail: string[] = [];
const ok = (n: string, c: boolean) => {
  if (!c) fail.push(n);
  else console.log("OK:", n);
};

const cq = classifyQuery("need a design");
cq.goal = "clients";
const ex = expandFromClassified(cq);

ok("related skills expanded", (cq.relatedSkills?.length ?? 0) >= 4);

const samples: Lead[] = [
  {
    source: "serpapi",
    platform: "G",
    title: "Looking for a graphic designer for SaaS",
    snippet: "Need a designer. Budget ready.",
    full_post_url: "https://reddit.com/r/forhire/x",
    posted_at: new Date().toISOString(),
    score: 60,
    ai_intent: "hiring",
    ai_role_in_post: "buyer",
  },
  {
    source: "upwork",
    platform: "U",
    title: "Website design needed",
    snippet: "Looking for freelancer to redesign site",
    full_post_url: "https://upwork.com/jobs/~1",
    posted_at: new Date().toISOString(),
    score: 55,
  },
  {
    source: "tavily",
    platform: "W",
    title: "Hiring UI/UX designer remote",
    snippet: "We need a Figma designer for our product",
    full_post_url: "https://ex.com/a",
    posted_at: new Date().toISOString(),
    score: 55,
    ai_intent: "hiring",
    ai_role_in_post: "buyer",
  },
  {
    source: "twitter",
    platform: "X",
    title: "need a logo design this week",
    snippet: "paid gig anyone?",
    full_post_url: "https://x.com/a/1",
    posted_at: new Date().toISOString(),
    score: 50,
  },
];

for (const l of samples) {
  ok(`${l.source} not off-skill`, !isOffSkillRole(l, cq.coreSkill, cq.relatedSkills));
}

const kept = validateLeads(samples, cq, ex, {
  preferJunior: true,
  preferRemote: true,
});
ok("validate keeps >= 3 design leads", kept.length >= 3);
ok(
  "validate keeps graphic designer serp",
  kept.some((l) => l.source === "serpapi"),
);
ok(
  "validate keeps upwork",
  kept.some((l) => l.source === "upwork"),
);

if (fail.length) {
  console.error("FAIL:", fail.join("; "));
  process.exit(1);
}
console.log("PASS verify-validate-design", { kept: kept.map((l) => l.source) });
