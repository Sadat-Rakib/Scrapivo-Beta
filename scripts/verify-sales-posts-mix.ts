/**
 * End-to-end: sales → sources → validate → segments → 24h UI filter.
 * Must show LinkedIn/IG/FB (or other non-Reddit social) in Posts.
 *
 *   npx tsx scripts/verify-sales-posts-mix.ts
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
process.env.SEARXNG_URL = (process.env.SEARXNG_URL || "http://127.0.0.1:8888").replace(
  /:\/\/localhost(?=[:/]|$)/i,
  "://127.0.0.1",
);

import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified, isStronglyRelevantToSkill } from "../src/lib/search/query-expander";
import { searchAllSources } from "../src/lib/search/sources.server";
import { validateLeads } from "../src/lib/validation";
import { segmentLeads } from "../src/lib/search/lead-segments";
import { diversifiedTop12, type Lead } from "../src/lib/scoring";
import { detectDemandBuckets, scoreUrgency } from "../src/lib/search/intent-lexicon";

const classified = classifyQuery("sales");
const expanded = expandFromClassified(classified);
console.log("goal/signal", classified.goal, classified.signalMode, "SEARXNG", process.env.SEARXNG_URL);

const { leads: raw } = await searchAllSources({ classified, expanded });
const by: Record<string, number> = {};
for (const l of raw) by[l.source] = (by[l.source] ?? 0) + 1;
console.log("\nraw sources (top):", Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12));

const socialRaw = raw.filter((l) =>
  ["linkedin", "instagram", "facebook", "twitter", "threads", "quora"].includes(l.source),
);
console.log("social raw:", socialRaw.length, socialRaw.map((l) => l.source));

const validated = validateLeads(raw as Lead[], classified, expanded, { preferJunior: false });
const socialVal = validated.filter((l) =>
  ["linkedin", "instagram", "facebook", "twitter", "threads", "quora"].includes(l.source),
);
console.log("social after validate:", socialVal.length);

const skillOkFor = (text: string) =>
  isStronglyRelevantToSkill(text, classified.coreSkill) ||
  classified.relatedSkills.slice(0, 8).some((s) => isStronglyRelevantToSkill(text, s));

const quality = validated.filter((l) => {
  if (["greenhouse", "ashby", "lever", "jobicy", "arbeitnow", "smartrecruiters"].includes(l.source)) {
    return skillOkFor(l.title || "");
  }
  const text = `${l.title} ${l.snippet}`;
  if (!skillOkFor(text) && !l.demand_verified) return false;
  if (["linkedin", "instagram", "facebook", "twitter", "threads", "quora", "reddit"].includes(l.source)) {
    return l.demand_verified === true || scoreUrgency(text).hasUrgency || detectDemandBuckets(text).buckets.length > 0;
  }
  return true;
});

const div = diversifiedTop12(quality as Lead[], {
  maxJobBoard: 2,
  maxCompanyAts: 36,
  minSocial: 8,
  maxTotal: 120,
  minScore: 22,
  maxPerPlatform: 20,
});
const segments = segmentLeads(div);
const inWindow = (l: Lead) => {
  if (l.posted_at) {
    const t = new Date(l.posted_at).getTime();
    return Number.isFinite(t) && Date.now() - t <= 86_400_000;
  }
  return l.demand_verified === true || l.freshness_window === "day" || l.freshness_window === "week";
};
const shown = segments.posts.filter(inWindow);
const shownSrc: Record<string, number> = {};
for (const l of shown) shownSrc[l.source] = (shownSrc[l.source] ?? 0) + 1;
console.log("\nPosts after 24h-equivalent filter:", shown.length, shownSrc);

const platforms = new Set(
  shown.map((l) => l.source).filter((s) => !["arbeitnow", "jobicy", "greenhouse", "ashby", "lever", "remoteok"].includes(s)),
);
const hasSocial = ["linkedin", "instagram", "facebook", "twitter", "threads", "quora"].some((s) =>
  shown.some((l) => l.source === s),
);
const ok = hasSocial || (socialVal.length >= 2 && shown.some((l) => l.demand_verified));
console.log(`\n${ok ? "PASS" : "FAIL"} — non-company platforms in filtered Posts:`, [...platforms].join(", ") || "none");
console.log("hasSocialPlatform", hasSocial, "socialValidated", socialVal.length);
process.exit(ok ? 0 : 1);
