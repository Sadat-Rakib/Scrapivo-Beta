// =====================================================================
// Contact resolution & cross-verification (Phase 3 + Task 1.2)
//
// This is the layer that turns "a company name in a post" into a verified
// contact. Everything here is FREE-FIRST and CORROBORATION-BASED: no single
// source is trusted on its own — confidence rises only when 2+ independent
// sources agree, which is the differentiator most cheap lead-gen tools skip.
//
//   • Task 1.2 — resolveCompanyDomain: guess {slug}.com/.io/.co, but VERIFY the
//     company name actually appears on the homepage before accepting it, so a
//     DNS-resolvable slug collision (someoneelse.com) is rejected. Falls back
//     to any domain already present in the post text.
//   • Task 3.1 — corroboration sources: Gravatar (email↔profile), RDAP/WHOIS
//     (domain registrant), OpenCorporates (named officers). Each is a signal,
//     not a verdict.
//   • Task 3.2 — free email-verification waterfall: syntax → disposable → MX →
//     (optional) SMTP RCPT + catch-all → role-account detection → confidence.
//     Paid ZeroBounce is only the LAST resort when the free waterfall is
//     inconclusive (matches the free-first/paid-fallback design elsewhere).
//   • Task 3.3 — mergeContactRecords: when the same person is found via
//     multiple sources, merge into ONE enriched record listing all corroborating
//     sources rather than overwriting whichever wrote first.
//
// Scope note (spec): full Splink-style probabilistic entity resolution is out
// of scope; this is threshold + corroboration. SMTP probing is gated behind
// SMTP_PROBE=true because most hosts block outbound port 25.
// =====================================================================
import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { resilientJson, resilientText } from "../search/http-fetch.server";
import { validateFetchedPage, condensePageText } from "../search/fetch-gate.server";

// ── shared types ────────────────────────────────────────────────────────────
export type ContactSourceKind =
  | "domain_guess"
  | "post_text"
  | "gravatar"
  | "rdap"
  | "opencorporates"
  | "team_page"
  | "github"
  | "manual"
  | "page_harvest"
  | "pattern_guess"
  | "hunter"
  | "pdl"
  | "coreclaw";

export type ContactSignal = {
  kind: ContactSourceKind;
  email?: string;
  phone?: string;
  name?: string;
  domain?: string;
  url?: string;
  confidence: number; // 0..1 for THIS single source
  note?: string;
};

export type ResolvedContact = {
  name?: string;
  email?: string;
  phone?: string;
  domain?: string;
  confidence: number; // merged 0..1
  corroborating_sources: ContactSignal[];
};

const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|srl|bv|plc|pty|pvt|llp|lp|ag)\b/gi;

function companySlug(company: string): string {
  return (company || "")
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function companyTokens(company: string): string[] {
  return (company || "")
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

// =====================================================================
// Task 1.2 — company domain resolution WITH verification
// =====================================================================
export type DomainResolution = {
  domain: string;
  verified: boolean;
  via: "verified_guess" | "post_text" | "unverified_guess";
};

const DOMAIN_IN_TEXT = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s)]*)?/gi;
export const COMMON_NON_COMPANY = new Set([
  "reddit.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "github.com",
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "medium.com",
  "youtube.com",
  "instagram.com",
  "bit.ly",
  "t.co",
  "google.com",
  "wikipedia.org",
]);

/** Extract candidate domains already present in the post text (highest trust). */
export function domainsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || "").matchAll(DOMAIN_IN_TEXT)) {
    const d = m[1].toLowerCase().replace(/\.$/, "");
    if (!COMMON_NON_COMPANY.has(d) && d.includes(".")) out.push(d);
  }
  return Array.from(new Set(out));
}

/** True if the fetched homepage actually belongs to the company (name appears). */
async function homepageMatchesCompany(domain: string, tokens: string[]): Promise<boolean> {
  if (!tokens.length) return false;
  for (const scheme of ["https://", "http://"]) {
    const html = await resilientText(`${scheme}${domain}`, { retries: 1 });
    if (!html) continue;
    const hay = html
      .slice(0, 60_000)
      .toLowerCase()
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ");
    // title + meta description + visible text all count.
    const matched = tokens.filter((t) => hay.includes(t));
    // Require the distinctive tokens to appear (all of them for 1-token names,
    // a majority for multi-token names) to avoid coincidental substring hits.
    const need = tokens.length === 1 ? 1 : Math.ceil(tokens.length * 0.6);
    if (matched.length >= need) return true;
    return false; // homepage fetched but company name absent → reject this domain
  }
  return false;
}

/**
 * Guess + verify a company's primary domain. Accepts a guessed {slug}.tld ONLY
 * if the homepage actually mentions the company; otherwise falls back to a
 * domain found in the post text; otherwise returns an unverified guess flagged
 * as such (never silently trusted).
 */
