/**
 * Headless verification for the contact discovery stack.
 *
 *   npx tsx scripts/verify-contact-discovery.mts             # offline checks only
 *   npx tsx scripts/verify-contact-discovery.mts stripe.com  # + live harvest
 *
 * The offline half is deterministic and must always pass: pattern inference,
 * phone rules, de-obfuscation, JSON-LD extraction, robots.txt parsing, and the
 * CASL consent logic. The live half hits the network and is informational —
 * a site being down is not a test failure.
 */
import {
  deriveEmailCandidates,
  inferOrgPattern,
  matchPattern,
  parsePersonName,
} from "../src/lib/contact/email-patterns.ts";
import { parsePhone, normalizePhones, isLikelyMainLine } from "../src/lib/contact/phone.ts";
import {
  assessConsent,
  detectAntiCemStatement,
  provenanceEntry,
  complianceRow,
} from "../src/lib/contact/provenance.ts";
import {
  deobfuscateText,
  decodeCloudflareEmail,
  extractJsonLdContacts,
  discoverContactPages,
  classifyEmailDomain,
  extractPeopleFromText,
  harvestDomainContacts,
} from "../src/lib/contact/harvest.server.ts";
import { parseRobots } from "../src/lib/contact/robots.server.ts";
import { competitorsFromQuery } from "../src/lib/search/github-intent.server.ts";
import { discoverContacts } from "../src/lib/contact/discover-contacts.server.ts";

const ROLE_LOCALPARTS = new Set(["info", "sales", "support", "hello", "contact", "careers"]);

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

// ── names & patterns ────────────────────────────────────────────────────────
section("Name parsing");
{
  const jane = parsePersonName("Jane Smith");
  check("simple name splits", jane.first === "jane" && jane.last === "smith", jane);

  const accented = parsePersonName("José Álvarez");
  check(
    "accents fold to ASCII",
    accented.first === "jose" && accented.last === "alvarez",
    accented,
  );

  const particle = parsePersonName("Piet van der Berg");
  check("surname particles stay with the surname", particle.last === "vanderberg", particle);

  const honorific = parsePersonName("Dr. Alan Turing PhD");
  check("honorifics dropped", honorific.first === "alan" && honorific.last === "turing", honorific);

  const flipped = parsePersonName("Smith, Jane");
  check("comma form flips", flipped.first === "jane" && flipped.last === "smith", flipped);

  const single = parsePersonName("Madonna");
  check(
    "single-token name is not ok for two-part patterns",
    single.ok === true && single.last === "",
    single,
  );
}

section("Pattern inference");
{
  const m = matchPattern("jane.smith", "Jane Smith");
  check(
    "first.last recognised",
    m.some((x) => x.pattern === "first.last"),
    m,
  );

  const inference = inferOrgPattern(
    [
      { email: "jane.smith@acme.com", name: "Jane Smith" },
      { email: "info@acme.com" },
      { email: "raj.patel@acme.com", name: "Raj Patel" },
    ],
    ROLE_LOCALPARTS,
  );
  check("org pattern inferred as first.last", inference.pattern === "first.last", inference);
  check("inference confidence is meaningful", inference.confidence >= 0.5, inference.confidence);

  const candidates = deriveEmailCandidates("Alan Turing", "acme.com", {
    inference,
    limit: 4,
    roleLocalParts: ROLE_LOCALPARTS,
  });
  check(
    "top candidate follows the inferred pattern",
    candidates[0]?.email === "alan.turing@acme.com",
    candidates[0],
  );
  check(
    "alternatives are demoted, not dropped",
    candidates.length > 1 && candidates[1].prior < candidates[0].prior,
    candidates.slice(0, 2),
  );

  // With no name-linked evidence, we should fall back to shape + base rates.
  const shapeOnly = inferOrgPattern(
    [{ email: "j.doe@acme.com" }, { email: "m.roe@acme.com" }],
    ROLE_LOCALPARTS,
  );
  check(
    "shape hint detected without names",
    shapeOnly.pattern === null && shapeOnly.shape_hint === "dotted",
    shapeOnly,
  );

  const roleOnly = inferOrgPattern(
    [{ email: "info@acme.com" }, { email: "sales@acme.com" }],
    ROLE_LOCALPARTS,
  );
  check(
    "role inboxes never vote for a pattern",
    roleOnly.pattern === null && !roleOnly.shape_hint,
    roleOnly,
  );

  const derivedNoDomain = deriveEmailCandidates("Jane Smith", "");
  check("no domain → no candidates", derivedNoDomain.length === 0);
}

