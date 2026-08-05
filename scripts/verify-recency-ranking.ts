/**
 * Proves that freshness outranks staleness, which is the assumption that lets
 * company openings keep a 7-day window without the feed looking old.
 *
 * If this fails, ATS leads are back on top of the feed and the age complaint
 * returns — the window is NOT the safety net, the ranking is.
 *
 *   npx tsx scripts/verify-recency-ranking.ts
 */
import { scoreLead, diversifiedTop12, rankValue, type Lead } from "../src/lib/scoring";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function lead(over: Partial<Lead> & { title: string; posted_at?: string }): Lead {
  return {
    source: "test",
    platform: over.platform ?? "Test",
    title: over.title,
    snippet: over.snippet ?? over.title,
    full_post_url: over.full_post_url ?? `https://example.com/${Math.random()}`,
    ...over,
  } as Lead;
}

// Same buyer language, different ages — age is the only variable.
const ask = "Looking for a designer to help with our rebrand, budget $2000";
const ages = [0.2, 2, 8, 20, 40, 100, 150];
console.log("same post, different ages:\n");
let previous = Infinity;
let monotonic = true;
for (const h of ages) {
  const s = scoreLead(lead({ title: ask, posted_at: hoursAgo(h) }));
  const label = h < 1 ? `${Math.round(h * 60)}m` : `${h}h`;
  console.log(`  ${label.padStart(5)} old -> score ${s}`);
  if (s > previous) monotonic = false;
  previous = s;
}
console.log(`\nscore decreases with age: ${monotonic ? "PASS" : "FAIL"}`);

// The real contest: a fresh informal ask vs a stale, well-formed company role.
const freshAsk = lead({
  title: "Need a designer for a landing page, can pay $500",
  platform: "Reddit",
  posted_at: hoursAgo(1),
});
const staleJob = lead({
  title: "Hiring Senior Product Designer",
  snippet: "We are looking for a senior product designer to join our team.",
  platform: "Greenhouse",
  posted_at: hoursAgo(120), // 5 days — the age the user complained about
  is_decision_maker: true,
  engagement: 40,
});

// scoreLead answers "is this good enough to show"; rankValue answers "where
// does it go". The stale role is legitimately the stronger lead on quality —
// it has a named decision-maker and engagement — so it SHOULD keep the higher
// raw score and stay in the Companies tab. It just must not lead the feed.
const freshScore = scoreLead(freshAsk);
const staleScore = scoreLead(staleJob);
freshAsk.score = freshScore;
staleJob.score = staleScore;
const freshRank = rankValue(freshAsk);
const staleRank = rankValue(staleJob);
console.log(`\nfresh ask  (1h)  score ${freshScore}  rank ${freshRank.toFixed(1)}`);
console.log(`stale role (5d)  score ${staleScore}  rank ${staleRank.toFixed(1)}`);
console.log(`stale role still qualifies: ${staleScore >= 36 ? "PASS" : "FAIL"}`);
console.log(`fresh ranks above it: ${freshRank > staleRank ? "PASS" : "FAIL"}`);

// And through the real ranker, which is what the feed actually uses.
const ordered = diversifiedTop12([staleJob, freshAsk], { maxTotal: 10, minScore: 0 });
const firstIsFresh = ordered[0]?.full_post_url === freshAsk.full_post_url;
const bothKept = ordered.length === 2;
console.log(`diversifiedTop12 puts the fresh one first: ${firstIsFresh ? "PASS" : "FAIL"}`);
console.log(`both leads survive (no volume lost): ${bothKept ? "PASS" : "FAIL"}`);

const allPassed =
  monotonic && staleScore >= 36 && freshRank > staleRank && firstIsFresh && bothKept;
console.log(`\n${allPassed ? "PASS — freshness drives the feed" : "FAIL"}`);
process.exit(allPassed ? 0 : 1);
