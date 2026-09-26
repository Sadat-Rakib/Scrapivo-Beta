// =====================================================================
// Deep contact harvest — the DISCOVERY layer
//
// Verification is commoditised; discovery is the product. This module is the
// half of the system that answers "how do we find the address at all", and it
// is deliberately the first tier of the waterfall because it is free, legally
// the cleanest (everything here was published by the company for the public,
// logged-out, no ToS accepted), and because ONE harvested address is what
// unlocks pattern derivation for the whole org.
//
// Sources, roughly in yield order:
//   1. /impressum, /imprint, /mentions-legales — legally MANDATED contact
//      details in DE/AT/EU. Near-100% hit rate when the page exists.
//   2. JSON-LD (schema.org Organization / LocalBusiness / Person) — the site
//      published it specifically so machines could read it. Zero ambiguity.
//   3. mailto: / tel: hrefs — people forget these are machine-readable.
//   4. /.well-known/security.txt (RFC 9116) — exists to be read by machines
//      and always carries a contact address.
//   5. DMARC DNS (rua=/ruf= tags) — literally an email address, one DNS query.
//   6. Contact/team/about/leadership/press pages found by following the site's
//      OWN links (more robust than guessing fixed paths).
//   7. Obfuscated addresses: [at]/(dot), HTML entities, and Cloudflare's
//      email-protection encoding, which is trivially reversible and hides a
//      surprising share of real addresses.
//
// Every hit is stamped with provenance (URL, timestamp, content hash, whether
// the page refused commercial email) because that record is the deliverable —
// see provenance.ts for why.
// =====================================================================
import { promises as dns } from "node:dns";
import { resilientText } from "../search/http-fetch.server";
import { condensePageText, validateFetchedPage, sleep } from "../search/fetch-gate.server";
import {
  extractSocialLinks,
  COMMON_NON_COMPANY,
  ROLE_LOCALPARTS,
  type SocialLinks,
} from "./contact-finder.server";
import {
  contentHash,
  detectAntiCemStatement,
  provenanceEntry,
  type ContactProvenance,
} from "./provenance";
import { normalizePhones, type ParsedPhone } from "./phone";
import { isCrawlAllowed, robotsCrawlDelayMs } from "./robots.server";
import { throwIfAborted } from "../search/search-run";

// ── types ───────────────────────────────────────────────────────────────────

export type PageCapture = {
  url: string;
  title: string;
  /** Condensed visible text — kept so the hash is reproducible. */
  text: string;
  hash: string;
  anti_cem: boolean | null;
  ok: boolean;
  reason?: string;
};

export type HarvestedEmail = {
  email: string;
  /** Person the address belongs to, when the page made that explicit. */
  name?: string;
  role_title?: string;
  /** True for info@/sales@ style inboxes — reachable, but not a person. */
  role_account: boolean;
  confidence: number;
  provenance: ContactProvenance;
};

export type HarvestedPhone = {
  raw: string;
  parsed: ParsedPhone;
  confidence: number;
  provenance: ContactProvenance;
};

export type HarvestedPerson = {
  name: string;
  role_title?: string;
  email?: string;
  profile_url?: string;
  source_url: string;
  /**
   * How the person was identified. JSON-LD is a declaration by the site;
   * page_text is a heuristic read of prose and is never trusted enough on its
   * own to generate an address from.
   */
  via: "json_ld" | "page_text";
};

export type MailProvider =
  | "google_workspace"
  | "microsoft365"
  | "zoho"
  | "proton"
  | "fastmail"
  | "yandex"
  | "mimecast"
  | "cloudflare"
  | "self_hosted"
  | "none"
  | "unknown";

export type DomainHarvest = {
  domain: string;
  emails: HarvestedEmail[];
  phones: HarvestedPhone[];
  people: HarvestedPerson[];
  socials: SocialLinks;
  pages: PageCapture[];
  mx_provider: MailProvider;
  mx_hosts: string[];
  /** Any harvested page carried a refusal of commercial email. */
  anti_cem_found: boolean;
  /** ISO-2 country from structured data — feeds phone parsing. */
  country_hint?: string;
  /** Pages robots.txt told us not to fetch (kept for the audit trail). */
  skipped_by_robots: string[];
};

// ── extraction primitives ───────────────────────────────────────────────────

const MAILTO_RE = /mailto:([a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const TEL_RE = /tel:(\+?[\d\s().-]{7,22})/gi;
const WHATSAPP_RE = /https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{8,15})/gi;
const PLAIN_EMAIL_RE = /\b[a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

/** Image/asset "domains" that look like emails after entity decoding. */
const NON_MAIL_TLD = /\.(png|jpe?g|gif|webp|svg|css|js|json|xml|pdf|ico|woff2?|mp4|webm)$/i;

/**
 * Cloudflare's email-obfuscation: the address is hex, XOR'd with the first
 * byte. It exists to stop naive scrapers, and decoding it is just reading a
 * documented encoding on a page the site served us — no access control is
 * being bypassed.
 */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]{6,}$/i.test(hex) || hex.length % 2 !== 0) return null;
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out) ? out.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Zero-width characters injected between letters to break naive scrapers.
// Built via `new RegExp` rather than a literal so the invisible code points
// never end up pasted into source.
const ZERO_WIDTH_RE = new RegExp("[\\u200b-\\u200f\\u2060\\ufeff]", "g");