export async function resolveCompanyDomain(
  company: string,
  postText = "",
): Promise<DomainResolution | null> {
  // Already a domain ("acme.io")? Use it as-is — slugging would mangle it
  // into "acmeio" and produce garbage like "acmeio.com".
  const asDomain = (company || "")
    .trim()
    .toLowerCase()
    .match(/^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})\/?$/)?.[1];
  if (asDomain && !COMMON_NON_COMPANY.has(asDomain)) {
    return { domain: asDomain, verified: false, via: "post_text" };
  }

  const slug = companySlug(company);
  const tokens = companyTokens(company);
  if (!slug) {
    const fromText = domainsInText(postText)[0];
    return fromText ? { domain: fromText, verified: false, via: "post_text" } : null;
  }

  // 1) Verified guesses across common TLDs.
  const tlds = ["com", "io", "co", "ai", "dev", "app"];
  for (const tld of tlds) {
    const domain = `${slug}.${tld}`;
    try {
      if (await homepageMatchesCompany(domain, tokens)) {
        return { domain, verified: true, via: "verified_guess" };
      }
    } catch {
      /* try next tld */
    }
  }

  // 2) Fall back to a domain present in the post text (higher trust than a
  //    guess that failed verification).
  const fromText = domainsInText(postText)[0];
  if (fromText) return { domain: fromText, verified: false, via: "post_text" };

  // 3) Nothing verified — do NOT accept an unverified guess as truth. Return
  //    the .com guess flagged unverified so callers can decide (never merged
  //    into a "verified" contact).
  return { domain: `${slug}.com`, verified: false, via: "unverified_guess" };
}

// =====================================================================
// Task 3.2 — free email-verification waterfall
// =====================================================================
export type EmailVerification = {
  email: string;
  syntax_valid: boolean;
  disposable: boolean;
  mx_found: boolean;
  smtp_ok: boolean | null; // null = not probed (gated / skipped)
  catch_all: boolean | null; // null = unknown
  role_account: boolean; // info@/support@ vs a named individual
  confidence: number; // 0..1
  tier: "verified" | "probable" | "risky" | "invalid";
  method: string; // which stage produced the verdict
};

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
  "getnada.com",
  "temp-mail.org",
  "throwawaymail.com",
  "sharklasers.com",
  "maildrop.cc",
  "dispostable.com",
]);

export const ROLE_LOCALPARTS = new Set([
  "info",
  "support",
  "hello",
  "contact",
  "admin",
  "sales",
  "team",
  "office",
  "help",
  "billing",
  "careers",
  "jobs",
  "hr",
  "press",
  "media",
  "marketing",
  "noreply",
  "no-reply",
  "webmaster",
  "postmaster",
  "enquiries",
  "inquiries",
  "accounts",
  "accounting",
  "finance",
  "legal",
  "privacy",
  "security",
  "abuse",
  "dmarc",
  "hostmaster",
  "mail",
  "service",
  "customerservice",
  "partnerships",
]);

const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

async function hasMx(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length) return true;
  } catch {
    /* no MX */
  }
  // Some domains accept mail on the A record (implicit MX).
  try {
    const a = await dns.resolve(domain);
    return Array.isArray(a) && a.length > 0;
  } catch {
    return false;
  }
}

/**
 * Verify an email through the free waterfall. `named` = the local part is a
 * specific person (firstname.lastname) which scores higher than a role inbox.
 * ZeroBounce is consulted ONLY if inconclusive and ZEROBOUNCE_KEY is present.
 */
export async function verifyEmail(email: string): Promise<EmailVerification> {
  const e = (email || "").trim().toLowerCase();
  const base: EmailVerification = {
    email: e,
    syntax_valid: false,
    disposable: false,
    mx_found: false,
    smtp_ok: null,
    catch_all: null,
    role_account: false,
    confidence: 0,
    tier: "invalid",
    method: "syntax",
  };

  // 1) syntax
  if (!EMAIL_RE.test(e)) return base;
  base.syntax_valid = true;
  const [local, domain] = e.split("@");

  // 2) disposable
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ...base, disposable: true, tier: "invalid", confidence: 0.05, method: "disposable" };
  }

  // 3) role-account detection
  base.role_account = ROLE_LOCALPARTS.has(local) || (/^[a-z]+$/.test(local) && local.length <= 4);

  // 4) MX
  base.mx_found = await hasMx(domain);
  if (!base.mx_found) {
    return { ...base, tier: "invalid", confidence: 0.1, method: "mx" };
  }

  // 5) optional SMTP RCPT probe (gated — most hosts block port 25)
  if (process.env.SMTP_PROBE === "true") {
    const probe = await smtpProbe(domain, e).catch(() => null);
    base.smtp_ok = probe?.rcptOk ?? null;
    base.catch_all = probe?.catchAll ?? null;
    base.method = "smtp";
  }

  // 6) confidence from the free signals
  let conf = 0.5; // syntax + MX baseline
  if (base.smtp_ok === true && base.catch_all === false) conf = 0.9;
  else if (base.smtp_ok === true) conf = 0.7;
  else if (base.smtp_ok === false) conf = 0.15;
  // a specific-person local part is worth more than a role inbox
  if (!base.role_account && /[._]/.test(local)) conf = Math.min(1, conf + 0.1);
  if (base.role_account) conf = Math.min(conf, 0.45);

  let out: EmailVerification = {
    ...base,
    confidence: Number(conf.toFixed(2)),
    tier: conf >= 0.8 ? "verified" : conf >= 0.5 ? "probable" : "risky",
  };

  // 7) paid fallback ONLY when inconclusive
  const inconclusive = base.smtp_ok === null && out.tier !== "verified";
  if (inconclusive && process.env.ZEROBOUNCE_KEY) {
    const zb = await zeroBounce(e).catch(() => null);
    if (zb) out = { ...out, ...zb, method: "zerobounce" };
  }
  return out;
}

