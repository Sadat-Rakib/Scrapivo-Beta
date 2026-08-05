/**
 * Clarifying-question flow.
 *   npx tsx scripts/verify-clarifier.mts
 *
 * The cases below are the real query shapes that produced empty result pages
 * during testing. The flow's job is to turn each into a targeted search — and,
 * just as importantly, to NOT interrupt queries that are already precise.
 */
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import {
  buildClarifyingQuestions,
  applyClarifyAnswers,
  shouldClarify,
} from "../src/lib/search/clarifier.ts";

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

console.log("\n── When to ask ──────────────────────────────────────────");
{
  const vague = await classifyQuery("designer");
  check("bare craft is worth clarifying", shouldClarify(vague));

  const messy = await classifyQuery("I am a writer I am acitvely looking for people, companies, posts etc");
  check("messy sentence is worth clarifying", shouldClarify(messy));

  const precise = await classifyQuery("Shopify stores hiring copywriters in Toronto");
  check("precise query is NOT interrupted", !shouldClarify(precise), precise.coreSkill);
}

console.log("\n── Question construction ────────────────────────────────");
{
  const messy = await classifyQuery("I am a writer I am acitvely looking for people, companies, posts etc");
  const qs = buildClarifyingQuestions(messy);
  check("asks at most 4", qs.length > 0 && qs.length <= 4, qs.length);
  check("every question has a recommended default", qs.every((q) => q.options.some((o) => o.recommended)));
  check("asks what to bring back", qs.some((q) => q.id === "audience"));

  const clean = await classifyQuery("logo design");
  const cleanQs = buildClarifyingQuestions(clean);
  check(
    "does NOT re-ask the craft when extraction was clean",
    !cleanQs.some((q) => q.id === "craft"),
    clean.coreSkill,
  );

  const located = await classifyQuery("marketing agencies in London");
  const locQs = buildClarifyingQuestions(located, { hasLocation: true });
  check("does NOT ask location when one was given", !locQs.some((q) => q.id === "geography"));
}

console.log("\n── Applying answers ─────────────────────────────────────");
{
  const c = await classifyQuery("designer");

  const skipped = applyClarifyAnswers(c);
  check("zero answers still yields a complete refinement", skipped.audience === "all" && skipped.maxAgeHours === 24, skipped);
  check("skipped search defaults to worldwide", skipped.location === null);

  const answered = applyClarifyAnswers(c, {
    audience: "companies",
    buyer_type: "startups",
    geography: "us",
    freshness: "hour",
  });
  check("audience carried through", answered.audience === "companies");
  check("buyer type adds targeting terms", answered.buyerTerms.includes("startup"), answered.buyerTerms);
  check("buyer type adds subreddits", answered.extraSubreddits.includes("startups"));
  check("geography maps to a location", answered.location === "United States");
  check("freshness maps to hours", answered.maxAgeHours === 1);
  check("summary is human-readable", /startups/.test(answered.summary), answered.summary);

  const typed = applyClarifyAnswers(c, { other: { geography: "Calgary" } });
  check("typed location beats a picked region", typed.location === "Calgary");

  const corrected = applyClarifyAnswers(c, { other: { craft: "brand identity design" } });
  check("user correction overrides detected craft", corrected.craft === "brand identity design");
}

console.log(`\n${pass}/${pass + fails.length} correct`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  " + f);
}
process.exit(fails.length ? 1 : 0);
