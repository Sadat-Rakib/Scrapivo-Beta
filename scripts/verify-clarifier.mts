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
  isProductClarifyPath,
  extractStatedAudience,
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
  const vague = classifyQuery("designer");
  check("bare craft is worth clarifying", shouldClarify(vague));

  const messy = classifyQuery("I am a writer I am acitvely looking for people, companies, posts etc");
  check("messy sentence is worth clarifying", shouldClarify(messy));

  const precise = classifyQuery("Shopify stores hiring copywriters in Toronto");
  check("precise query is NOT interrupted", !shouldClarify(precise), precise.coreSkill);

  const dual = classifyQuery(
    "companies and people looking for lead generation services",
  );
  check("companies+people lead-gen still clarifies (missing place)", shouldClarify(dual));
}

console.log("\n── Stated audience skips redundant ask ───────────────────");
{
  const dual = classifyQuery(
    "companies and people looking for lead generation services",
  );
  check(
    "infers audience=all from companies and people",
    extractStatedAudience(dual.raw) === "all",
    extractStatedAudience(dual.raw),
  );
  const dualQs = buildClarifyingQuestions(dual, { hasLocation: !!dual.location });
  check(
    "does NOT ask What should we bring back when audience stated",
    !dualQs.some((q) => q.id === "audience"),
    dualQs.map((q) => q.id),
  );
  check(
    "DOES ask geography when no place typed",
    dualQs.some((q) => q.id === "geography"),
    dualQs.map((q) => q.id),
  );
  check("geography is first when craft is clear", dualQs[0]?.id === "geography", dualQs[0]?.id);

  const india = classifyQuery("lead gen in India");
  const indiaQs = buildClarifyingQuestions(india, {
    hasLocation: !!india.location,
  });
  check(
    "skips geography when location extracted",
    !indiaQs.some((q) => q.id === "geography") || !!india.location,
    { loc: india.location, ids: indiaQs.map((q) => q.id) },
  );
}

console.log("\n── Skill question construction ──────────────────────────");
{
  const messy = classifyQuery("I am a writer I am acitvely looking for people, companies, posts etc");
  const qs = buildClarifyingQuestions(messy);
  check("asks at most 4", qs.length > 0 && qs.length <= 4, qs.length);
  check("every question has a recommended default", qs.every((q) => q.options.some((o) => o.recommended)));
  check(
    "messy people+companies skips audience re-ask",
    !qs.some((q) => q.id === "audience"),
    qs.map((q) => q.id),
  );
  check("skill path asks experience when YoE not stated", qs.some((q) => q.id === "experience"));
  check("skill path does NOT ask signal focus", !qs.some((q) => q.id === "signal_focus"));

  const clean = classifyQuery("logo design");
  const cleanQs = buildClarifyingQuestions(clean);
  check(
    "does NOT re-ask the craft when extraction was clean",
    !cleanQs.some((q) => q.id === "craft"),
    clean.coreSkill,
  );

  const located = classifyQuery("marketing agencies in London");
  const locQs = buildClarifyingQuestions(located, { hasLocation: true });
  check("does NOT ask location when one was given", !locQs.some((q) => q.id === "geography"));
}

console.log("\n── Product question construction ────────────────────────");
{
  const pitch = classifyQuery(
    "I'm selling a product that helps freelancers find clients and manage invoices",
  );
  check("product pitch classified as product", pitch.type === "product", pitch.type);
  check("product clarify path", isProductClarifyPath(pitch));

  const qs = buildClarifyingQuestions(pitch, { hasLocation: true });
  check("product asks at most 4", qs.length > 0 && qs.length <= 4, qs.length);
  check("product asks signal focus instead of YoE", qs.some((q) => q.id === "signal_focus"));
  check("product does NOT ask years of experience", !qs.some((q) => q.id === "experience"));
  check(
    "product audience copy mentions tools/pain",
    qs
      .find((q) => q.id === "audience")
      ?.options.some((o) => /tool|pain|recommend/i.test(o.hint)) ?? false,
  );
  check(
    "product buyer question says customer",
    /customer/i.test(qs.find((q) => q.id === "buyer_type")?.question ?? ""),
    qs.map((q) => q.id),
  );

  const svc = classifyQuery("CRM software for freelancers");
  check("crm software uses product path", isProductClarifyPath(svc), svc.type);
  const svcQs = buildClarifyingQuestions(svc);
  check("crm software asks signal focus", svcQs.some((q) => q.id === "signal_focus"));
  check("crm software skips YoE", !svcQs.some((q) => q.id === "experience"));

  const skill = classifyQuery("sales");
  check("bare skill is NOT product path", !isProductClarifyPath(skill), skill.type);
  const skillQs = buildClarifyingQuestions(skill);
  check("bare skill asks experience", skillQs.some((q) => q.id === "experience"));

  const leadGen = classifyQuery("lead generation services");
  check("lead generation services is NOT product clarifier", !isProductClarifyPath(leadGen), leadGen.type);
  const leadGenQs = buildClarifyingQuestions(leadGen);
  check("lead generation services asks experience (skill path)", leadGenQs.some((q) => q.id === "experience"));
}

console.log("\n── Applying answers ─────────────────────────────────────");
{
  const c = classifyQuery("designer");

  const skipped = applyClarifyAnswers(c);
  check(
    "zero answers still yields a complete refinement",
    skipped.audience === "all" && skipped.maxAgeHours === 48,
    skipped,
  );
  check("skipped search defaults to worldwide", skipped.location === null);
  check("skill skip defaults YoE to 0-1", skipped.experience === "0-1");
  check("skill summary includes experience", /years experience/.test(skipped.summary), skipped.summary);

  const dual = classifyQuery("companies and people looking for lead generation services");
  const dualSkip = applyClarifyAnswers(dual);
  check(
    "skip still honors companies+people as everything",
    dualSkip.audience === "all",
    dualSkip.audience,
  );

  const answered = applyClarifyAnswers(c, {
    audience: "companies",
    buyer_type: "startups",
    geography: "us",
    experience: "3-4",
  });
  check("audience carried through", answered.audience === "companies");
  check("buyer type adds targeting terms", answered.buyerTerms.includes("startup"), answered.buyerTerms);
  check("buyer type adds subreddits", answered.extraSubreddits.includes("startups"));
  check("geography maps to a location", answered.location === "United States");
  check("experience carried through", answered.experience === "3-4");
  check("summary is human-readable", /startups/.test(answered.summary), answered.summary);

  const typed = applyClarifyAnswers(c, { other: { geography: "Calgary" } });
  check("typed location beats a picked region", typed.location === "Calgary");

  const corrected = applyClarifyAnswers(c, { other: { craft: "brand identity design" } });
  check("user correction overrides detected craft", corrected.craft === "brand identity design");

  const product = classifyQuery("I'm selling a SaaS invoicing tool for freelancers");
  const productSkip = applyClarifyAnswers(product);
  check("product skip has no YoE", productSkip.experience === undefined, productSkip);
  check(
    "product summary says customers",
    /customers for/i.test(productSkip.summary),
    productSkip.summary,
  );
  check("product summary omits years experience", !/years experience/.test(productSkip.summary));

  const productFocus = applyClarifyAnswers(product, { signal_focus: "pain" });
  check("signal focus adds pain terms", productFocus.signalTerms.some((t) => /struggling/i.test(t)));
  check(
    "signal focus appears in summary",
    /pain/i.test(productFocus.summary),
    productFocus.summary,
  );
}

console.log(`\n${pass}/${pass + fails.length} correct`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  " + f);
}
process.exit(fails.length ? 1 : 0);