// ── phones ──────────────────────────────────────────────────────────────────
section("Phone validation");
{
  const good = parsePhone("+1 (403) 262-0182");
  check(
    "NANP number parses to E.164",
    good.e164 === "+14032620182" && good.status === "valid",
    good,
  );

  const fictional = parsePhone("+1 212 555 0100");
  check("555-01XX rejected as fictional", fictional.status === "fictional", fictional);

  const n11 = parsePhone("+1 411 555 2020");
  check("N11 area code rejected", n11.status === "invalid_prefix", n11);

  const leadingOne = parsePhone("+1 103 555 2020");
  check("area code starting with 1 rejected", leadingOne.status === "invalid_prefix", leadingOne);

  const short = parsePhone("+44 123");
  check("too-short number rejected", short.status === "too_short", short);

  const bare = parsePhone("4032620182");
  check("bare 10-digit accepted as NANP when rules pass", bare.e164 === "+14032620182", bare);

  const ambiguous = parsePhone("612345678");
  check(
    "bare non-NANP without a default country is unknown",
    ambiguous.status === "unknown_country",
    ambiguous,
  );

  const withCountry = parsePhone("0612345678", { defaultCountry: "FR" });
  check(
    "trunk prefix stripped with a default country",
    withCountry.e164 === "+33612345678",
    withCountry,
  );

  const date = parsePhone("20260729123");
  check(
    "date-shaped digits rejected",
    date.status === "fictional" || date.status === "unknown_country",
    date,
  );

  const repeated = parsePhone("+1 111 111 1111");
  check("repeated digits rejected", repeated.status === "fictional", repeated);

  const ext = parsePhone("+1 403 262 0182 ext. 42");
  check("extension preserved", ext.e164 === "+14032620182;ext=42", ext);

  const deduped = normalizePhones([
    "+1 (403) 262-0182",
    "403.262.0182",
    "+1 403 262 0182",
    "garbage",
  ]);
  check("same number in four formats collapses to one", deduped.length === 1, deduped);

  const tollFree = parsePhone("+1 800 262 0182");
  check("toll-free flagged as a main line", isLikelyMainLine(tollFree), tollFree);
}

// ── obfuscation & structured data ───────────────────────────────────────────
section("Extraction primitives");
{
  check(
    "[at]/[dot] de-obfuscated",
    deobfuscateText("jane [at] acme [dot] com").includes("jane@acme.com"),
    deobfuscateText("jane [at] acme [dot] com"),
  );
  check("HTML entities decoded", deobfuscateText("jane&#64;acme.com").includes("jane@acme.com"));
  check(
    "ordinary prose is not turned into an address",
    !/@/.test(deobfuscateText("we met at the conference last year")),
    deobfuscateText("we met at the conference last year"),
  );

  // "info@example.com" XOR-encoded the way Cloudflare does it.
  const plain = "info@example.com";
  const key = 0x2a;
  const cfHex =
    key.toString(16).padStart(2, "0") +
    [...plain].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  check(
    "Cloudflare email-protection decoded",
    decodeCloudflareEmail(cfHex) === plain,
    decodeCloudflareEmail(cfHex),
  );
  check("garbage hex rejected", decodeCloudflareEmail("zzzz") === null);

  const jsonLd = extractJsonLdContacts(`
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Organization","name":"Acme",
     "email":"mailto:hello@acme.com","telephone":"+1-403-555-0182",
     "address":{"@type":"PostalAddress","addressCountry":"CA"},
     "sameAs":["https://www.linkedin.com/company/acme"],
     "employee":[{"@type":"Person","name":"Jane Smith","jobTitle":"CTO","email":"jane.smith@acme.com"}]}
    </script>`);
  check("JSON-LD org email extracted", jsonLd.emails.includes("hello@acme.com"), jsonLd.emails);
  check(
    "JSON-LD person + title extracted",
    jsonLd.people[0]?.name === "Jane Smith" && jsonLd.people[0]?.role_title === "CTO",
    jsonLd.people,
  );
  check("JSON-LD country captured", jsonLd.country === "CA", jsonLd.country);
  check("JSON-LD phone captured", jsonLd.phones[0] === "+1-403-555-0182", jsonLd.phones);

  const pages = discoverContactPages(
    `<a href="/impressum">Impressum</a>
     <a href="/blog/hello">Blog</a>
     <a href="/en/company/contact-us">Contact us</a>
     <a href="https://other.com/contact">Elsewhere</a>
     <a href="/logo.png">img</a>`,
    "https://acme.com/",
    5,
  );
  check("impressum ranks first", pages[0] === "https://acme.com/impressum", pages);
  check(
    "contact page discovered at a non-standard path",
    pages.includes("https://acme.com/en/company/contact-us"),
    pages,
  );
  check(
    "off-site and asset links excluded",
    !pages.some((p) => p.includes("other.com") || p.endsWith(".png")),
    pages,
  );

  check(
    "own-domain address classified",
    classifyEmailDomain("jane@acme.com", "acme.com") === "own",
  );
  check(
    "consumer mailbox kept but marked",
    classifyEmailDomain("jane@gmail.com", "acme.com") === "personal",
  );
  check(
    "vendor address rejected",
    classifyEmailDomain("noreply@sentry.io", "acme.com") === "foreign",
  );
}

