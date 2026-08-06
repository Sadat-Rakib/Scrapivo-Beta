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
}

console.log("\n── Skill question construction ──────────────────────────");
{
  const messy = classifyQuery("I am a writer I am acitvely looking for people, companies, posts etc");
  const qs = buildClarifyingQuestions(messy);
  check("asks at most 4", qs.length > 0 && qs.length <= 4, qs.length);
  check("every question has a recommended default", qs.every((q) => q.options.some((o) => o.recommended)));
  check("asks what to bring back", qs.some((q) => q.id === "audience"));
  check("skill path asks experience", qs.some((q) => q.id === "experience"));
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

  const qs = buildClarifyingQuestions(pitch, { hasLocation: false });
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
  );

  const svc = classifyQuery("lead generation services");
  check("service noun uses product path", isProductClarifyPath(svc), svc.type);
  const svcQs = buildClarifyingQuestions(svc);
  check("lead-gen services asks signal focus", svcQs.some((q) => q.id === "signal_focus"));
  check("lead-gen services skips YoE", !svcQs.some((q) => q.id === "experience"));

  const skill = classifyQuery("sales");
  check("bare skill is NOT product path", !isProductClarifyPath(skill), skill.type);
  const skillQs = buildClarifyingQuestions(skill);
  check("bare skill asks experience", skillQs.some((q) => q.id === "experience"));
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

  const product = classifyQuery("lead generation services");
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
