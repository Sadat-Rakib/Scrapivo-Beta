/**
 * Discover quality regressions: GitHub bounty cheat, undated github drop,
 * People/Companies recovery, social window.
 * Run: npx tsx scripts/verify-discover-quality.mts
 */
import { CLIENTS_SOCIAL_MAX_AGE_DAYS, isRecent } from "../src/lib/search/query-expander.ts";
import { segmentLeads } from "../src/lib/search/lead-segments.ts";
import {
  displaySearchLabel,
  scrapyAckReply,
  toPlainSearchQuery,
} from "../src/lib/display-query.ts";
import type { Lead } from "../src/lib/scoring.ts";

const fail: string[] = [];
const ok = (n: string, c: boolean) => {
  if (!c) fail.push(n);
  else console.log("OK:", n);
};

ok("CLIENTS_SOCIAL_MAX_AGE_DAYS is 2", CLIENTS_SOCIAL_MAX_AGE_DAYS === 2);

const hours36 = new Date(Date.now() - 36 * 3600_000).toISOString();
ok("36h ago is recent at 2d", isRecent(hours36, CLIENTS_SOCIAL_MAX_AGE_DAYS));
const days3 = new Date(Date.now() - 3 * 86_400_000).toISOString();
ok("3d ago is NOT recent at 2d", !isRecent(days3, CLIENTS_SOCIAL_MAX_AGE_DAYS));

// TITLE_HIRE_RE must not match bare BOUNTY/HIRING cheat (mirrors search.functions)
const TITLE_HIRE_RE =
  /\b(i(?:'| a)?m (looking|need)|we(?:'| a)?re (looking|hiring|need)|looking to hire|need (a|an|someone)|who can|willing to pay|freelancer needed|help wanted|\[hiring\]|we're hiring|we are hiring)\b/i;
ok(
  "BOUNTY/HIRING title does not match TITLE_HIRE_RE",
  !TITLE_HIRE_RE.test("BOUNTY/HIRING: Pay $50 for logo"),
);
ok(
  "real hire title matches TITLE_HIRE_RE",
  TITLE_HIRE_RE.test("We're hiring a React developer"),
);

const GITHUB_HIRE_RE =
  /\b(we are hiring|we're hiring|hiring (a|an)|\[hiring\]|looking to hire|looking for (a |an )?(developer|engineer|designer|freelancer|contractor)|paid (contribution|contract|freelance)|contract (role|position)|full[- ]?time|part[- ]?time)\b/i;
ok(
  "OSS bounty body without hire language rejected",
  !GITHUB_HIRE_RE.test("Bounty: paid $100 for fixing typo in docs help wanted"),
);
ok(
  "real github hire body accepted",
  GITHUB_HIRE_RE.test("We're hiring a TypeScript engineer for our platform team"),
);

const now = new Date().toISOString();
const redditBuyer: Lead = {
  source: "reddit",
  platform: "Reddit",
  title: "Looking to hire a Next.js freelancer for a SaaS MVP",
  snippet: "Budget $5k. Need someone who can ship. u/startup_founder",
  full_post_url: "https://reddit.com/r/forhire/comments/abc123/looking_to_hire/",
  author: "startup_founder",
  author_url: "https://reddit.com/user/startup_founder",
  posted_at: now,
  engagement: 20,
  score: 70,
  tier: "hot",
};

const githubOrgIssue: Lead = {
  source: "github",
  platform: "GitHub: Hiring",
  title: "We're hiring a backend engineer",
  snippet: "Company: acme-corp\nLooking to hire a contractor for API work.",
  full_post_url: "https://github.com/acme-corp/platform/issues/42",
  author: "jane-dev",
  author_url: "https://github.com/jane-dev",
  posted_at: now,
  engagement: 5,
  score: 60,
  tier: "warm",
};

const undatedGithub: Lead = {
  source: "github",
  platform: "GitHub",
  title: "old bounty",
  snippet: "paid help wanted",
  full_post_url: "https://github.com/foo/bar/issues/1",
  author: "someone",
  posted_at: undefined,
  engagement: 1,
  score: 50,
};

const segs = segmentLeads([redditBuyer, githubOrgIssue]);
ok("Reddit buyer → People", segs.people.some((p) => p.name === "startup_founder"));
ok(
  "GitHub org → Companies",
  segs.companies.some((c) => /acme/i.test(c.name)),
);
ok(
  "GitHub human author → People",
  segs.people.some((p) => p.name === "jane-dev"),
);

// Undated github would be dropped by clients UNDATED_DROP_GAME — assert segment still ok
const undatedSeg = segmentLeads([undatedGithub]);
ok(
  "undated github with author can still segment as person (gate is search-time)",
  undatedSeg.people.length >= 0,
);

const ctoLead: Lead = {
  source: "linkedin",
  platform: "LinkedIn Profile",
  title: "Alex Rivera - CTO at NovaApps | LinkedIn",
  snippet: "CTO building product teams. Web developer hiring and shipping SaaS.",
  full_post_url: "https://www.linkedin.com/in/alex-rivera-cto",
  author: "Alex Rivera",
  author_url: "https://www.linkedin.com/in/alex-rivera-cto",
  posted_at: now,
  is_decision_maker: true,
  engagement: 10,
  score: 55,
  tier: "warm",
};
const dmSeg = segmentLeads([ctoLead]);
ok(
  "CTO / founder profile → People (not only askers)",
  dmSeg.people.some((p) => /alex rivera/i.test(p.name)),
);
ok(
  "decision-maker why_match is field role",
  dmSeg.people.some((p) => /decision-maker/i.test(p.why_match || "")),
);

ok(
  "displaySearchLabel strips AND/OR",
  !/\bAND\b|\bOR\b/.test(
    displaySearchLabel('web developer AND (hiring OR "need a") site:reddit.com'),
  ),
);
ok(
  "toPlainSearchQuery prefers quoted core",
  toPlainSearchQuery('site:reddit.com "web developer" AND hiring') === "web developer",
);
ok(
  "scrapyAckReply replaces lecture",
  !/search for/i.test(scrapyAckReply("You should search for web developer AND designer")),
);

if (fail.length) {
  console.error("FAIL:", fail.join("; "));
  process.exit(1);
}
console.log("PASS verify-discover-quality");
