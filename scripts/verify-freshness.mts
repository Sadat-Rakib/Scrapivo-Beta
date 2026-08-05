/**
 * Freshness + volume regression checks.
 * Run: npx tsx scripts/verify-freshness.mts
 */
import { isRecent, CLIENTS_SOCIAL_MAX_AGE_DAYS } from "../src/lib/search/query-expander.ts";
import { segmentLeads } from "../src/lib/search/lead-segments.ts";
import { isSellerOrProviderLead, isJobListPage } from "../src/lib/validation.ts";

const fail: string[] = [];
const ok = (n: string, c: boolean) => {
  if (!c) fail.push(n);
  else console.log("OK:", n);
};

// 2023 Instagram reel must fail clients freshness
const old = "2023-12-12T12:00:00.000Z";
ok("2023 not recent (1d)", !isRecent(old, CLIENTS_SOCIAL_MAX_AGE_DAYS));
ok("2023 not recent (2d)", !isRecent(old, 2));
ok("2023 not recent (7d)", !isRecent(old, 7));

const hoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
ok("3h ago is recent", isRecent(hoursAgo, CLIENTS_SOCIAL_MAX_AGE_DAYS));

const undatedIg = {
  source: "instagram",
  platform: "Instagram Post",
  title: "We're hiring! Product Designers Wanted",
  snippet: "Snøhetta Product Design is looking for designers",
  full_post_url: "https://www.instagram.com/reel/DSKCli8jA8Q/",
  author: "snohetta.design",
  author_url: "https://www.instagram.com/snohetta.design/",
  // no posted_at — must not segment as a kept lead in practice; source layer drops it
} as any;

// People recovery when human author present; brand IG → Companies
const freshIg = {
  ...undatedIg,
  posted_at: hoursAgo,
  score: 70,
  tier: "hot" as const,
};
const segCo = segmentLeads([freshIg]);
ok("IG brand in companies", segCo.companies.some((c) => /snohetta/i.test(c.name)));
ok("IG brand not people", !segCo.people.some((p) => /snohetta/i.test(p.name)));

const humanIg = {
  source: "instagram",
  platform: "Instagram Post",
  title: "Looking for a freelance UI designer this week",
  snippet: "Need someone who can help with Figma. Budget ready.",
  full_post_url: "https://www.instagram.com/p/abc123/",
  author: "jane_founder",
  author_url: "https://www.instagram.com/jane_founder/",
  posted_at: hoursAgo,
  score: 70,
  tier: "hot" as const,
} as any;
const segPe = segmentLeads([humanIg]);
ok("IG human in people", segPe.people.some((p) => /jane_founder/i.test(p.name)));

const roomSeller = {
  title: "Let's fix that room you've been staring at! (Starting at $99)",
  snippet: "[HIRING] a [Hiring] b",
  full_post_url: "https://reddit.com/r/x",
  source: "reddit",
} as any;
ok("still drop room seller", isSellerOrProviderLead(roomSeller));
ok("still drop hiring soup", isJobListPage(roomSeller));

if (fail.length) {
  console.error("FAIL", fail);
  process.exit(1);
}
console.log("\nPASS freshness checks");
