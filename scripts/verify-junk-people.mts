/**
 * Screenshot + design-query checks for Kill Junk / Fill People.
 * Run: npx tsx scripts/verify-junk-people.mts
 */
import {
  isSellerOrProviderLead,
  isJobListPage,
  isMarketplaceOrListicle,
  isPersonalStoryNoise,
  isOffSkillRole,
  isHirePolarityLookingFor,
  detectBuyerIntent,
} from "../src/lib/validation.ts";
import { isBuyerContent, isStronglyRelevantToSkill } from "../src/lib/search/query-expander.ts";
import { hasBuyerSignal } from "../src/lib/scoring.ts";
import {
  linkedInAuthorFromUrl,
  segmentLeads,
  extractCompanyFromLead,
} from "../src/lib/search/lead-segments.ts";

const fail: string[] = [];
const ok = (n: string, c: boolean) => {
  if (!c) fail.push(n);
  else console.log("OK:", n);
};

const sellerBiz = {
  title: "Looking for a Freelance Web Developer for your business?",
  snippet: "If you are a business founder… dm me your requirements",
  full_post_url: "https://reddit.com/r/webdev/comments/abc",
  source: "reddit",
} as any;
ok("drop seller for-your-business", isSellerOrProviderLead(sellerBiz));
ok("seller not hire-polarity", !isHirePolarityLookingFor(`${sellerBiz.title} ${sellerBiz.snippet}`));

const roomSeller = {
  title: "Let's fix that room you've been staring at! (Starting at $99)",
  snippet: "[HIRING] looking for newbie… [Hiring] website design… [Hiring] 400$",
  full_post_url: "https://reddit.com/r/forhire/comments/room",
  source: "reddit",
} as any;
ok("drop room/$99 seller", isSellerOrProviderLead(roomSeller));
ok("drop [Hiring] soup", isJobListPage(roomSeller));

const commission = {
  title: "Looking for a Commission-Based Partner to Find Website Clients",
  snippet: "I design and build modern websites.",
  full_post_url: "https://reddit.com/r/webdev/comments/xyz",
  source: "reddit",
} as any;
ok("drop commission partner", isSellerOrProviderLead(commission));
ok("drop commission off-skill", isOffSkillRole(commission, "web development"));

ok(
  "drop listicle",
  isMarketplaceOrListicle({
    title: "15+ Best Rated Web Development Services near you",
    snippet: "",
    full_post_url: "",
    source: "serpapi",
  } as any),
);

ok(
  "drop rates/AI noise",
  isMarketplaceOrListicle({
    title: "Their rates, real pay, and how they really feel about AI",
    snippet: "",
    full_post_url: "",
    source: "serpapi",
  } as any) ||
    isPersonalStoryNoise({
      title: "Their rates, real pay, and how they really feel about AI",
      snippet: "",
      full_post_url: "",
      source: "serpapi",
    } as any),
);

ok(
  "drop job aggregator",
  isJobListPage({
    title: "1,000+ Freelance Web Developer jobs in United States",
    snippet: "#### Layer\n### Frontend Developer",
    full_post_url: "https://example.com/jobs",
    source: "webboolean",
  } as any),
);

ok(
  "drop advice",
  isPersonalStoryNoise({
    title: "how have you managed to find jobs at small companies?",
    snippet: "Need a web developer!",
    full_post_url: "https://reddit.com/r/cscareerquestions/comments/qqq",
    source: "reddit",
  } as any),
);

ok(
  "drop sculptor for design skill",
  isOffSkillRole(
    {
      title: "[hiring] sculptor, mold caster, large 3D printer",
      snippet: "need design help",
      source: "reddit",
      full_post_url: "",
    } as any,
    "design",
  ),
);

ok(
  "drop interior design adjacency",
  !isStronglyRelevantToSkill(
    "Let's fix that room interior design starting at $99",
    "design",
  ),
);

ok(
  "keep ui designer hire",
  isStronglyRelevantToSkill(
    "Looking for a UI designer for our landing page. Figma preferred.",
    "design",
  ),
);

const realBuyer = {
  title: "Looking for a freelancer to build my site — budget $2k",
  snippet: "Need someone to build a marketing site. Willing to pay.",
  full_post_url: "https://reddit.com/r/forhire/comments/good",
  source: "reddit",
  author: "startup_founder",
  author_url: "https://reddit.com/user/startup_founder",
  score: 70,
  tier: "hot" as const,
} as any;
ok("keep real buyer", isHirePolarityLookingFor(`${realBuyer.title} ${realBuyer.snippet}`));
ok("real buyer content", isBuyerContent(`${realBuyer.title} ${realBuyer.snippet}`, []));
ok("real buyer intent", detectBuyerIntent(`${realBuyer.title} ${realBuyer.snippet}`).isBuyer);
ok("real buyer not seller", !isSellerOrProviderLead(realBuyer));
ok("real buyer HOT", hasBuyerSignal(`${realBuyer.title} ${realBuyer.snippet}`).tier === "hot");

ok(
  "linkedin slug person",
  !!linkedInAuthorFromUrl(
    "https://www.linkedin.com/posts/alaa-ezzeddine_hiring-website-developer-activity-123",
  ),
);

const liPerson = {
  source: "linkedin",
  platform: "LinkedIn Post",
  title: "Need a freelancer for our web app. Budget ready.",
  snippet: "Looking for a contractor who can help. Willing to pay.",
  full_post_url:
    "https://www.linkedin.com/posts/alaa-ezzeddine_need-a-freelancer-activity-999",
  author: "",
  score: 70,
  tier: "hot" as const,
  posted_at: new Date().toISOString(),
} as any;
const seg = segmentLeads([liPerson, realBuyer]);
ok("people > 0", seg.people.length >= 1);
ok("alaa in people", seg.people.some((p) => /Alaa/i.test(p.name)));

const firm = {
  source: "reddit",
  platform: "Reddit Post",
  title: "Integral Labs is hiring a web developer",
  snippet: "We need a contractor. Budget available.",
  full_post_url: "https://reddit.com/r/forhire/comments/firm",
  author: "some_user",
  score: 65,
  tier: "warm" as const,
} as any;
ok("extract Integral Labs", /Integral Labs/i.test(extractCompanyFromLead(firm) || ""));

if (fail.length) {
  console.error("\nFAIL:", fail);
  process.exit(1);
}
console.log("\nPASS all cases");
