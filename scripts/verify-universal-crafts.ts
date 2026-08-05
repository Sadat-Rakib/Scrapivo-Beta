/**
 * Quick classifier/expander checks for universal crafts + product pitches.
 *   npx tsx scripts/verify-universal-crafts.ts
 */
import { classifyQuery, extractProductPitchKeywords } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";

let fails = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(ok ? "ok" : "FAIL", name, detail || "");
  if (!ok) fails++;
}

{
  const c = classifyQuery("need a writer");
  check("writer core", c.coreSkill === "writer" || c.relatedSkills.some((s) => /writ/i.test(s)), c.coreSkill);
  const x = expandFromClassified(c);
  check("writer synonyms", x.relatedSkills.some((s) => /copy|content|ghost/i.test(s)), x.relatedSkills.join(","));
  check("no writer developer", !x.jobBoardTerms.some((t) => /writer developer/i.test(t)), x.jobBoardTerms.join(","));
}

{
  const c = classifyQuery("I'm an investor looking for startups who are raising");
  const x = expandFromClassified(c);
  check(
    "investor raise phrases",
    x.buyerPhrases.some((p) => /raising|investors|fundraising/i.test(p)),
    x.buyerPhrases.slice(0, 4).join(" | "),
  );
  check("not hiring investor", !x.buyerPhrases.some((p) => /"hiring" "investor"/i.test(p)));
}

{
  const c = classifyQuery("I'm a teacher looking for students who need tutoring");
  const x = expandFromClassified(c);
  check(
    "tutor phrases",
    x.buyerPhrases.some((p) => /tutor|homework|lessons/i.test(p)),
    x.buyerPhrases.slice(0, 4).join(" | "),
  );
}

{
  const pitch =
    "I'm selling a product that helps freelancers find clients and manage invoices";
  const kws = extractProductPitchKeywords(pitch);
  check(
    "product kw phrases",
    kws.some((k) => /find clients/i.test(k)) && kws.some((k) => /manage invoices|invoices/i.test(k)),
    kws.join(", "),
  );
  const c = classifyQuery(pitch);
  check("product type", c.type === "product", c.type);
  check("not selling product skill", !/selling product/i.test(c.coreSkill), c.coreSkill);
  check(
    "core is capability",
    /client|invoice/i.test(c.coreSkill),
    c.coreSkill,
  );
  const x = expandFromClassified(c);
  check(
    "product fan-out",
    x.buyerPhrases.some((p) => /invoice|client/i.test(p)),
    x.buyerPhrases.slice(0, 4).join(" | "),
  );
}

{
  const c = classifyQuery("need a growth marketer");
  check("growth", /growth/i.test(c.coreSkill) || c.relatedSkills.some((s) => /growth/i.test(s)));
}

{
  const c = classifyQuery("need a data analyst");
  check("data", /data/i.test(c.coreSkill));
}

{
  const c = classifyQuery("need a sales rep in India");
  check("sales", /sales/i.test(c.coreSkill));
  check("location India", (c.location || "").toLowerCase().includes("india"), String(c.location));
}

console.log(fails === 0 ? "PASS" : `FAIL ${fails}`);
process.exit(fails === 0 ? 0 : 1);
