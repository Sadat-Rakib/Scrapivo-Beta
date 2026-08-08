/**
 * Probe scripts + clarifier/geo smoke for Quality+Quantity ship bar.
 * Run: npx tsx scripts/verify-quality-quantity.mts
 */
import { injectLocationBias, expandFromClassified } from "../src/lib/search/query-expander";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { applyClarifyAnswers } from "../src/lib/search/clarifier";
import { passesLocationFilter } from "../src/lib/validation";
import { searxngUnavailable } from "../src/lib/search/serp-providers.server";
import { searchInvestors, getAllInvestors } from "../src/lib/investors/search";
import { deriveOpportunityTags } from "../src/lib/search/lead-segments";
import type { Lead } from "../src/lib/scoring";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
}

async function main() {
  // Clarifier → geo injection
  const classified = classifyQuery("need a designer");
  const refinement = applyClarifyAnswers(classified, { geography: "us", craft: "UI designer" });
  assert(refinement.location === "United States", "clarify geography=us → United States");
  if (refinement.craft) classified.coreSkill = refinement.craft;
  classified.location = refinement.location;
  let expanded = expandFromClassified(classified);
  expanded = injectLocationBias(expanded, classified.location);
  const blob = [...expanded.booleanWebQueries, ...expanded.socialQueries].join(" ");
  assert(/United States/i.test(blob), "expanded queries contain United States");

  // Europe location filter allow-list
  const euLead = {
    source: "reddit",
    platform: "Reddit",
    title: "Need a designer in Berlin",
    snippet: "Based in Germany",
    full_post_url: "https://reddit.com/r/forhire/1",
  } as Lead;
  assert(passesLocationFilter(euLead, "Europe"), "Europe allow-list keeps Berlin");

  const indiaLead = {
    ...euLead,
    title: "Need designer in Mumbai",
    snippet: "Bangalore based",
  } as Lead;
  assert(!passesLocationFilter(indiaLead, "United States"), "US filter drops India geo");

  // Opportunity tags
  const tags = deriveOpportunityTags({ website: undefined, email: "a@b.com", phone: "1" });
  assert(tags.includes("no_website") && tags.includes("has_email"), "opportunity tags");

  // Investors seed
  const all = getAllInvestors();
  assert(all.length >= 100, `investors seed loaded (${all.length})`);
  const fintech = searchInvestors({ query: "FinTech", stage: "Seed", limit: 20 });
  assert(fintech.length > 0, `FinTech Seed investors (${fintech.length})`);

  console.log("\nsearxngUnavailable=", searxngUnavailable());
  console.log(
    "SERPAPI_MAX_CALLS_PER_RUN=",
    process.env.SERPAPI_MAX_CALLS_PER_RUN ?? "(auto 4 local / 10 when SearXNG dead)",
  );
  console.log("\nAll quality+quantity probes passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