async function smtpProbe(
  domain: string,
  email: string,
): Promise<{ rcptOk: boolean; catchAll: boolean } | null> {
  const net = await import("node:net");
  const mx = await dns.resolveMx(domain).catch(() => []);
  const host = mx.sort((a, b) => a.priority - b.priority)[0]?.exchange;
  if (!host) return null;
  return new Promise((resolve) => {
    const socket = net.connect(25, host);
    let stage = 0;
    let rcptOk = false;
    const done = (v: { rcptOk: boolean; catchAll: boolean } | null) => {
      try {
        socket.destroy();
      } catch {}
      resolve(v);
    };
    socket.setTimeout(6000, () => done(null));
    socket.on("error", () => done(null));
    socket.on("data", (buf) => {
      const line = buf.toString();
      const code = parseInt(line.slice(0, 3), 10);
      if (stage === 0 && code === 220) {
        socket.write("HELO scrapivo.app\r\n");
        stage = 1;
      } else if (stage === 1) {
        socket.write("MAIL FROM:<probe@scrapivo.app>\r\n");
        stage = 2;
      } else if (stage === 2) {
        socket.write(`RCPT TO:<${email}>\r\n`);
        stage = 3;
      } else if (stage === 3) {
        rcptOk = code >= 200 && code < 300;
        socket.write(`RCPT TO:<nonexistent-${Date.now()}@${domain}>\r\n`);
        stage = 4;
      } else if (stage === 4) {
        const catchAll = code >= 200 && code < 300;
        socket.write("QUIT\r\n");
        done({ rcptOk, catchAll });
      }
    });
  });
}

async function zeroBounce(email: string): Promise<Partial<EmailVerification> | null> {
  const key = process.env.ZEROBOUNCE_KEY;
  if (!key) return null;
  try {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${key}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = (await res.json()) as { status?: string };
    const valid = d.status === "valid";
    return { smtp_ok: valid, confidence: valid ? 0.95 : 0.1, tier: valid ? "verified" : "invalid" };
  } catch {
    return null;
  }
}