// ── person extraction ───────────────────────────────────────────────────────
section("Person extraction from page text");
{
  const team = extractPeopleFromText(
    "Our team. Jane Smith Chief Technology Officer jane.smith@acme.com. Raj Patel Head of Growth raj@acme.com. Priya Sharma Director of Sales.",
    "https://acme.com/team",
  );
  const names = team.map((p) => p.name);
  check(
    "real names extracted from a team page",
    names.includes("Jane Smith") && names.includes("Raj Patel"),
    names,
  );
  check(
    "title attached to the right person",
    team
      .find((p) => p.name === "Jane Smith")
      ?.role_title?.toLowerCase()
      .includes("chief"),
    team[0],
  );
  check(
    "adjacent email attached",
    team.find((p) => p.name === "Jane Smith")?.email === "jane.smith@acme.com",
    team[0],
  );

  // The exact failure mode a live run against vercel.com surfaced.
  const marketing = extractPeopleFromText(
    "Agentic Infrastructure Partner Containers Run Partner About Us Skip Bot Management Skip Explore Enterprise Agent Partner Product News CTO Company Milestone CTO",
    "https://acme.com/",
  );
  check(
    "marketing headings are NOT treated as people",
    marketing.length === 0,
    marketing.map((p) => p.name),
  );

  const trailing = extractPeopleFromText(
    "Sahil Lavingia Founder and CEO of Gumroad",
    "https://acme.com/about",
  );
  check(
    "trailing role words trimmed off the name",
    trailing[0]?.name === "Sahil Lavingia",
    trailing,
  );

  const investors = extractPeopleFromText(
    "Jordan Walke Creator of React Naval Ravikant Founder of AngelList Ilya Sukhar Founder of Parse David Cramer Founder of Sentry",
    "https://acme.com/about",
  );
  check(
    "a company after 'of' is not glued onto the next person's name",
    !investors.some((p) => /^(React|AngelList|Parse|Sentry)\b/.test(p.name)),
    investors.map((p) => p.name),
  );
  check(
    "the real people are still found",
    investors.some((p) => p.name === "Naval Ravikant"),
    investors.map((p) => p.name),
  );

  // The name regex stops at the capital F in "Co-Founder", leaving a "Co-" tail.
  const hyphenated = extractPeopleFromText(
    "James Hawkins Co-Founder and CEO",
    "https://posthog.com/about",
  );
  check(
    "hyphen fragment trimmed off the name",
    hyphenated[0]?.name === "James Hawkins",
    hyphenated,
  );

  const funds = extractPeopleFromText(
    "First Round Capital Partner and Production Index CEO",
    "https://acme.com/investors",
  );
  check(
    "fund names are not people",
    funds.length === 0,
    funds.map((p) => p.name),
  );

  const branded = extractPeopleFromText(
    "Guillermo Rauch Vercel CEO",
    "https://vercel.com/about",
    new Set(["vercel"]),
  );
  check(
    "company brand stripped off a trailing surname",
    branded[0]?.name === "Guillermo Rauch",
    branded,
  );

  const distant = extractPeopleFromText(
    `Guillermo Rauch ${"filler words ".repeat(30)} Chief Executive Officer`,
    "https://acme.com/",
  );
  check("a far-away role word is not attached to a name", distant.length === 0, distant);
}