/**
 * Reverse the ways humans hide addresses from regexes: [at]/(at)/ AT ,
 * [dot]/(dot)/ DOT , HTML entities, and zero-width characters injected between
 * characters. Written to be conservative — a false de-obfuscation produces a
 * fake address, which is worse than a miss.
 */
export function deobfuscateText(input: string): string {
  return (
    (input || "")
      .replace(ZERO_WIDTH_RE, "")
      .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/gi, "&")
      // "name [at] acme [dot] com" / "(AT)" / "{at}"
      .replace(/\s*[[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
      .replace(/\s*[[({<]\s*(?:dot|punkt|point)\s*[\])}>]\s*/gi, ".")
      // Bare " at " / " dot " only when the surrounding shape is already
      // address-like — otherwise ordinary prose turns into fake addresses.
      .replace(/([a-z0-9._%+-]{2,})\s+at\s+([a-z0-9-]{2,}(?:\s+dot\s+|\.)[a-z]{2,})/gi, "$1@$2")
      .replace(/([a-z0-9-]{2,})\s+dot\s+([a-z]{2,6})\b/gi, "$1.$2")
      .replace(/\s*\(\s*@\s*\)\s*/g, "@")
  );
}

type JsonLdContact = {
  emails: string[];
  phones: string[];
  socials: string[];
  people: Array<{ name: string; role_title?: string; email?: string; profile_url?: string }>;
  country?: string;
  org_name?: string;
};

/**
 * Pull contact data out of schema.org JSON-LD. This is the highest-quality
 * source on any page that has it: the site is publishing machine-readable
 * contact details on purpose, so there is no parsing ambiguity and no question
 * about whether it was meant to be public.
 */
export function extractJsonLdContacts(html: string): JsonLdContact {
  const out: JsonLdContact = { emails: [], phones: [], socials: [], people: [] };
  const blocks = [
    ...(html || "").matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];

  const visit = (node: unknown, depth = 0): void => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const type = String(o["@type"] ?? "");

    const email = typeof o.email === "string" ? o.email.replace(/^mailto:/i, "").trim() : "";
    const phone = typeof o.telephone === "string" ? o.telephone.trim() : "";
    if (email) out.emails.push(email.toLowerCase());
    if (phone) out.phones.push(phone);

    if (Array.isArray(o.sameAs)) {
      for (const s of o.sameAs) if (typeof s === "string") out.socials.push(s);
    } else if (typeof o.sameAs === "string") {
      out.socials.push(o.sameAs);
    }

    const address = o.address as Record<string, unknown> | undefined;
    if (address && typeof address === "object") {
      const c = address.addressCountry;
      if (typeof c === "string" && c.length <= 3) out.country = c.toUpperCase();
      else if (c && typeof c === "object") {
        const nm = (c as Record<string, unknown>).name;
        if (typeof nm === "string" && nm.length <= 3) out.country = nm.toUpperCase();
      }
    }

    if (/Organization|LocalBusiness|Corporation|NGO/i.test(type) && typeof o.name === "string") {
      out.org_name = out.org_name || o.name;
    }

    if (/Person/i.test(type) && typeof o.name === "string" && o.name.trim().length > 2) {
      const url = typeof o.url === "string" ? o.url : undefined;
      const sameAsProfile = out.socials.find((s) => /linkedin\.com\/in\//i.test(s));
      out.people.push({
        name: o.name.trim(),
        role_title: typeof o.jobTitle === "string" ? o.jobTitle : undefined,
        email: email || undefined,
        profile_url: url || sameAsProfile,
      });
    }

    for (const key of [
      "contactPoint",
      "contactPoints",
      "employee",
      "employees",
      "founder",
      "founders",
      "member",
      "author",
      "publisher",
      "@graph",
      "mainEntity",
      "itemListElement",
    ]) {
      if (key in o) visit(o[key], depth + 1);
    }
  };

  for (const block of blocks) {
    const raw = block[1].trim();
    if (!raw) continue;
    try {
      visit(JSON.parse(raw));
    } catch {
      // Some CMSs emit JSON-LD with trailing commas or HTML comments. One
      // tolerant retry, then give up — malformed JSON is not worth a parser.
      try {
        visit(JSON.parse(raw.replace(/<!--[\s\S]*?-->/g, "").replace(/,\s*([}\]])/g, "$1")));
      } catch {
        /* skip this block */
      }
    }
  }

  out.emails = [...new Set(out.emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))];
  return out;
}

// ── contact-page discovery ──────────────────────────────────────────────────