// =====================================================================
// Task 3.1 — corroboration sources
// =====================================================================
/** Gravatar: an email tied to a public profile is a real, active address. */
export async function gravatarLookup(email: string): Promise<ContactSignal | null> {
  const e = (email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  const hash = createHash("md5").update(e).digest("hex");
  try {
    const res = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404`, { method: "GET" });
    if (res.ok) {
      return {
        kind: "gravatar",
        email: e,
        url: `https://gravatar.com/${hash}`,
        confidence: 0.7,
        note: "email tied to an active Gravatar profile",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** RDAP: domain registrant (often redacted under GDPR, handled gracefully). */
export async function rdapLookup(domain: string): Promise<ContactSignal | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json" },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    let name = "";
    for (const ent of d?.entities ?? []) {
      if ((ent.roles ?? []).includes("registrant")) {
        const vcard = ent.vcardArray?.[1] ?? [];
        for (const item of vcard) {
          if (item[0] === "fn" || item[0] === "org") {
            name = String(item[3] ?? "");
            break;
          }
        }
      }
    }
    if (!name || /redacted|privacy|whois/i.test(name)) {
      return { kind: "rdap", domain, confidence: 0.2, note: "registrant present but redacted" };
    }
    return { kind: "rdap", domain, name, confidence: 0.55, note: "domain registrant name" };
  } catch {
    return null;
  }
}

/** OpenCorporates Reconciliation API — primary legal-entity verify (no token). */
export type ReconcileMatch = {
  id: string;
  name: string;
  score: number;
  match: boolean;
  uri: string;
  jurisdiction?: string;
};

export async function reconcileCompany(
  company: string,
  jurisdictionCode?: string,
): Promise<ContactSignal | null> {
  const name = (company || "").trim();
  if (!name || name.length < 2) return null;
  const params = new URLSearchParams({
    query: JSON.stringify({
      query: name,
      limit: 3,
      ...(jurisdictionCode ? { jurisdiction_code: jurisdictionCode.toLowerCase() } : {}),
    }),
  });
  const path = jurisdictionCode
    ? `https://opencorporates.com/reconcile/${encodeURIComponent(jurisdictionCode.toLowerCase())}`
    : "https://opencorporates.com/reconcile";
  try {
    const res = await fetch(`${path}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Scrapivo/1.0 (lead verification; contact@scrapivo.app)",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return null;
    const d = (await res.json()) as { result?: ReconcileMatch[] };
    const best = (d.result ?? [])[0];
    if (!best?.name) return null;
    // Accept high-scoring or exact match; OC scores ~0–100
    if (!best.match && best.score < 60) return null;
    return {
      kind: "opencorporates",
      name: best.name,
      url: best.uri?.replace(/^http:/, "https:") || `https://opencorporates.com${best.id}`,
      confidence: best.match ? 0.85 : Math.min(0.8, 0.4 + best.score / 200),
      note: `Registry reconciled (score ${best.score}${jurisdictionCode ? `, ${jurisdictionCode}` : ""})`,
    };
  } catch {
    return null;
  }
}

/** OpenCorporates v0.4 company search (optional token). Prefer reconcileCompany first. */
export async function openCorporatesSearch(company: string): Promise<ContactSignal[]> {
  const out: ContactSignal[] = [];
  const q = encodeURIComponent(company);
  const key = process.env.OPENCORPORATES_KEY;
  const url = `https://api.opencorporates.com/v0.4/companies/search?q=${q}${key ? `&api_token=${key}` : ""}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return out;
    const d = (await res.json()) as any;
    const companies = d?.results?.companies ?? [];
    const wanted = companyTokens(company);
    for (const c of companies.slice(0, 5)) {
      const co = c.company;
      if (!co?.name) continue;
      const nameTokens = companyTokens(co.name);
      const overlap = wanted.filter((t) => nameTokens.includes(t)).length;
      if (overlap === 0) continue;
      out.push({
        kind: "opencorporates",
        name: co.name,
        url: co.opencorporates_url,
        confidence: overlap >= Math.max(1, Math.ceil(wanted.length * 0.6)) ? 0.5 : 0.3,
        note: `registry match: ${co.name} (${co.jurisdiction_code ?? "?"})`,
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

// =====================================================================
// Task 3.3 — cross-source identity resolution (merge, don't overwrite)
// =====================================================================
function sameEmail(a?: string, b?: string): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}
function sameName(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
  const nb = b
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
  return !!na && (na === nb || na.includes(nb) || nb.includes(na));
}
/** Derive a probable person name from an email local part ("jane.smith" → "jane smith"). */
function nameFromEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (ROLE_LOCALPARTS.has(local)) return undefined;
  // Hyphenated/dotted role locals (dmarc.reports, security-alert) are not people.
  const parts = local.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.some((p) => ROLE_LOCALPARTS.has(p))) return undefined;
  return parts.length >= 2 ? parts.join(" ") : undefined;
}
function domainOf(email?: string): string | undefined {
  return email && email.includes("@") ? email.split("@")[1] : undefined;
}

export type SocialLinks = {
  linkedin?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  youtube?: string;
  tiktok?: string;
  github?: string;
};

export type PageContactHarvest = {
  emails: string[];
  phones: string[];
  pages: string[];
  socials: SocialLinks;
};

const MAILTO_RE = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const TEL_RE = /tel:(\+?[\d\s().-]{7,22})/gi;
const EMAIL_IN_HTML = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

// ── Own social-profile extractor (no third-party API) ───────────────────────
// Modeled on the classic contact-info-extractor pattern: scan a company's own
// pages for links to its social profiles. Share/intent/login links are noise
// and are rejected; only profile-shaped URLs are kept.
const SOCIAL_PATTERNS: Array<{ key: keyof SocialLinks; re: RegExp; reject?: RegExp }> = [
  {
    key: "linkedin",
    re: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/[A-Za-z0-9_%.-]+\/?/gi,
    reject: /\/(shareArticle|sharing|login|signup)/i,
  },
  {
    key: "twitter",
    re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]{2,15}\/?(?![\w/])/gi,
    reject: /\/(intent|share|search|hashtag|home|login|signup|i)\b/i,
  },
  {
    key: "facebook",
    re: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.-]{3,60}\/?/gi,
    reject:
      /\/(sharer|share|dialog|login|plugins|events|groups|marketplace|watch|policies|help)\b/i,
  },
  {
    key: "instagram",
    re: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]{2,30}\/?/gi,
    reject: /\/(p|reel|explore|accounts|share)\b/i,
  },
  {
    key: "youtube",
    re: /https?:\/\/(?:www\.)?youtube\.com\/(?:@[A-Za-z0-9_.-]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_.-]+|user\/[A-Za-z0-9_.-]+)\/?/gi,
  },
  {
    key: "tiktok",
    re: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,30}\/?/gi,
  },
  {
    key: "github",
    re: /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]{2,40}\/?(?![\w/])/gi,
    reject: /\/(login|signup|features|pricing|topics|search|sponsors|about)\b/i,
  },
];

/** Extract the first profile-shaped social link per network from raw HTML. */
export function extractSocialLinks(html: string, existing: SocialLinks = {}): SocialLinks {
  const out: SocialLinks = { ...existing };
  for (const { key, re, reject } of SOCIAL_PATTERNS) {
    if (out[key]) continue;
    re.lastIndex = 0;
    for (const m of html.matchAll(re)) {
      const url = m[0].replace(/[),.;'"\\]+$/, "");
      if (reject && reject.test(url)) continue;
      out[key] = url;
      break;
    }
  }
  return out;
}

/**
 * Harvest mailto:/tel: (and plain emails) from company homepage + /contact + /team.
 * Uses the fetch gate so soft-404 / login walls never count as contacts.
 */
export async function harvestPageContacts(
  domain: string,
  companyNameTokens: string[] = [],
): Promise<PageContactHarvest> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const pages: string[] = [];
  let socials: SocialLinks = {};
  const paths = ["", "/contact", "/contact-us", "/team", "/about", "/about-us"];

  for (const path of paths) {
    const url = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}${path}`;
    try {
      const html = await resilientText(url, { retries: 1 });
      if (!html) continue;
      const title = (html.match(/<title[^>]*>([^<]+)/i)?.[1] || "").trim();
      const text = condensePageText(html, 8000);
      const gate = validateFetchedPage({
        url,
        status: 200,
        title,
        text,
        relevanceTokens: companyNameTokens.length ? companyNameTokens : undefined,
        minTextLength: 60,
      });
      if (!gate.ok) continue;
      pages.push(url);

      for (const m of html.matchAll(MAILTO_RE)) {
        const e = m[1].toLowerCase();
        const d = e.split("@")[1];
        if (d && !COMMON_NON_COMPANY.has(d)) emails.add(e);
      }
      for (const m of html.matchAll(TEL_RE)) {
        const p = m[1].replace(/\s+/g, " ").trim();
        if (p.replace(/\D/g, "").length >= 7) phones.add(p);
      }
      socials = extractSocialLinks(html, socials);
      // Plain emails + plain-text phones on contact/team pages only
      // (homepage is noisier; text-regex phones false-positive easily).
      if (path) {
        for (const m of text.matchAll(EMAIL_IN_HTML)) {
          const e = m[0].toLowerCase();
          const d = e.split("@")[1];
          if (d && !COMMON_NON_COMPANY.has(d)) emails.add(e);
        }
        for (const m of text.matchAll(
          /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,5}\b/g,
        )) {
          const digits = m[0].replace(/\D/g, "");
          // conservative: international-looking or clearly formatted, 8–15 digits
          if (
            digits.length >= 8 &&
            digits.length <= 15 &&
            (m[0].startsWith("+") || m[0].includes("("))
          ) {
            phones.add(m[0].trim());
          }
        }
      }
    } catch {
      /* next path */
    }
  }

  return {
    emails: Array.from(emails).slice(0, 8),
    phones: Array.from(phones).slice(0, 5),
    pages,
    socials,
  };
}