// ── robots.txt ──────────────────────────────────────────────────────────────
section("robots.txt parsing");
{
  const policy = parseRobots(
    `User-agent: *
Disallow: /private/
Allow: /private/public-bio
Crawl-delay: 2
Sitemap: https://acme.com/sitemap.xml

User-agent: ScrapivoBot
Disallow: /nope`,
    "ScrapivoBot",
  );
  check(
    "agent-specific group wins over *",
    policy.rules.length === 1 && policy.rules[0].path === "/nope",
    policy.rules,
  );
  check(
    "sitemaps captured globally",
    policy.sitemaps[0] === "https://acme.com/sitemap.xml",
    policy.sitemaps,
  );

  const wildcardPolicy = parseRobots(
    `User-agent: *\nDisallow: /private/\nAllow: /private/bio\nCrawl-delay: 2`,
  );
  check(
    "wildcard group used when no exact match",
    wildcardPolicy.rules.length === 2,
    wildcardPolicy.rules,
  );
  check(
    "crawl-delay parsed to ms",
    wildcardPolicy.crawlDelayMs === 2000,
    wildcardPolicy.crawlDelayMs,
  );

  const emptyDisallow = parseRobots(`User-agent: *\nDisallow:`);
  check("empty Disallow means allow-all", emptyDisallow.rules.length === 0, emptyDisallow.rules);
}

// ── GitHub intent query building ────────────────────────────────────────────
section("GitHub competitor extraction");
{
  check(
    "tool name pulled from 'alternative to X'",
    competitorsFromQuery("find teams looking for an alternative to Apollo").includes("Apollo"),
    competitorsFromQuery("find teams looking for an alternative to Apollo"),
  );
  check(
    "'switching from X' also yields the tool",
    competitorsFromQuery("companies switching from Mailchimp this month").includes("Mailchimp"),
    competitorsFromQuery("companies switching from Mailchimp this month"),
  );
  // A category noun is not a product — running "alternative to cold outreach"
  // against the search API is a guaranteed zero and wastes a rate-limited query.
  check(
    "lowercase category nouns are NOT treated as competitors",
    competitorsFromQuery("people looking for an alternative to cold outreach").length === 0,
    competitorsFromQuery("people looking for an alternative to cold outreach"),
  );
  check(
    "plain query yields no competitors",
    competitorsFromQuery("react developers in Calgary").length === 0,
  );
}

// ── CASL consent ────────────────────────────────────────────────────────────
section("CASL consent assessment");
{
  const published = provenanceEntry("harvested", {
    source_url: "https://acme.com/team",
    anti_cem_statement: false,
    role_title: "Head of Engineering",
  });
  const ok = assessConsent({ provenance: [published], role_title: "Head of Engineering" });
  check(
    "published + no refusal + role → implied consent",
    ok.basis === "implied_conspicuous_publication" && ok.outreach_ready,
    ok,
  );

  const noRole = assessConsent({
    provenance: [
      provenanceEntry("harvested", {
        source_url: "https://acme.com/contact",
        anti_cem_statement: false,
      }),
    ],
  });
  check(
    "no role captured → not outreach ready",
    noRole.basis === "implied_unverified" && !noRole.outreach_ready,
    noRole,
  );

  const refused = assessConsent({
    provenance: [
      provenanceEntry("harvested", {
        source_url: "https://acme.com/contact",
        anti_cem_statement: true,
      }),
    ],
    role_title: "CTO",
  });
  check(
    "refusal statement defeats implied consent",
    refused.basis === "none" && !refused.outreach_ready,
    refused,
  );

  const derived = assessConsent({
    provenance: [provenanceEntry("pattern_derived", { publisher: "acme.com" })],
    role_title: "CTO",
  });
  check(
    "pattern-derived address has NO consent basis",
    derived.basis === "none" && !derived.outreach_ready,
    derived,
  );

  const paid = assessConsent({
    provenance: [provenanceEntry("paid_provider", {})],
    role_title: "CTO",
  });
  check("broker-sourced address has no publication basis", paid.basis === "none", paid);

  const unassessed = assessConsent({
    provenance: [provenanceEntry("dns_record", { source_url: "dns:_dmarc.acme.com" })],
    role_title: "Security",
  });
  check(
    "unassessed source → implied_unverified, not a green light",
    unassessed.basis === "implied_unverified",
    unassessed,
  );

  const row = complianceRow(
    {
      kind: "email",
      value: "jane@acme.com",
      name: "Jane Smith",
      role_title: "Head of Engineering",
      confidence: 0.8,
      provenance: [published],
    },
    ok,
  );
  check(
    "compliance row carries source + hash fields",
    row.source_url === "https://acme.com/team" &&
      row.consent_basis === "implied_conspicuous_publication",
    row,
  );

  check(
    "anti-CEM detected (EN)",
    detectAntiCemStatement(
      "Please note we do not accept unsolicited commercial emails from vendors or agencies.",
    ) === true,
  );
  check(
    "anti-CEM detected (DE Impressum)",
    detectAntiCemStatement(
      "Der Nutzung von im Rahmen der Impressumspflicht veröffentlichten Kontaktdaten zu Werbezwecken wird hiermit ausdrücklich widersprochen.",
    ) === true,
  );
  check(
    "anti-CEM detected (FR)",
    detectAntiCemStatement(
      "Nous ne souhaitons pas recevoir de courriels commerciaux non sollicités de la part des fournisseurs.",
    ) === true,
  );
  check(
    "clean page returns false, not null",
    detectAntiCemStatement(
      "Contact our team at hello@acme.com. We are based in Calgary and work with startups across Canada.",
    ) === false,
  );
  check("empty page is 'not assessed' (null)", detectAntiCemStatement("") === null);
}

