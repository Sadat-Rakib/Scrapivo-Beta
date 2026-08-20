/**
 * Unit checks: designer search must drop POV/notes/surveys and keep hire + ATS.
 *   npx tsx scripts/verify-designer-relevance.ts
 */
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { isPersonalStoryNoise, isEducationalNoise, shouldIncludeLead } from "../src/lib/validation";
import type { Lead } from "../src/lib/scoring";

const classified = classifyQuery("designer");
const expanded = expandFromClassified(classified);

function lead(partial: Partial<Lead> & { title: string }): Lead {
  return {
    source: partial.source ?? "reddit",
    platform: partial.platform ?? "Reddit",
    title: partial.title,
    snippet: partial.snippet ?? "",
    full_post_url: partial.full_post_url ?? "https://reddit.com/r/x/1",
    score: 50,
    ...partial,
  } as Lead;
}

const junk = [
  lead({ title: "Designer notes from my first year", snippet: "my thoughts on design" }),
  lead({ title: "My POV on being a designer", snippet: "unpopular opinion about Figma" }),
  lead({ title: "Fill out this survey for designers", snippet: "share your experience" }),
  lead({ title: "A day in the life of a designer", snippet: "just sharing my journey" }),
  lead({ title: "How to become a freelance designer", snippet: "steps to career path" }),
];

const keep = [
  lead({
    title: "Looking for a designer for our landing page",
    snippet: "budget $2k, need someone this week",
  }),
  lead({
    source: "greenhouse",
    platform: "Greenhouse",
    title: "Product Designer @ Acme",
    snippet: "Join our product team",
    full_post_url: "https://boards.greenhouse.io/acme/jobs/1",
  }),
  lead({
    source: "linkedin",
    platform: "LinkedIn",
    title: "Need a designer who can ship UI fast",
    snippet: "willing to pay, DM me",
    demand_verified: true,
    freshness_window: "day",
  }),
];

let failed = 0;
for (const j of junk) {
  const story = isPersonalStoryNoise(j) || isEducationalNoise(j);
  const include = shouldIncludeLead(j, classified, expanded);
  if (!story || include) {
    console.error("FAIL junk kept:", j.title, { story, include });
    failed++;
  } else {
    console.log("ok drop:", j.title);
  }
}
for (const k of keep) {
  const include = shouldIncludeLead(k, classified, expanded);
  if (!include) {
    console.error("FAIL good dropped:", k.title);
    failed++;
  } else {
    console.log("ok keep:", k.title);
  }
}

console.log(failed === 0 ? "PASS" : `FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
