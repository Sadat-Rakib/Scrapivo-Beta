/**
 * Live "sales" social survival through validate + quality heuristics.
 *
 *   npx tsx scripts/verify-sales-funnel.ts
 */
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv();
process.env.SCRAPIVO_DEBUG_STAGES = "1";

import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchSocialDorks } from "../src/lib/search/social-dorks.server";
import { validateLeads, isSalesTalentHireAsk, detectBuyerIntent } from "../src/lib/validation";
import type { Lead } from "../src/lib/scoring";

const classified = classifyQuery("sales");
const expanded = expandFromClassified(classified);
console.log("classified", {
  core: classified.coreSkill,
  goal: classified.goal,
  signalMode: classified.signalMode,
});

const raw = await searchSocialDorks(expanded);
console.log(`\nsocialdorks raw: ${raw.length}`);
const bySrc: Record<string, number> = {};
for (const l of raw) bySrc[l.source] = (bySrc[l.source] ?? 0) + 1;
console.log("  by source", bySrc);
for (const l of raw.slice(0, 8)) {
  console.log(
    `  - [${l.source}] ${l.title.slice(0, 70)} | demand=${l.demand_verified} buyer=${detectBuyerIntent(`${l.title} ${l.snippet}`).isBuyer} salesHire=${isSalesTalentHireAsk(`${l.title} ${l.snippet}`)}`,
  );
}

const validated = validateLeads(raw as Lead[], classified, expanded, { preferJunior: false });
console.log(`\nvalidate: ${raw.length} → ${validated.length}`);
const vSrc: Record<string, number> = {};
for (const l of validated) vSrc[l.source] = (vSrc[l.source] ?? 0) + 1;
console.log("  kept sources", vSrc);

// Mirror the clients quality keep rules that used to wipe LinkedIn/IG/FB.
const socialKept = validated.filter((l) => {
  if (!["linkedin", "instagram", "facebook", "twitter", "threads"].includes(l.source)) return false;
  const text = `${l.title} ${l.snippet}`;
  const buyer =
    detectBuyerIntent(text).isBuyer ||
    isSalesTalentHireAsk(text) ||
    l.demand_verified === true;
  return buyer;
});
const platforms = [...new Set(socialKept.map((l) => l.source))];
const ok = socialKept.length >= 2 && platforms.length >= 2;
console.log(
  `\n${ok ? "PASS" : "FAIL"} — social surviving: ${socialKept.length} across ${platforms.join(",") || "none"}`,
);
process.exit(ok ? 0 : 1);