// ── live checks (optional) ──────────────────────────────────────────────────
const liveDomain = process.argv[2];
if (liveDomain) {
  section(`Live harvest: ${liveDomain}`);
  const harvest = await harvestDomainContacts(liveDomain, { maxPages: 5 });
  console.log(
    `  pages fetched : ${harvest.pages.length} (${harvest.pages.filter((p) => p.ok).length} usable)`,
  );
  for (const p of harvest.pages)
    console.log(`      ${p.ok ? "ok  " : "skip"} ${p.url}${p.reason ? ` (${p.reason})` : ""}`);
  console.log(`  mail provider : ${harvest.mx_provider} [${harvest.mx_hosts.join(", ")}]`);
  console.log(`  emails        : ${harvest.emails.length}`);
  for (const e of harvest.emails.slice(0, 8)) {
    console.log(
      `      ${e.email}  conf=${e.confidence}  ${e.role_account ? "[role]" : ""}${e.name ? ` name=${e.name}` : ""}  via ${e.provenance.locator} @ ${e.provenance.source_url ?? "-"}`,
    );
  }
  console.log(`  phones        : ${harvest.phones.map((p) => p.parsed.e164).join(", ") || "none"}`);
  console.log(
    `  people        : ${harvest.people.map((p) => `${p.name}${p.role_title ? ` (${p.role_title})` : ""}`).join("; ") || "none"}`,
  );
  console.log(`  socials       : ${JSON.stringify(harvest.socials)}`);
  console.log(`  anti-CEM      : ${harvest.anti_cem_found}`);
  if (harvest.skipped_by_robots.length)
    console.log(`  robots skips  : ${harvest.skipped_by_robots.join("; ")}`);

  section(`Full discovery: ${liveDomain}`);
  const company = process.argv[3] || liveDomain.replace(/\.[a-z.]+$/, "");
  const discovery = await discoverContacts({
    company,
    domain: liveDomain,
    personName: process.argv[4],
    freeOnly: true,
    skipRegistries: true,
    maxPages: 5,
  });
  console.log(
    `  inferred format : ${discovery.pattern?.pattern ?? "none"} (${discovery.pattern?.confidence ?? 0})`,
  );
  console.log(`  catch-all       : ${discovery.catch_all}`);
  for (const rec of discovery.emails) {
    console.log(`  ${rec.email}`);
    console.log(`      origin=${rec.origin} conf=${rec.confidence} tier=${rec.verification.tier}`);
    console.log(`      verdict: ${rec.verification.label}`);
    console.log(`      evidence: ${rec.verification.evidence.join(" | ")}`);
    console.log(
      `      consent: ${rec.consent.basis} (outreach_ready=${rec.consent.outreach_ready})`,
    );
    for (const reason of rec.consent.reasons) console.log(`        - ${reason}`);
  }
  for (const rec of discovery.phones) {
    console.log(
      `  ${rec.e164} — ${rec.verification.label}${rec.attribution ? ` [${rec.attribution}]` : ""}`,
    );
  }
  console.log("  notes:");
  for (const n of discovery.notes) console.log(`      • ${n}`);
}

section("Result");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
