import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { personNoun, craftVariants, matchesCraft } from "../src/lib/search/demand-classifier";
import { resilientFetch } from "../src/lib/search/http-fetch.server";

const c = classifyQuery("sales teams");
const x = expandFromClassified(c);
console.log({
  core: c.coreSkill,
  role: c.roleTitle,
  related: c.relatedSkills,
  goal: c.goal,
  signal: c.signalMode,
  skill: x.skill,
});
console.log("personNoun", personNoun(x.skill, x.role));
console.log("variants", craftVariants(x.skill || "").slice(0, 15));
console.log(
  "match sales rep",
  matchesCraft("Hiring a sales rep for our startup", craftVariants(x.skill || "")),
);
console.log(
  "match sales teams",
  matchesCraft("building sales teams remotely", craftVariants(x.skill || "")),
);

const base = (process.env.SEARXNG_URL || "").replace(/:\/\/localhost(?=[:/]|$)/i, "://127.0.0.1");
console.log("SEARXNG_URL", base);
try {
  const res = await resilientFetch(`${base}/search?q=looking+for+a+sales+rep&format=json`, {
    headers: { Accept: "application/json" },
    retries: 1,
  });
  console.log("resilientFetch status", res.status);
  const j = (await res.json()) as { results?: unknown[] };
  console.log("resilientFetch results", j.results?.length ?? 0);
} catch (e) {
  console.log(
    "resilientFetch FAIL",
    (e as Error).message,
    (e as Error & { cause?: unknown }).cause,
  );
}
