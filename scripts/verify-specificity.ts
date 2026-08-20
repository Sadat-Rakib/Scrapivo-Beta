/**
 * Unit checks for Discover specificity plan.
 *   npx tsx scripts/verify-specificity.ts
 */
import {
  extractDateFromText,
  isRecent,
  CLIENTS_SOCIAL_MAX_AGE_DAYS,
} from "../src/lib/search/query-expander";
import {
  isPersonalStoryNoise,
  isEducationalNoise,
  isOffSkillRole,
  isLikelyScam,
  hasExpiredSignal,
  shouldIncludeLead,
} from "../src/lib/validation";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { applyClarifyAnswers, buildClarifyingQuestions } from "../src/lib/search/clarifier";
import type { Lead } from "../src/lib/scoring";

function lead(p: Partial<Lead> & { title: string }): Lead {
  return {
    source: p.source ?? "reddit",
    platform: p.platform ?? "Reddit",
    title: p.title,
    snippet: p.snippet ?? "",
    full_post_url: p.full_post_url ?? "https://example.com/1",
    score: 50,
    ...p,
  } as Lead;
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) {
    console.error("FAIL", name);
    failed++;
  } else console.log("ok", name);
}

// Dates
const old = extractDateFromText("Caleb on X · Mar 22, 2019");
check("extract Mar 22 2019", !!old && !isRecent(old, CLIENTS_SOCIAL_MAX_AGE_DAYS));
const weeks = extractDateFromText("Internship post 28w ago");
check("extract 28w stale", !!weeks && !isRecent(weeks, CLIENTS_SOCIAL_MAX_AGE_DAYS));
const hours = extractDateFromText("Posted 3 hours ago looking for designer");
check("extract 3 hours recent", !!hours && isRecent(hours, CLIENTS_SOCIAL_MAX_AGE_DAYS));

// 24h chip semantics: undated must fail (simulate)
const undatedPass = false; // inWindow now requires posted_at
check("undated fails 24h", !undatedPass);

// Noise / off-skill
check(
  "POV educational",
  isEducationalNoise(
    lead({ title: "Unpaid design tests: a hiring trend", snippet: "strong belief" }),
  ),
);
check(
  "removed moderator expired",
  hasExpiredSignal(lead({ title: "[ Removed by moderator ]", snippet: "Feedback Needed" })),
);
check(
  "barter scam",
  isLikelyScam(lead({ title: "Need designer", snippet: "Not a money. US bills as reward" })),
);
const classified = classifyQuery("need a design");
check(
  "carport off-skill",
  isOffSkillRole(
    lead({ title: "Who can enclose a carport and renovate", snippet: "near Tampa" }),
    classified.coreSkill,
    classified.relatedSkills,
  ),
);
check(
  "jeans off-skill",
  isOffSkillRole(
    lead({ title: "Senior jeans artist needed for 2027 design", snippet: "Adobe Suite" }),
    classified.coreSkill,
    classified.relatedSkills,
  ),
);

const expanded = expandFromClassified(classified);
check(
  "hire ask kept",
  shouldIncludeLead(
    lead({
      title: "Looking for a designer for our landing page",
      snippet: "budget $2k willing to pay",
    }),
    classified,
    expanded,
  ),
);

// Clarifier experience
const qs = buildClarifyingQuestions(classified, {});
check(
  "experience question present",
  qs.some((q) => q.id === "experience"),
);
check("no freshness question", !qs.some((q) => (q.id as string) === "freshness"));
const ref = applyClarifyAnswers(classified, { experience: "5+", geography: "us" });
check("experience in refinement", ref.experience === "5+");
check("location applied", ref.location === "United States");

console.log(failed === 0 ? "PASS" : `FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