/** Hosts we will HTTP-scrape for bio / link-in-bio contact (LinkedIn excluded — cookie/ToS). */
const PROFILE_HARVEST_HOST =
  /(instagram\.com|tiktok\.com|github\.com|youtube\.com|youtu\.be|twitch\.tv|pinterest\.com|linktr\.ee|stan\.store|linkr\.bio|bio\.link|beacons\.ai|carrd\.co|lnk\.bio|withkoji\.com)$/i;

/** Noise domains — personal mailboxes (gmail etc.) are kept for bio harvest. */
const PROFILE_EMAIL_NOISE = new Set([
  "example.com",
  "email.com",
  "domain.com",
  "sentry.io",
  "wixpress.com",
  "cloudflare.com",
  "schema.org",
  "w3.org",
  "googleapis.com",
  "gstatic.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "github.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
]);

const LINK_IN_BIO_HOST =
  /(linktr\.ee|stan\.store|linkr\.bio|bio\.link|beacons\.ai|carrd\.co|lnk\.bio|withkoji\.com)$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isHarvestableProfileUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (host.includes("linkedin.com")) return false;
  return PROFILE_HARVEST_HOST.test(host);
}

function collectContactsFromHtml(
  html: string,
  emails: Set<string>,
  phones: Set<string>,
  allowPersonalMail: boolean,
): void {
  const text = condensePageText(html, 12_000);
  for (const m of html.matchAll(MAILTO_RE)) {
    const e = m[1].toLowerCase();
    const d = e.split("@")[1];
    if (!d) continue;
    if (allowPersonalMail ? !PROFILE_EMAIL_NOISE.has(d) : !COMMON_NON_COMPANY.has(d)) {
      emails.add(e);
    }
  }
  for (const m of text.matchAll(EMAIL_IN_HTML)) {
    const e = m[0].toLowerCase();
    const d = e.split("@")[1];
    if (!d) continue;
    if (allowPersonalMail ? !PROFILE_EMAIL_NOISE.has(d) : !COMMON_NON_COMPANY.has(d)) {
      emails.add(e);
    }
  }
  for (const m of html.matchAll(TEL_RE)) {
    const p = m[1].replace(/\s+/g, " ").trim();
    if (p.replace(/\D/g, "").length >= 7) phones.add(p);
  }
  // WhatsApp click-to-chat → phone
  for (const m of html.matchAll(
    /https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{8,15})/gi,
  )) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) phones.add(`+${digits}`);
  }
}

