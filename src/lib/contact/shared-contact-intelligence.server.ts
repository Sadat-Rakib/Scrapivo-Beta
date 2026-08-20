/**
 * Shared Contact Intelligence entry — one path for Local, Discover, Jobs.
 * Wraps discoverContacts with domain cache + preferred-email ranking.
 */
import {
  discoverContacts,
  type ContactDiscovery,
  type DiscoverOptions,
  type EmailRecord,
} from "./discover-contacts.server";

export type SharedContactEmail = {
  email: string;
  type: "info" | "sales" | "support" | "named" | "other";
  source: EmailRecord["origin"];
  sourceUrl?: string;
  confidence: number;
  domainMatch: boolean;
  raw?: string;
  verified: boolean;
};

export type SharedContactResult = {
  domain: string;
  emails: SharedContactEmail[];
  preferredEmail: string | null;
  phones: string[];
  preferredPhone: string | null;
  discovery: ContactDiscovery;
  fromCache: boolean;
  fetchedAt: string;
};

type CacheEntry = { at: number; value: SharedContactResult };

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60_000; // 30 minutes

function classifyLocalPart(email: string): SharedContactEmail["type"] {
  const local = email.split("@")[0]?.toLowerCase() || "";
  if (/^(info|hello|contact|office|admin|enquiries|inquiries)$/.test(local)) return "info";
  if (/^(sales|biz|business|partnerships)$/.test(local)) return "sales";
  if (/^(support|help|service)$/.test(local)) return "support";
  if (local.includes(".") || /^[a-z]+\.[a-z]+$/.test(local)) return "named";
  return "other";
}

/** Scout-inspired source prior: bio/page harvest > website role > derived. */
function originScore(origin: EmailRecord["origin"]): number {
  if (origin === "harvested") return 70;
  if (origin === "dns") return 50;
  if (origin === "registry") return 55;
  if (origin === "derived") return 35;
  return 40;
}

function rankEmails(emails: EmailRecord[], domain: string): SharedContactEmail[] {
  const mapped = emails.map((e) => {
    const domainMatch = e.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
    return {
      email: e.email,
      type: classifyLocalPart(e.email),
      source: e.origin,
      sourceUrl: e.provenance?.[0]?.source_url,
      confidence: e.confidence,
      domainMatch,
      verified: e.verification?.tier === "verified",
      _rank:
        (e.verification?.tier === "verified" ? 100 : 0) +
        originScore(e.origin) +
        (domainMatch ? 15 : 0) +
        e.confidence * 20,
    } satisfies SharedContactEmail & { _rank: number };
  });

  const typeScore = (t: SharedContactEmail["type"]) =>
    ({ named: 4, sales: 3, info: 2, support: 1, other: 0 })[t];

  return mapped
    .sort((a, b) => {
      if (b._rank !== a._rank) return b._rank - a._rank;
      return typeScore(b.type) - typeScore(a.type);
    })
    .map(({ _rank: _r, ...rest }) => rest);
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
}

export type DiscoverForDomainOpts = {
  company?: string;
  maxPages?: number;
  freeOnly?: boolean;
  skipRegistries?: boolean;
  /** Bypass cache */
  force?: boolean;
};

/**
 * Canonical shared entry: discover contacts for a company domain.
 */
export async function discoverContactsForDomain(
  domainInput: string,
  opts: DiscoverForDomainOpts = {},
): Promise<SharedContactResult> {
  const domain = normalizeDomain(domainInput);
  if (!domain || !domain.includes(".")) {
    const emptyDiscovery = await discoverContacts({
      company: opts.company || domain,
      freeOnly: true,
      skipRegistries: true,
      maxPages: 0,
    });
    return {
      domain,
      emails: [],
      preferredEmail: null,
      phones: [],
      preferredPhone: null,
      discovery: emptyDiscovery,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  const cached = CACHE.get(domain);
  if (!opts.force && cached && Date.now() - cached.at < TTL_MS) {
    return { ...cached.value, fromCache: true };
  }

  const discoverOpts: DiscoverOptions = {
    company: opts.company || domain.split(".")[0],
    domain,
    freeOnly: opts.freeOnly ?? true,
    skipRegistries: opts.skipRegistries ?? true,
    maxPages: opts.maxPages ?? 5,
  };

  const discovery = await discoverContacts(discoverOpts);
  const emails = rankEmails(discovery.emails, domain);
  const phones = discovery.phones.map((p) => p.e164 || p.phone).filter(Boolean) as string[];

  const value: SharedContactResult = {
    domain,
    emails,
    preferredEmail: emails[0]?.email ?? null,
    phones,
    preferredPhone: phones[0] ?? null,
    discovery,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
  };

  CACHE.set(domain, { at: Date.now(), value });
  return value;
}

/** Test helper — clear domain cache. */
export function clearContactDomainCache(): void {
  CACHE.clear();
}