/** Path/anchor words that mark a page worth harvesting, with a yield weight. */
const CONTACT_PAGE_HINTS: Array<{ re: RegExp; weight: number }> = [
  // Legally mandated contact pages — the single highest-yield target.
  { re: /impressum|imprint|mentions?-?legales|legal-?notice|aviso-?legal/i, weight: 10 },
  { re: /\bcontact(?:-?us)?\b|kontakt|contactez|contacto|nous-?joindre/i, weight: 9 },
  { re: /\b(?:our-?)?team\b|leadership|management|our-?people|staff|founders?/i, weight: 8 },
  { re: /\babout(?:-?us)?\b|company|who-?we-?are|quienes-?somos/i, weight: 6 },
  { re: /\bpress\b|media-?(?:kit|contact|room)|newsroom/i, weight: 6 },
  { re: /support|help-?(?:center|desk)|customer-?service/i, weight: 4 },
  { re: /privacy(?:-?policy)?|datenschutz|dpo|data-?protection/i, weight: 3 },
  { re: /careers?|jobs?|hiring|join-?us/i, weight: 2 },
];

/** Pages that waste a fetch: assets, feeds, endless blog archives, legal boilerplate. */
const SKIP_PATH_RE =
  /\.(png|jpe?g|gif|webp|svg|css|js|pdf|zip|mp4|xml|ico)(\?|$)|\/(?:blog|news|posts?|tag|category|archive|search|cart|checkout|login|signin|signup|account|wp-admin|cdn-cgi)\//i;

/**
 * Rank internal links by how likely they are to carry contact details. Following
 * the site's own navigation beats guessing fixed paths — CMSs put contact pages
 * at /kontakt, /pages/contact, /en/company/contact-us, and a fixed list misses
 * all three.
 */
export function discoverContactPages(html: string, baseUrl: string, limit = 6): string[] {
  const scored = new Map<string, number>();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  for (const m of (html || "").matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi,
  )) {
    const href = m[1].trim();
    const anchorText = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    // Same registrable site only — we are harvesting THIS company, not the web.
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    if (SKIP_PATH_RE.test(url.pathname)) continue;
    if (url.pathname.split("/").filter(Boolean).length > 4) continue;

    const haystack = `${url.pathname} ${anchorText}`;
    const hint = CONTACT_PAGE_HINTS.find((h) => h.re.test(haystack));
    if (!hint) continue;

    url.hash = "";
    const clean = url.toString().replace(/\/$/, "");
    scored.set(clean, Math.max(scored.get(clean) ?? 0, hint.weight));
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([u]) => u);
}

// ── DNS-based sources ───────────────────────────────────────────────────────

const MX_PROVIDER_RULES: Array<{ re: RegExp; provider: MailProvider }> = [
  { re: /google\.com|googlemail\.com|aspmx/i, provider: "google_workspace" },
  { re: /outlook\.com|protection\.outlook|office365|microsoft/i, provider: "microsoft365" },
  { re: /zoho/i, provider: "zoho" },
  { re: /protonmail|proton\.me/i, provider: "proton" },
  { re: /messagingengine|fastmail/i, provider: "fastmail" },
  { re: /yandex/i, provider: "yandex" },
  { re: /mimecast/i, provider: "mimecast" },
  { re: /cloudflare/i, provider: "cloudflare" },
];

/**
 * Which mail provider handles the domain. This matters for verification, not
 * for curiosity: Google Workspace accepts RCPT for unknown users on many
 * tenants (so an SMTP "yes" means much less), Microsoft 365 rate-limits and
 * tarpits probes, and self-hosted Postfix usually answers honestly. Scoring
 * without knowing the provider is how tools end up confidently wrong.
 */
export async function detectMailProvider(
  domain: string,
): Promise<{ provider: MailProvider; hosts: string[] }> {
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx?.length) return { provider: "none", hosts: [] };
    const hosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase());
    const joined = hosts.join(" ");
    const rule = MX_PROVIDER_RULES.find((r) => r.re.test(joined));
    return { provider: rule?.provider ?? "self_hosted", hosts: hosts.slice(0, 4) };
  } catch {
    return { provider: "none", hosts: [] };
  }
}

/**
 * DMARC reporting addresses. The rua=/ruf= tags in a domain's _dmarc TXT record
 * literally contain email addresses, published in DNS for anyone to read. They
 * are usually security/ops inboxes rather than buyers, but they are free, they
 * are certain, and — critically — they reveal the domain's local-part style
 * when self-hosted (dmarc-reports@ vs dmarc.reports@).
 */
export async function dmarcContacts(domain: string): Promise<HarvestedEmail[]> {
  // DMARC rua/ruf are abuse/compliance mailboxes — NOT outreach contacts.
  // Harvesting them polluted the UI as "Published" emails and blocked Hunter.
  // Kept as a no-op for call-site compatibility; compliance can use DNS elsewhere.
  void domain;
  return [];
}

/**
 * RFC 9116 security.txt. It exists specifically so machines can find a contact
 * address, which makes it both the cleanest possible harvest and a reliable
 * signal that the org has a real security/ops function.
 */