function extractLinkInBioUrls(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const raw = m[0].replace(/[),.;'"\\]+$/, "");
    const host = hostOf(raw);
    if (host && LINK_IN_BIO_HOST.test(host)) out.push(raw);
  }
  return Array.from(new Set(out)).slice(0, 4);
}

/**
 * GitHub public profile via REST API (keyless, 60 req/hr shared quota).
 * Structured bio/email/company/blog beats HTML scraping the profile page —
 * and unlike LinkedIn it needs no cookies (ToS-clean). Returns null on any
 * failure (rate limit, 404, network): the caller falls through to HTML.
 */
const GITHUB_PROFILE_RE = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{2,40})\/?$/i;

export interface GitHubProfile {
  email?: string;
  blog?: string;
  bio?: string;
  company?: string;
  location?: string;
}

export async function fetchGitHubProfile(handle: string): Promise<GitHubProfile | null> {
  if (!/^[A-Za-z0-9-]{2,40}$/.test(handle)) return null;
  try {
    const data = await Promise.race([
      resilientJson<{
        email?: string | null;
        blog?: string | null;
        bio?: string | null;
        company?: string | null;
        location?: string | null;
      }>(`https://api.github.com/users/${encodeURIComponent(handle)}`).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]);
    if (!data) return null;
    const out: GitHubProfile = {};
    if (typeof data.email === "string" && data.email.includes("@")) {
      const d = data.email.toLowerCase().split("@")[1];
      if (d && !PROFILE_EMAIL_NOISE.has(d)) out.email = data.email.toLowerCase();
    }
    if (typeof data.blog === "string" && data.blog.trim()) out.blog = data.blog.trim();
    if (typeof data.bio === "string" && data.bio.trim()) out.bio = data.bio.trim().slice(0, 500);
    if (typeof data.company === "string" && data.company.trim())
      out.company = data.company.trim().slice(0, 120);
    if (typeof data.location === "string" && data.location.trim())
      out.location = data.location.trim().slice(0, 120);
    return out.email || out.blog || out.bio ? out : null;
  } catch {
    return null;
  }
}

/**
 * Scout-style profile / bio harvest: fetch public social + link-in-bio pages
 * and pull emails/phones/links. Best-effort HTTP (no LinkedIn cookies).
 */
export async function harvestProfileContacts(urls: string[]): Promise<PageContactHarvest> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const pages: string[] = [];
  let socials: SocialLinks = {};
  const queue = [...new Set(urls.map((u) => u.trim()).filter(isHarvestableProfileUrl))].slice(0, 5);
  const followed = new Set<string>();

  for (const url of queue) {
    try {
      // GitHub profiles: structured REST API first (keyless). On any miss,
      // fall through to the generic HTML scrape below.
      const gh = GITHUB_PROFILE_RE.exec(url.trim());
      if (gh) {
        const prof = await fetchGitHubProfile(gh[1]);
        if (prof) {
          pages.push(url);
          if (prof.email) emails.add(prof.email);
          // prof.blog/bio/company inform manual review via discovery notes
          // upstream; not fetched here (queue stays bounded, no extra calls).
          continue;
        }
      }
      const html = await resilientText(url, { retries: 1 });
      if (!html || html.length < 40) continue;
      pages.push(url);
      collectContactsFromHtml(html, emails, phones, true);
      socials = extractSocialLinks(html, socials);
      for (const bio of extractLinkInBioUrls(html)) {
        if (followed.has(bio) || queue.includes(bio)) continue;
        followed.add(bio);
        try {
          const bioHtml = await resilientText(bio, { retries: 1 });
          if (!bioHtml) continue;
          pages.push(bio);
          collectContactsFromHtml(bioHtml, emails, phones, true);
          socials = extractSocialLinks(bioHtml, socials);
        } catch {
          /* next */
        }
      }
    } catch {
      /* next url */
    }
  }

  return {
    emails: Array.from(emails).slice(0, 8),
    phones: Array.from(phones).slice(0, 5),
    pages,
    socials,
  };
}

/**
 * Opt-in deep enrich: fetch pages via scrape/stealth worker (browser) and
 * extract contacts from rendered text. Never used in Discover search fan-out.
 */
