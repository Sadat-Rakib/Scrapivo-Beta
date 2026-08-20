/**
 * Live check: for the user's failing query, do company-identity leads now
 * clear the clients-path gate?
 *
 * The gate used to require hire-grammar in the TITLE. An ATS role title
 * ("Senior Product Designer") has none, so every company lead was dropped and
 * Companies rendered 0. The fix treats those sources as demand-by-posting,
 * still requiring a title-scoped skill match.
 */
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import { expandQuery, isStronglyRelevantToSkill } from "../src/lib/search/query-expander.ts";
import { searchAllSources } from "../src/lib/search/sources.server.ts";

const QUERY = process.argv.slice(2).join(" ") || "need a design";

const DEMAND_BY_SOURCE = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "freelancer",
  "tenders",
]);

const classified = classifyQuery(QUERY);
const expanded = expandQuery(QUERY);
console.log(
  `query="${QUERY}" skill="${classified.coreSkill}" goal="${classified.goal ?? "clients"}"`,
);

const t0 = Date.now();
const { leads: raw, sources } = await searchAllSources({ classified, expanded } as never);
console.log(
  `fetched ${raw.length} raw leads from ${sources.length} sources in ${Date.now() - t0}ms\n`,
);

const skillOk = (text: string) =>
  isStronglyRelevantToSkill(text, classified.coreSkill) ||
  classified.relatedSkills.slice(0, 8).some((s) => isStronglyRelevantToSkill(text, s));

const bySource = new Map<string, { total: number; passes: number; sample: string[] }>();
for (const l of raw as Array<{ source?: string; title?: string }>) {
  const src = l.source ?? "?";
  if (!DEMAND_BY_SOURCE.has(src)) continue;
  const e = bySource.get(src) ?? { total: 0, passes: 0, sample: [] };
  e.total++;
  if (skillOk(l.title || "")) {
    e.passes++;
    if (e.sample.length < 3) e.sample.push(String(l.title));
  }
  bySource.set(src, e);
}

let totalPass = 0;
console.log("Demand-by-source leads clearing the title skill gate:");
for (const [src, e] of [...bySource].sort((a, b) => b[1].passes - a[1].passes)) {
  totalPass += e.passes;
  console.log(
    `  ${src.padEnd(16)} ${String(e.passes).padStart(3)}/${String(e.total).padEnd(3)} pass`,
  );
  for (const s of e.sample) console.log(`      · ${s.slice(0, 78)}`);
}

console.log(
  `\n${totalPass} company/marketplace leads now survive the gate that previously dropped ALL of them.`,
);
process.exit(totalPass > 0 ? 0 : 1);
