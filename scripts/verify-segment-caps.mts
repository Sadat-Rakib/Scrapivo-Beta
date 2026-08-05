/**
 * Regression guard for the diversification caps.
 *
 * History: company-identity ATS boards (Greenhouse/Ashby/Lever/...) were
 * lumped into JOB_BOARD_SOURCES and the clients path passed maxJobBoard: 0.
 * Result: the pipeline fetched 70+ ATS leads and then hard-dropped every one
 * of them, leaving a Reddit-only feed with zero Companies. This asserts that
 * never happens again.
 */
import { diversifiedTop12 } from "../src/lib/scoring.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type L = Record<string, unknown>;
const mk = (source: string, i: number, extra: L = {}): L => ({
  source,
  platform: `${source}:co${i}`,
  full_post_url: `https://example.com/${source}/${i}`,
  title: `Need a designer ${i}`,
  score: 70 - i,
  posted_at: new Date(Date.now() - i * 3600_000).toISOString(),
  ...extra,
});

const many = (source: string, n: number, extra: L = {}) =>
  Array.from({ length: n }, (_, i) => mk(source, i, extra));

// Mirrors runSearch's clients-path call.
const clientsOpts = {
  directoryMode: false,
  maxJobBoard: 0,
  maxCompanyAts: 12,
  minSocial: 5,
  maxTotal: 80,
  minScore: 28,
  maxPerPlatform: 14,
};

const ATS = ["greenhouse", "ashby", "lever", "smartrecruiters", "workable", "recruitee"];

console.log("\nCompany-identity ATS on the clients path");
for (const src of ATS) {
  const out = diversifiedTop12(many(src, 8) as never, clientsOpts);
  check(`${src} survives (maxJobBoard=0)`, out.length > 0, `got ${out.length}`);
}

console.log("\nBuyer-posted marketplaces are demand, not job boards");
{
  const out = diversifiedTop12(many("freelancer", 8) as never, clientsOpts);
  check("freelancer survives", out.length > 0, `got ${out.length}`);
}

// The front page is the first MAX_RESULTS(24) slots — the only region the caps
// govern. The tail is a deliberate overflow append for volume, so assert cap
// behaviour where it actually applies.
const FRONT = 24;

console.log("\nAggregators stay off the front page when better leads exist");
for (const src of ["indeed", "jobicy", "remoteok", "workingnomads", "glassdoor"]) {
  const pool = [...many("reddit", 40), ...many(src, 40)];
  const out = diversifiedTop12(pool as never, clientsOpts) as unknown as L[];
  const onFront = out.slice(0, FRONT).filter((l) => l.source === src).length;
  check(`${src} off front page`, onFront === 0, `got ${onFront}`);
}

console.log("\nCompany ATS respects its own front-page ceiling");
{
  const pool = [...many("reddit", 40), ...many("greenhouse", 40)];
  const out = diversifiedTop12(pool as never, clientsOpts) as unknown as L[];
  const onFront = out.slice(0, FRONT).filter((l) => l.source === "greenhouse").length;
  check("<= maxCompanyAts on front page", onFront <= 12, `got ${onFront}`);
  check("but genuinely present", onFront >= 1, `got ${onFront}`);
}

console.log("\nMixed feed yields all three segments");
{
  const mixed = [
    ...many("reddit", 6),
    ...many("greenhouse", 10),
    ...many("ashby", 10),
    ...many("freelancer", 5),
    ...many("indeed", 10),
  ];
  const out = diversifiedTop12(mixed as never, clientsOpts) as unknown as L[];
  const bySource = new Map<string, number>();
  for (const l of out) {
    const s = String(l.source);
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
  }
  console.log(`       ${JSON.stringify(Object.fromEntries(bySource))}`);
  check("reddit present", (bySource.get("reddit") ?? 0) > 0);
  check("company ATS present", ATS.some((s) => (bySource.get(s) ?? 0) > 0));
  check("freelancer present", (bySource.get("freelancer") ?? 0) > 0);
  // On the cap-governed front page, aggregators may only take slots the good
  // sources could not fill: reddit(6) + companyAts(12) + freelancer(5) = 23,
  // leaving exactly 1 of 24. Beyond the front page the tail is score-ordered
  // overflow, where interleaving is intended.
  const indeedFront = out.slice(0, FRONT).filter((l) => l.source === "indeed").length;
  check("aggregator only fills leftovers", indeedFront <= 1, `got ${indeedFront}`);
  check("more than a Reddit-only feed", out.length >= 15, `got ${out.length}`);
}

console.log("\nFront page holds >= 2 opportunities per job");
{
  // Plenty of both — the ratio must bind.
  const pool = [...many("reddit", 40), ...many("greenhouse", 40), ...many("indeed", 40)];
  const out = diversifiedTop12(pool as never, clientsOpts) as unknown as L[];
  const front = out.slice(0, FRONT);
  const jobish = front.filter((l) =>
    ["greenhouse", "indeed", "ashby", "lever", "remoteok"].includes(String(l.source)),
  ).length;
  console.log(`       front=${front.length} jobShaped=${jobish}`);
  check("jobs <= 1/3 of front page", jobish * 3 <= front.length, `${jobish}/${front.length}`);
  check("opportunities dominate", front.length - jobish >= 2 * jobish, `${front.length - jobish} vs ${jobish}`);
}

console.log("\nRatio never starves a job-only feed");
{
  // No opportunity supply at all — jobs must still fill the page.
  const out = diversifiedTop12(many("greenhouse", 30) as never, clientsOpts);
  check("job-only feed still returns", out.length >= 10, `got ${out.length}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
