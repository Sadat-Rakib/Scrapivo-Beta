import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.SEARXNG_URL = "http://127.0.0.1:8888";
process.env.SCRAPIVO_DEBUG_STAGES = "1";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { personNoun, craftVariants, matchesCraft, classifyDemand } from "../src/lib/search/demand-classifier";
import { searchSearxng, searxngResultsToLeads, withSearxngBudget } from "../src/lib/search/searxng.server";

const x = expandFromClassified(classifyQuery("sales teams"));
const craft = personNoun(x.skill, x.role);
const terms = craftVariants(x.skill);
console.log({ skill: x.skill, craft, terms: terms.slice(0, 10) });

const dork = `site:linkedin.com/posts ("looking for a ${craft}" OR "need a ${craft}" OR "hiring a ${craft}")`;
console.log("dork", dork);

await withSearxngBudget(async () => {
  const raw = await searchSearxng([dork], 1, "", "linkedin");
  console.log("searxng rows", raw.length);
  const leads = searxngResultsToLeads(raw, 18);
  console.log("as leads", leads.length);
  let urlFail = 0,
    craftFail = 0,
    demandFail = 0,
    ok = 0;
  const urlTest = /linkedin\.com\/(posts|feed\/update)/i;
  for (const l of leads) {
    const url = l.full_post_url || "";
    if (!url || !urlTest.test(url)) {
      urlFail++;
      continue;
    }
    if (!matchesCraft(l.title || "", terms) && !matchesCraft(l.snippet || "", terms)) {
      craftFail++;
      console.log("  craft fail:", (l.title || "").slice(0, 80));
      continue;
    }
    const verdict = classifyDemand({ title: l.title, body: l.snippet });
    if (verdict.rejectedAs || !verdict.isDemand) {
      demandFail++;
      console.log("  demand fail:", verdict.rejectedAs || "no demand", (l.title || "").slice(0, 60));
      continue;
    }
    ok++;
    console.log("  KEEP", (l.title || "").slice(0, 70));
  }
  console.log({ urlFail, craftFail, demandFail, ok });
});