export async function securityTxtContacts(domain: string, signal?: AbortSignal): Promise<HarvestedEmail[]> {
  const urls = [`https://${domain}/.well-known/security.txt`, `https://${domain}/security.txt`];
  for (const url of urls) {
    throwIfAborted(signal);
    try {
      const body = await resilientText(url, { retries: 0, signal });
      throwIfAborted(signal);
      if (!body || /<html/i.test(body.slice(0, 400)) || !/contact\s*:/i.test(body)) continue;
      const out: HarvestedEmail[] = [];
      for (const m of body.matchAll(/^contact\s*:\s*(.+)$/gim)) {
        const value = m[1].trim();
        const email = value
          .replace(/^mailto:/i, "")
          .trim()
          .toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue;
        out.push({
          email,
          role_account: ROLE_LOCALPARTS.has(email.split("@")[0]),
          confidence: 0.75,
          provenance: provenanceEntry("structured_data", {
            source_url: url,
            locator: "security.txt:Contact",
            publisher: domain,
            content_hash: contentHash(body),
            // security.txt is a machine-readable file with no prose to assess.
            anti_cem_statement: null,
            note: "RFC 9116 security.txt contact",
          }),
        });
      }
      if (out.length) return out.slice(0, 3);
    } catch {
      /* try next */
    }
  }
  return [];
}

// ── page harvest ────────────────────────────────────────────────────────────

type PageHarvest = {
  capture: PageCapture;
  emails: HarvestedEmail[];
  phones: string[];
  socials: SocialLinks;
  people: HarvestedPerson[];
  country?: string;
  /** Raw HTML, reused for link discovery so the homepage isn't fetched twice. */
  html: string;
};

/**
 * Titles/roles that sit next to a name on a team page. Used to attach a role to
 * a person, which CASL needs (the message must be relevant to their function)
 * and which pattern inference needs (to know whose address we found).
 */
const ROLE_TITLE_RE =
  /\b(?:chief\s+[\w]+\s+officer|c[eftoi]o|cto|coo|cfo|cmo|cpo|co-?founder|founder|owner|president|managing\s+partner|principal|director\s+of\s+[\w\s]{2,24}|director|head\s+of\s+[\w\s]{2,24}|vp\s+of\s+[\w\s]{2,24}|vice\s+president|engineering\s+manager|product\s+manager|account\s+executive|talent\s+\w+|sales\s+\w+|recruiter|marketer|engineer|developer|designer)\b/i;

/** A capitalised two-to-three token name, as it appears on a team page. */
const PERSON_NAME_RE = /\b([A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20}){1,2})\b/g;

/**
 * Words that disqualify a Title Case phrase from being a person's name.
 *
 * Without this, a marketing page turns "Agentic Infrastructure", "Bot
 * Management Skip", and "About Us" into "people" — and then the derivation
 * layer confidently produces agentic.infrastructure@company.com. A junk name
 * is worse than no name: it manufactures a contact that never existed.
 */
const NOT_A_NAME_TOKEN = new Set([
  // nav & page furniture
  "about",
  "us",
  "home",
  "contact",
  "team",
  "careers",
  "jobs",
  "blog",
  "news",
  "press",
  "docs",
  "documentation",
  "support",
  "help",
  "login",
  "signup",
  "sign",
  "menu",
  "skip",
  "more",
  "read",
  "learn",
  "get",
  "start",
  "started",
  "join",
  "explore",
  "view",
  "see",
  "all",
  "back",
  "next",
  "previous",
  "close",
  "open",
  "privacy",
  "policy",
  "terms",
  "cookie",
  "cookies",
  "rights",
  "reserved",
  "legal",
  // product & marketing nouns
  "product",
  "products",
  "platform",
  "solution",
  "solutions",
  "service",
  "services",
  "pricing",
  "enterprise",
  "business",
  "company",
  "customer",
  "customers",
  "partner",
  "partners",
  "agent",
  "agents",
  "agentic",
  "infrastructure",
  "stack",
  "cloud",
  "management",
  "analytics",
  "security",
  "compliance",
  "integration",
  "integrations",
  "api",
  "sdk",
  "app",
  "apps",
  "web",
  "data",
  "ai",
  "ml",
  "automation",
  "workflow",
  "deploy",
  "deploying",
  "deployment",
  "build",
  "builds",
  "runtime",
  "container",
  "containers",
  "function",
  "functions",
  "plugin",
  "plugins",
  "framework",
  "template",
  "templates",
  "dashboard",
  "console",
  "studio",
  "editor",
  "preview",
  "beta",
  "milestone",
  "changelog",
  "update",
  "updates",
  "release",
  "releases",
  "feature",
  "features",
  "guide",
  "guides",
  "tutorial",
  "example",
  "examples",
  "demo",
  // generic verbs/adjectives that show up capitalised in headings
  "new",
  "free",
  "best",
  "fast",
  "faster",
  "secure",
  "smart",
  "simple",
  "modern",
  "run",
  "running",
  "select",
  "check",
  "talk",
  "watch",
  "listen",
  "download",
  "conversation",
  "episode",
  "webinar",
  "event",
  "events",
  "summit",
  "conference",
  "former",
  "current",
  "previously",
  "now",
  "today",
  "yesterday",
  "week",
  "month",
  // org-name words — investor and portfolio lists are full of these, and
  // "First Round Capital" is a fund, not a person we can email.
  "capital",
  "ventures",
  "venture",
  "partners",
  "labs",
  "group",
  "fund",
  "funds",
  "holdings",
  "media",
  "systems",
  "technologies",
  "solutions",
  "index",
  "round",
  "collective",
  "foundation",
  "institute",
  "association",
  "council",
  "society",
  "production",
  "studios",
  "network",
  "networks",
  "inc",
  "llc",
  "ltd",
  "corp",
  "gmbh",
  // role words — stripped from the name, not treated as part of it
  "ceo",
  "cto",
  "coo",
  "cfo",
  "cmo",
  "founder",
  "cofounder",
  "president",
  "owner",
  "director",
  "manager",
  "engineer",
  "developer",
  "designer",
  "lead",
  "head",
  "vp",
]);