export async function harvestContactsViaBrowser(urls: string[]): Promise<PageContactHarvest> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const pages: string[] = [];
  let socials: SocialLinks = {};
  const { fetchPageContent } = await import("../search/page-enrichment.server");

  const cleaned = [...new Set(urls.map((u) => u.trim()).filter(Boolean))]
    .filter((u) => {
      const host = hostOf(u);
      return !!host && !host.includes("linkedin.com");
    })
    .slice(0, 4);

  for (const url of cleaned) {
    try {
      const page = await fetchPageContent(url);
      if (!page) continue;
      const body = `${page.title || ""}\n${page.text || page.markdown || ""}`;
      if (body.trim().length < 40) continue;
      pages.push(page.url || url);
      // Treat markdown/text as HTML-ish for regex extractors
      collectContactsFromHtml(body, emails, phones, true);
      socials = extractSocialLinks(body, socials);
    } catch {
      /* next */
    }
  }

  return {
    emails: Array.from(emails).slice(0, 8),
    phones: Array.from(phones).slice(0, 5),
    pages,
    socials,
  };
}

// =====================================================================
// Paid enrichment providers (env-gated, consulted only after the free
// waterfall finds nothing). Each returns corroboration SIGNALS — never a
// blind verdict — so they merge like every other source.
//
// Beta credit guard: free tiers are tiny (Hunter: 50 searches/mo, PDL:
// ~100 lifetime), so every paid call passes through a daily budget. When
// the budget is spent, providers silently skip and the free waterfall
// result stands.
// =====================================================================
let paidBudget = { day: "", used: 0 };

/** Shared daily budget for Hunter / PDL / CoreClaw paid enrich calls. */
export function spendPaidCredit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (paidBudget.day !== today) paidBudget = { day: today, used: 0 };
  const cap = Math.max(0, Number(process.env.PAID_ENRICH_DAILY_CAP ?? 10));
  if (paidBudget.used >= cap) return false;
  paidBudget.used++;
  return true;
}

/** Hunter.io Email Finder — best-guess work email for a named person at a domain. */
export async function hunterEmailFinder(
  domain: string,
  fullName: string,
): Promise<ContactSignal | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key || !domain || !fullName) return null;
  if (!spendPaidCredit()) return null;
  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&full_name=${encodeURIComponent(fullName)}&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const email = d?.data?.email;
    if (!email) return null;
    const score = Number(d?.data?.score ?? 0);
    return {
      kind: "hunter",
      email,
      name: fullName,
      domain,
      confidence: Math.max(0.3, Math.min(0.9, score / 100)),
      note: `Hunter email finder (score ${score || "?"})`,
    };
  } catch {
    return null;
  }
}

/** Hunter.io Domain Search — known emails published for a company domain. */
export async function hunterDomainSearch(domain: string): Promise<ContactSignal[]> {
  const key = process.env.HUNTER_API_KEY;
  if (!key || !domain) return [];
  if (!spendPaidCredit()) return [];
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const d = (await res.json()) as any;
    const emails: any[] = d?.data?.emails ?? [];
    return emails.slice(0, 5).map((e) => ({
      kind: "hunter" as const,
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(" ") || undefined,
      phone: e.phone_number || undefined,
      domain,
      confidence: Math.max(0.3, Math.min(0.85, Number(e.confidence ?? 40) / 100)),
      note: `Hunter domain search${e.position ? ` — ${e.position}` : ""}`,
    }));
  } catch {
    return [];
  }
}

export type CompanyEnrichment = {
  name?: string;
  phone?: string;
  emails: string[];
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  signals: ContactSignal[];
};

/** Hunter.io Company Enrichment — phones, published emails, socials for a domain. */
export async function hunterCompanyEnrich(domain: string): Promise<CompanyEnrichment | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key || !domain) return null;
  if (!spendPaidCredit()) return null;
  try {
    const url = `https://api.hunter.io/v2/companies/find?domain=${encodeURIComponent(domain)}&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const c = d?.data;
    if (!c) return null;
    const emails: string[] = (c.site?.emailAddresses ?? []).slice(0, 3);
    const phone: string | undefined = c.site?.phoneNumbers?.[0] || c.phone || undefined;
    const li = c.linkedin
      ? `https://www.linkedin.com/company/${String(c.linkedin).replace(/^.*linkedin\.com\/company\//i, "")}`
      : undefined;
    const tw = c.twitter
      ? `https://x.com/${String(c.twitter)
          .replace(/^@/, "")
          .replace(/^.*(?:twitter|x)\.com\//i, "")}`
      : undefined;
    const fb = c.facebook
      ? `https://facebook.com/${String(c.facebook).replace(/^.*facebook\.com\//i, "")}`
      : undefined;
    const signals: ContactSignal[] = [];
    for (const e of emails) {
      signals.push({
        kind: "hunter",
        email: e,
        domain,
        confidence: 0.55,
        note: `Hunter company enrichment${c.name ? ` — ${c.name}` : ""}`,
      });
    }
    if (phone) {
      signals.push({
        kind: "hunter",
        phone,
        domain,
        confidence: 0.55,
        note: `Hunter company enrichment${c.name ? ` — ${c.name}` : ""} (published phone)`,
      });
    }
    if (!signals.length && !li && !tw && !fb) return null;
    return {
      name: c.name || undefined,
      phone,
      emails,
      linkedin_url: li,
      twitter_url: tw,
      facebook_url: fb,
      signals,
    };
  } catch {
    return null;
  }
}

