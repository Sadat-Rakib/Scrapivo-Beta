/**
 * Playbook planner fixtures — 5 NL scenarios.
 * Run: npx tsx scripts/verify-playbook-planner.mts
 */
import { classifyQuery } from "../src/lib/search/query-classifier";
import { applyClarifyAnswers } from "../src/lib/search/clarifier";
import { buildSearchPlan, planUsesInvestorSeed } from "../src/lib/search/playbook-planner";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const fixtures: Array<{
  q: string;
  expect: string;
  ctx?: { service?: string; goal?: string };
}> = [
  {
    q: "I sell lead generation services and want businesses that could become clients",
    expect: "CUSTOMER_DISCOVERY",
    ctx: { service: "lead generation", goal: "clients" },
  },
  {
    q: "Find investors interested in AI startups in Canada",
    expect: "INVESTOR_DISCOVERY",
  },
  {
    q: "Find remote AI/ML engineering jobs",
    expect: "JOB_DISCOVERY",
    ctx: { goal: "jobs" },
  },
  {
    q: "Find dentists in Calgary with poor websites that need a redesign",
    expect: "LOCAL_BUSINESS",
  },
  {
    q: "Find people publicly asking for a website or lead generation service",
    expect: "CUSTOMER_DISCOVERY",
    ctx: { goal: "clients" },
  },
];

for (const f of fixtures) {
  const classified = classifyQuery(f.q);
  if (f.ctx?.goal) classified.goal = f.ctx.goal as "jobs" | "clients" | "both";
  const refinement = applyClarifyAnswers(classified, {});
  const plan = buildSearchPlan(classified, refinement, {
    service: f.ctx?.service,
    goal: f.ctx?.goal,
  });
  check(
    `playbook for: ${f.q.slice(0, 48)}…`,
    plan.playbook === f.expect,
    `got=${plan.playbook} want=${f.expect} sources=${plan.sources.slice(0, 3).join(",")}`,
  );
}

const inv = classifyQuery("looking for a VC to raise seed");
const invPlan = buildSearchPlan(inv, applyClarifyAnswers(inv, {}));
check("investor seed short-circuit", planUsesInvestorSeed(invPlan));
check("investor personalization on", invPlan.personalization === true);

const job = classifyQuery("senior ML engineer roles remote");
job.goal = "jobs";
const jobPlan = buildSearchPlan(job, applyClarifyAnswers(job, {}));
check("jobs personalization off by default", jobPlan.personalization === false);

console.log(failed ? `\n${failed} failed` : "\nAll playbook planner tests passed.");
process.exit(failed ? 1 : 0);