/** Role words that may trail a name in scraped text ("Sahil Lavingia Founder"). */
const TRAILING_ROLE_TOKEN =
  /^(ceo|cto|coo|cfo|cmo|cpo|chief|officer|executive|chair(?:man|woman|person)?|evp|svp|avp|founder|cofounder|co-founder|creator|author|president|owner|director|manager|engineer|developer|designer|lead|head|vp|partner|principal|senior|staff|former|current)$/i;

/**
 * Lowercase connectors that mean the capitalised word after them is a COMPANY,
 * not a first name: "…Creator of React, Naval Ravikant…" would otherwise be
 * read as a person called "React Naval Ravikant".
 */
const COMPANY_CONNECTOR_RE = /\b(?:of|at|from|for|by|with|joined|via|acquired)\s+$/i;

function looksLikeAsset(email: string): boolean {
  return NON_MAIL_TLD.test(email) || /^[0-9a-f]{16,}@/i.test(email) || email.includes("..");
}

/** Consumer mailbox providers. Small businesses and solo founders really do
 *  publish these as their business address, so they are kept — just discounted,
 *  because they're also the most common false positive in page text. */
const PERSONAL_MAILBOX = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "web.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
]);

/** Vendor/platform/placeholder domains that are never the company's own inbox. */
const VENDOR_EMAIL_DOMAIN =
  /\b(sentry|wixpress|godaddy|squarespace|shopify|hubspot|mailchimp|sendgrid|mailgun|cloudflare|wordpress|jsdelivr|gravatar|schema|w3|example|domain|yourdomain|yoursite|company|email|test|localhost)\b/i;

export type EmailOrigin = "own" | "personal" | "foreign";

/**
 * Whose inbox is this? Addresses on the company's own domain are what we want;
 * a consumer mailbox published on the company's contact page is still a real
 * lead; anything else is a vendor's address that happens to sit in the markup.
 */