/** People Data Labs person enrichment — title/LinkedIn/work email for a named person. */
export async function pdlPersonEnrich(
  name: string,
  company?: string,
  domain?: string,
): Promise<ContactSignal | null> {
  const key = process.env.PDL_API_KEY;
  if (!key || !name) return null;
  if (!spendPaidCredit()) return null;
  try {
    const params = new URLSearchParams({ name });
    if (company) params.set("company", company);
    const res = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {
      headers: { "X-Api-Key": key },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const p = d?.data;
    if (!p) return null;
    const email =
      p.work_email || (Array.isArray(p.emails) ? p.emails[0]?.address : undefined) || undefined;
    const li = p.linkedin_url
      ? String(p.linkedin_url).startsWith("http")
        ? p.linkedin_url
        : `https://${p.linkedin_url}`
      : undefined;
    if (!email && !li && !p.job_title) return null;
    return {
      kind: "pdl",
      email,
      name: p.full_name || name,
      domain,
      url: li,
      confidence: Math.min(0.85, Number(d?.likelihood ?? 5) / 10),
      note: `People Data Labs${p.job_title ? ` — ${p.job_title}` : ""}${p.job_company_name ? ` @ ${p.job_company_name}` : ""}`,
    };
  } catch {
    return null;
  }
}

/** Pattern-guess first.last@domain from a person name (unverified until SMTP/MX). */
export function guessEmailPatterns(personName: string, domain: string): string[] {
  const parts = (personName || "")
    .toLowerCase()
    .replace(/[^a-z\s.-]/g, " ")
    .split(/[\s.]+/)
    .filter((p) => p.length >= 2 && !ROLE_LOCALPARTS.has(p));
  if (!parts.length || !domain) return [];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const out: string[] = [];
  if (parts.length >= 2 && first !== last) {
    out.push(`${first}.${last}@${domain}`);
    out.push(`${first}${last}@${domain}`);
    out.push(`${first[0]}${last}@${domain}`);
    out.push(`${first}_${last}@${domain}`);
  } else {
    out.push(`${first}@${domain}`);
  }
  return out.slice(0, 5);
}

/**
 * Merge signals about (potentially) the same person into enriched contact
 * records. Signals that share an email — or share a name AND domain — collapse
 * into ONE record listing ALL corroborating sources. Confidence rises with the
 * number of INDEPENDENT source kinds that agree (corroboration), which is what
 * separates a "guessed" contact from a "verified" one.
 */
export function mergeContactRecords(signals: ContactSignal[]): ResolvedContact[] {
  const records: ResolvedContact[] = [];

  for (const sig of signals) {
    const sigNameGuess = sig.name || nameFromEmail(sig.email);
    const sigDomain = sig.domain || domainOf(sig.email);
    let target = records.find((r) => {
      if (sameEmail(r.email, sig.email)) return true;
      if (sig.phone && r.phone && sig.phone.replace(/\D/g, "") === r.phone.replace(/\D/g, ""))
        return true;
      // name (explicit or derived from an email local part) + matching domain
      const rNameGuess = r.name || nameFromEmail(r.email);
      const rDomain = r.domain || domainOf(r.email);
      if (sameName(rNameGuess, sigNameGuess) && (!rDomain || !sigDomain || rDomain === sigDomain))
        return true;
      return false;
    });
    if (!target) {
      target = {
        name: sig.name,
        email: sig.email,
        phone: sig.phone,
        domain: sig.domain,
        confidence: 0,
        corroborating_sources: [],
      };
      records.push(target);
    }
    // Enrich fields; upgrade email when the new signal is higher confidence
    // (e.g. person-matched harvest beats generic info@).
    target.name = target.name || sig.name || nameFromEmail(sig.email);
    if (sig.email) {
      const existingConf = target.corroborating_sources
        .filter((s) => s.email === target.email)
        .reduce((m, s) => Math.max(m, s.confidence), 0);
      if (!target.email || sig.confidence >= existingConf) target.email = sig.email;
    }
    target.phone = target.phone || sig.phone;
    target.domain = target.domain || sigDomain;
    target.corroborating_sources.push(sig);
  }

  // confidence = combine independent sources (noisy-OR over distinct kinds)
  for (const r of records) {
    const byKind = new Map<ContactSourceKind, number>();
    for (const s of r.corroborating_sources) {
      byKind.set(s.kind, Math.max(byKind.get(s.kind) ?? 0, s.confidence));
    }
    let notMissed = 1;
    for (const c of byKind.values()) notMissed *= 1 - Math.min(0.95, c);
    // small explicit bonus for having 2+ independent corroborating kinds
    const kinds = byKind.size;
    let conf = 1 - notMissed;
    if (kinds >= 2) conf = Math.min(1, conf + 0.1 * (kinds - 1));
    r.confidence = Number(conf.toFixed(2));
  }

  return records.sort((a, b) => b.confidence - a.confidence);
}
