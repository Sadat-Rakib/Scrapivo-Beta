/**
 * Regression test for the shared demand gate.
 *   npx tsx scripts/verify-demand-gate.mts
 *
 * Every case below is REAL output captured from live source probes on
 * 2026-07-29 — the run that returned 46 "leads" of which 43 were Fiverr seller
 * gigs and Discord directory pages. If this file goes red, that junk is back.
 */
import { classifyDemand } from "../src/lib/search/demand-classifier.ts";

// Every one of these is REAL output from the live probes run earlier today.
const cases: Array<{ t: string; b?: string; url?: string; want: boolean; note: string }> = [
  // ── should KEEP (real opportunities) ──
  {
    t: "[Paid] UI/UX Designer needed to rework game UI screens and HUD",
    want: true,
    note: "reddit r/INAT",
  },
  { t: "[HIRING] Project-based Graphic Designer", want: true, note: "reddit r/GraphicDesignPH" },
  {
    t: "[Hiring] UX Professional (Architect/Designer) - Fort Worth, TX",
    want: true,
    note: "reddit r/forhire",
  },
  {
    t: "[HIRING] Freelance graphic designer for Amazon + social media",
    want: true,
    note: "reddit",
  },
  { t: "Can anyone recommend a good web designer?", want: true, note: "free-text demand" },
  { t: "We urgently need someone to redo our website", want: true, note: "urgent company need" },
  { t: "Looking for a video editor for weekly YouTube content", want: true, note: "free-text" },
  { t: "Our startup needs a brand identity, budget $3000", want: true, note: "budget stated" },
  { t: "We're exploring alternatives to Mailchimp", want: true, note: "tool replacement" },
  {
    t: "Still doing this manually in a spreadsheet — any tools?",
    want: true,
    note: "manual trigger",
  },

  // r/slavelabour + r/DoneDirtCheap convention: [TASK]=wants work, [OFFER]=sells work.
  {
    t: "[Offer] I will Be Your Professional Virtual Assistant For $5 per hour",
    want: false,
    note: "slavelabour seller",
  },
  {
    t: "[OFFER] Professional Logo and Branding Design for $25",
    want: false,
    note: "DoneDirtCheap seller",
  },
  {
    t: "[offer] Commissions Open | Logo, illustration, t-shirt design",
    want: false,
    note: "commissions open = seller",
  },
  { t: "[Task] $50 for a quick flyer design", want: true, note: "slavelabour buyer tag" },
  {
    t: "[Hiring] Looking for a motion designer for a short paid project",
    want: true,
    note: "real demand",
  },

  // Sellers DO misuse buyer tags — the tag must not rescue an obvious pitch.
  {
    t: "[TASK] Website built for you first — pay $200 only if you actually like it",
    want: false,
    note: "seller wearing a TASK tag",
  },
  {
    t: "[HIRING] Need a copywriter, DM me your portfolio",
    want: true,
    note: "buyer asking for portfolios",
  },
  {
    t: "[Task] Logo designed for you, commissions open",
    want: false,
    note: "seller wearing a Task tag",
  },

  // ── should DROP (the junk that polluted the 46-lead run) ──
  {
    t: "I will build website front end developer landing page html website",
    want: false,
    note: "Fiverr seller gig",
  },
  {
    t: "Discord servers tagged with logo-design | DISBOARD",
    url: "https://disboard.org/servers/tag/logo-design",
    want: false,
    note: "directory page",
  },
  {
    t: "Openings at Sonova, Veeva Systems, Canada Life, Cottage Dream Vacations, Censys",
    want: false,
    note: "multi-company digest",
  },
  {
    t: "NEED Definition & Meaning - Merriam-Webster",
    url: "https://www.merriam-webster.com/dictionary/need",
    want: false,
    note: "dictionary",
  },
  { t: "Hire Freelance Designers from the Top 3% - Toptal", want: false, note: "marketplace ad" },
  {
    t: "5 Reasons Not to Hire an Interior Designer | Courtney Warren Home",
    want: false,
    note: "listicle",
  },
  {
    t: "Inside The Design Process - How Much It Really Costs To Work With a Designer",
    want: false,
    note: "editorial",
  },
  { t: "[FOR HIRE] Senior graphic designer, $30/hr", want: false, note: "seller tag" },
  { t: "My portfolio - 5 years of design work", b: "hire me", want: false, note: "portfolio" },
  { t: "I'm a freelance designer available for work", want: false, note: "self-promo" },
  { t: "Looking for a job as a graphic designer", want: false, note: "job seeker" },
  { t: "Weekly hiring thread - July 2026", want: false, note: "recurring digest" },
  { t: "Top 20 best design agencies in 2026", want: false, note: "listicle" },
  { t: "Looking for advice : r/Design", want: false, note: "no actual need stated" },
  {
    t: "We design websites for your business — book a free consultation",
    want: false,
    note: "agency CTA",
  },
];

let pass = 0;
const fails: string[] = [];
for (const c of cases) {
  const v = classifyDemand({ title: c.t, body: c.b, url: c.url });
  const ok = v.isDemand === c.want;
  if (ok) pass++;
  else
    fails.push(
      `${c.want ? "should KEEP" : "should DROP"}: "${c.t.slice(0, 62)}" → got ${v.isDemand ? "KEEP" : `DROP(${v.rejectedAs})`}`,
    );
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${(v.isDemand ? "KEEP" : `DROP:${v.rejectedAs}`).padEnd(20)} ${c.t.slice(0, 58)}`,
  );
  if (ok && v.isDemand) console.log(`         └ ${v.reason} (boost ${v.boost})`);
}

console.log(`\n${pass}/${cases.length} correct`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  " + f);
}
process.exit(fails.length ? 1 : 0);