export function classifyEmailDomain(email: string, domain: string): EmailOrigin {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (!d || !/\.[a-z]{2,}$/i.test(d)) return "foreign";
  if (d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`)) return "own";
  if (PERSONAL_MAILBOX.has(d)) return "personal";
  if (COMMON_NON_COMPANY.has(d) || VENDOR_EMAIL_DOMAIN.test(d)) return "foreign";
  return "foreign";
}

/**
 * Pull people (name + title, and the address sitting next to them) out of a
 * team/leadership page. This is the highest-value harvest there is: names,
 * titles, and emails together let us infer the org pattern AND satisfy the
 * CASL relevance condition in one pass.
 */
/**
 * Trim trailing role words off a scraped name and reject anything that isn't
 * plausibly a person.
 *
 * `trimmed` is how many characters were cut from the end, so the caller can
 * start its role-title window where the name actually stopped — otherwise
 * "Jane Smith Chief" swallows the "Chief" and the title lookup starts at
 * "Technology Officer", which matches nothing.
 */
function cleanCandidateName(
  raw: string,
  opts: { afterConnector?: boolean; brandTokens?: Set<string> } = {},
): { name: string; trimmed: number } | null {
  const tokens = raw.trim().split(/\s+/);
  // "…Creator of React Naval Ravikant" → the first token is the company.
  // Front removal doesn't change where the name ENDS, so it isn't counted.
  if (opts.afterConnector && tokens.length === 3) tokens.shift();

  let trimmed = 0;
  const popEnd = () => {
    const t = tokens.pop();
    if (t) trimmed += t.length + 1; // +1 for the space that preceded it
  };
  // "Guillermo Rauch Vercel" — the company's own brand trailing a name.
  while (tokens.length > 2 && opts.brandTokens?.has(tokens[tokens.length - 1].toLowerCase())) {
    popEnd();
  }
  // "Sahil Lavingia Founder" → "Sahil Lavingia", and "James Hawkins Co-Founder"
  // → "James Hawkins" (the name regex stops at the capital F, leaving "Co-").
  while (
    tokens.length > 2 &&
    (TRAILING_ROLE_TOKEN.test(tokens[tokens.length - 1]) || /-$/.test(tokens[tokens.length - 1]))
  ) {
    popEnd();
  }

  if (tokens.length < 2 || tokens.length > 3) return null;
  if (tokens.some((t) => NOT_A_NAME_TOKEN.has(t.toLowerCase()))) return null;
  // Initials-only or single-letter tokens are page furniture, not names.
  if (tokens.some((t) => t.replace(/[^A-Za-z]/g, "").length < 2)) return null;
  return { name: tokens.join(" "), trimmed };
}

export function extractPeopleFromText(
  text: string,
  sourceUrl: string,
  /** Brand tokens from the company's own name/domain, stripped off names. */
  brandTokens?: Set<string>,
): HarvestedPerson[] {
  const people: HarvestedPerson[] = [];
  const seen = new Set<string>();

  // Proximity, not chunking. condensePageText collapses all whitespace, so a
  // marketing page is effectively one giant "sentence" — splitting on
  // punctuation gave windows big enough for any role word to match any name.
  // Index-based neighbourhoods are the only reliable adjacency signal left.
  PERSON_NAME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PERSON_NAME_RE.exec(text)) !== null) {
    if (people.length >= 12) break;
    const cleaned = cleanCandidateName(match[1], {
      afterConnector: COMPANY_CONNECTOR_RE.test(
        text.slice(Math.max(0, match.index - 12), match.index),
      ),
      brandTokens,
    });
    if (!cleaned) continue;
    const { name, trimmed } = cleaned;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    const start = match.index;
    const end = start + match[1].length;
    // Team pages read "Name — Title"; bios read "Title Name". Look both ways,
    // but only a short distance. The window starts where the NAME ended, not
    // where the regex match ended, so a trimmed "Chief" is back in scope.
    const after = text.slice(end - trimmed, end - trimmed + 60);
    const before = text.slice(Math.max(0, start - 40), start);
    const roleMatch = ROLE_TITLE_RE.exec(after) ?? ROLE_TITLE_RE.exec(before);

    // An address counts as evidence only if it's right next to the name.
    const nearby = text.slice(Math.max(0, start - 80), end + 120);
    const emailMatch = nearby.match(PLAIN_EMAIL_RE);

    if (!roleMatch && !emailMatch) continue;

    seen.add(key);
    people.push({
      name,
      role_title: roleMatch?.[0]?.replace(/\s+/g, " ").trim(),
      email: emailMatch?.[0]?.toLowerCase(),
      source_url: sourceUrl,
      via: "page_text",
    });
  }
  return people;
}

/** Fetch one page and extract everything contact-shaped from it. */
async function harvestPage(
  url: string,
  domain: string,
  relevanceTokens?: string[],
  signal?: AbortSignal,
): Promise<PageHarvest | null> {
  throwIfAborted(signal);
  const html = await resilientText(url, { retries: 1, signal }).catch(() => "");
  throwIfAborted(signal);
  if (!html) return null;

  const title = (html.match(/<title[^>]*>([^<]+)/i)?.[1] || "").trim();
  const text = condensePageText(html, 20_000);
  const gate = validateFetchedPage({
    url,
    status: 200,
    title,
    text,
    relevanceTokens,
    minTextLength: 60,
  });

  const anti_cem = detectAntiCemStatement(text);
  const capture: PageCapture = {
    url,
    title,
    text: text.slice(0, 4000),
    hash: contentHash(text),
    anti_cem,
    ok: gate.ok,
    reason: gate.reason,
  };
  if (!gate.ok) return { capture, emails: [], phones: [], socials: {}, people: [], html };

  const deobfuscated = deobfuscateText(`${html}\n${text}`);
  const emails = new Map<string, HarvestedEmail>();
  const phones: string[] = [];

  const addEmail = (
    raw: string,
    locator: string,
    confidence: number,
    extra: Partial<HarvestedEmail> = {},
  ) => {
    const email = raw
      .trim()
      .toLowerCase()
      .replace(/^mailto:/, "")
      .replace(/[.,;:]+$/, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return;
    if (looksLikeAsset(email)) return;
    const origin = classifyEmailDomain(email, domain);
    if (origin === "foreign") return;
    const score = origin === "personal" ? confidence * 0.75 : confidence;
    const local = email.split("@")[0];
    const existing = emails.get(email);
    if (existing && existing.confidence >= score) return;
    emails.set(email, {
      email,
      role_account: ROLE_LOCALPARTS.has(local),
      confidence: Number(score.toFixed(2)),
      provenance: provenanceEntry("harvested", {
        source_url: url,
        locator,
        publisher: domain,
        content_hash: capture.hash,
        anti_cem_statement: anti_cem,
        note:
          origin === "personal"
            ? "Consumer mailbox published on the company's own page"
            : undefined,
      }),
      ...extra,
    });
  };

  // 1) Cloudflare-obfuscated addresses (highest confidence: an explicit mailto
  //    that the site chose to protect, so it is definitely a live inbox).
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const decoded = decodeCloudflareEmail(m[1]);
    if (decoded) addEmail(decoded, "cloudflare:data-cfemail", 0.8);
  }
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const decoded = decodeCloudflareEmail(m[1]);
    if (decoded) addEmail(decoded, "cloudflare:email-protection", 0.8);
  }

  // 2) mailto: — explicit, unambiguous, published for contact.
  for (const m of deobfuscated.matchAll(MAILTO_RE)) addEmail(m[1], "mailto:", 0.85);

  // 3) JSON-LD — machine-readable by the site's own choice.
  const jsonLd = extractJsonLdContacts(html);
  for (const e of jsonLd.emails) addEmail(e, "json-ld:email", 0.85);
  for (const p of jsonLd.phones) phones.push(p);
  for (const person of jsonLd.people) {
    if (person.email) {
      addEmail(person.email, "json-ld:Person.email", 0.9, {
        name: person.name,
        role_title: person.role_title,
      });
    }
  }

  // 4) Visible-text addresses (after de-obfuscation). Lower confidence: text
  //    scraping picks up example addresses and other people's addresses.
  for (const m of deobfuscateText(text).matchAll(PLAIN_EMAIL_RE)) {
    addEmail(m[0], "page-text", 0.6);
  }

  // 5) Phones: tel: hrefs and WhatsApp links are explicit; free-text numbers
  //    are left to the phone parser to accept or reject.
  for (const m of html.matchAll(TEL_RE)) phones.push(m[1]);
  for (const m of html.matchAll(WHATSAPP_RE)) phones.push(`+${m[1].replace(/\D/g, "")}`);
  for (const m of text.matchAll(
    /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,5}\b/g,
  )) {
    phones.push(m[0]);
  }

  // 6) People — names + titles, and any address adjacent to them.
  // The company's own brand shows up right after names in bios ("Guillermo
  // Rauch, Vercel") — strip it so it doesn't become part of the surname.
  const brandTokens = new Set(
    domain
      .split(".")
      .slice(0, -1)
      .flatMap((part) => part.split(/[-_]/))
      .filter((t) => t.length > 2),
  );
  const people = extractPeopleFromText(text, url, brandTokens);
  for (const p of jsonLd.people) {
    const existing = people.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (existing) {
      // A JSON-LD declaration outranks the prose heuristic for the same person.
      existing.via = "json_ld";
      existing.role_title = p.role_title ?? existing.role_title;
      existing.email = p.email ?? existing.email;
      existing.profile_url = p.profile_url ?? existing.profile_url;
    } else {
      people.push({ ...p, source_url: url, via: "json_ld" });
    }
  }
  // Attach person names to addresses that clearly belong to them — this is
  // what makes pattern inference possible.
  for (const person of people) {
    if (!person.email) continue;
    const hit = emails.get(person.email);
    if (!hit || hit.name) continue;
    // NEVER attach a person to a shared inbox. An impressum lists the managing
    // directors right next to info@, and claiming info@ "belongs to" one of them
    // would both mislead the user and poison pattern inference — the org would
    // look like it uses `first`-only addresses.
    if (hit.role_account) continue;
    hit.name = person.name;
    hit.role_title = person.role_title;
    hit.confidence = Math.max(hit.confidence, 0.85);
  }

  const socials = extractSocialLinks(html + "\n" + jsonLd.socials.join("\n"), {});

  return {
    capture,
    emails: [...emails.values()],
    phones,
    socials,
    people,
    country: jsonLd.country,
    html,
  };
}

// ── orchestrator ────────────────────────────────────────────────────────────

/** Fixed paths tried when the homepage's own links don't reveal a contact page. */
const FALLBACK_PATHS = [
  "/contact",
  "/contact-us",
  "/impressum",
  "/about",
  "/about-us",
  "/team",
  "/kontakt",
];

export type HarvestOptions = {
  signal?: AbortSignal;
  /** Company-name tokens used to reject a homepage that isn't this company. */
  companyTokens?: string[];
  /** Max pages to fetch (each is a network round-trip). */
  maxPages?: number;
  /** Skip the robots.txt check. Only for domains the user explicitly owns. */
  ignoreRobots?: boolean;
};

/**
 * Harvest every published contact detail for a domain.
 *
 * Order is deliberate: homepage first (it names the contact pages and confirms
 * the domain is the right company), then DNS sources in parallel (free and
 * instant), then the highest-scoring contact pages. We stop early once we have
 * a named, non-role address — at that point pattern derivation can take over
 * and more fetches buy little.
 */
export async function harvestDomainContacts(
  rawDomain: string,
  opts: HarvestOptions = {},
): Promise<DomainHarvest> {
  throwIfAborted(opts.signal);
  const domain = (rawDomain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

  const result: DomainHarvest = {
    domain,
    emails: [],
    phones: [],
    people: [],
    socials: {},
    pages: [],
    mx_provider: "unknown",
    mx_hosts: [],
    anti_cem_found: false,
    skipped_by_robots: [],
  };
  if (!domain || !domain.includes(".")) return result;

  const maxPages = Math.max(1, opts.maxPages ?? 6);
  const emailsByAddress = new Map<string, HarvestedEmail>();
  const rawPhones: Array<{ raw: string; source: string; hash?: string; antiCem: boolean | null }> =
    [];

  const mergeEmail = (e: HarvestedEmail) => {
    const existing = emailsByAddress.get(e.email);
    if (!existing) {
      emailsByAddress.set(e.email, e);
      return;
    }
    // Keep the better-evidenced version, but never lose a name we learned.
    if (e.confidence > existing.confidence) {
      emailsByAddress.set(e.email, {
        ...e,
        name: e.name ?? existing.name,
        role_title: e.role_title ?? existing.role_title,
      });
    } else if (!existing.name && e.name) {
      existing.name = e.name;
      existing.role_title = existing.role_title ?? e.role_title;
    }
  };

  // DNS + well-known sources run in parallel with the homepage fetch — they're
  // independent, free, and never rate-limited.
  const [mx, dmarc, securityTxt, homeAllowed, crawlDelayMs] = await Promise.all([
    detectMailProvider(domain),
    dmarcContacts(domain),
    securityTxtContacts(domain, opts.signal),
    opts.ignoreRobots
      ? Promise.resolve({ allowed: true, crawlDelayMs: 0, reason: "skipped" })
      : isCrawlAllowed(`https://${domain}/`),
    opts.ignoreRobots ? Promise.resolve(0) : robotsCrawlDelayMs(domain),
  ]);
  throwIfAborted(opts.signal);

  result.mx_provider = mx.provider;
  result.mx_hosts = mx.hosts;
  // security.txt contacts are role/ops inboxes — merge only as low-priority
  // role_account; never let them be the sole "has email" that blocks Hunter.
  for (const e of securityTxt) {
    mergeEmail({ ...e, confidence: Math.min(e.confidence, 0.35), role_account: true });
  }
  void dmarc; // DMARC intentionally not merged into outreach emails.

  if (!homeAllowed.allowed) {
    // The site told us not to crawl. DNS/well-known results stand; we do not
    // route around a stated limit — that's the line that turns a lawful scrape
    // into a §1201 argument.
    result.skipped_by_robots.push(`https://${domain}/ (${homeAllowed.reason})`);
    result.emails = [...emailsByAddress.values()].sort((a, b) => b.confidence - a.confidence);
    return result;
  }

  const politeDelay = Math.max(crawlDelayMs, 250);
  const visited = new Set<string>();
  const queue: string[] = [`https://${domain}/`];
  let fetched = 0;
  let homeHtmlChecked = false;

  while (queue.length && fetched < maxPages) {
    throwIfAborted(opts.signal);
    const url = queue.shift()!;
    const key = url.replace(/\/$/, "");
    if (visited.has(key)) continue;
    visited.add(key);

    if (!opts.ignoreRobots) {
      const decision = await isCrawlAllowed(url);
      throwIfAborted(opts.signal);
      if (!decision.allowed) {
        result.skipped_by_robots.push(`${url} (${decision.reason})`);
        continue;
      }
    }

    // Only the homepage is relevance-checked against the company name; deeper
    // pages (an /impressum, a /security.txt) legitimately may not repeat it.
    const page = await harvestPage(url, domain, !homeHtmlChecked ? opts.companyTokens : undefined, opts.signal);
    fetched++;
    if (!page) continue;
    result.pages.push(page.capture);
    if (page.capture.anti_cem === true) result.anti_cem_found = true;

    if (!homeHtmlChecked) {
      homeHtmlChecked = true;
      // Follow the site's own links to its contact pages; fall back to fixed
      // paths only when the navigation gave us nothing. This runs even if the
      // homepage itself failed the gate — a splash page with no text still
      // links to /contact, and that page is the one we actually want.
      const discovered = discoverContactPages(page.html, url, maxPages);
      const targets = discovered.length
        ? discovered
        : FALLBACK_PATHS.map((p) => `https://${domain}${p}`);
      for (const t of targets) if (!visited.has(t.replace(/\/$/, ""))) queue.push(t);
    }

    if (!page.capture.ok) {
      if (queue.length && fetched < maxPages) await sleep(politeDelay);
      continue;
    }

    for (const e of page.emails) mergeEmail(e);
    for (const raw of page.phones) {
      rawPhones.push({ raw, source: url, hash: page.capture.hash, antiCem: page.capture.anti_cem });
    }
    result.socials = { ...page.socials, ...result.socials };
    result.country_hint = result.country_hint ?? page.country;
    for (const person of page.people) {
      if (!result.people.some((p) => p.name.toLowerCase() === person.name.toLowerCase())) {
        result.people.push(person);
      }
    }

    // Stop once we have a named individual address — pattern derivation takes
    // it from here and further fetches mostly return the same info@.
    const haveNamed = [...emailsByAddress.values()].some((e) => !e.role_account && e.name);
    if (haveNamed && fetched >= 2) break;

    if (queue.length && fetched < maxPages) await sleep(politeDelay);
  }

  result.emails = [...emailsByAddress.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  // Phones: normalise, dedupe by E.164, and keep provenance for each survivor.
  const parsed = normalizePhones(
    rawPhones.map((p) => p.raw),
    { defaultCountry: result.country_hint },
  );
  result.phones = parsed.slice(0, 6).map((p) => {
    const origin =
      rawPhones.find((r) => r.raw.replace(/\D/g, "").endsWith(p.national.slice(-7))) ??
      rawPhones[0];
    return {
      raw: origin?.raw ?? p.e164 ?? "",
      parsed: p,
      confidence: p.confidence,
      provenance: provenanceEntry("harvested", {
        source_url: origin?.source,
        locator: "tel:/page-text",
        publisher: domain,
        content_hash: origin?.hash,
        anti_cem_statement: origin?.antiCem ?? null,
      }),
    };
  });

  return result;
}

/** Known addresses in the shape inferOrgPattern() expects. */
export function harvestToKnownAddresses(
  harvest: DomainHarvest,
): Array<{ email: string; name?: string }> {
  return harvest.emails.map((e) => ({ email: e.email, name: e.name }));
}
