// =====================================================================
// robots.txt compliance for the contact harvest crawler
//
// robots.txt carries no independent legal force — ignoring it is not "hacking"
// and hiQ-line cases don't turn on it. But regulators and courts increasingly
// treat compliance as evidence of good faith, and the cost here is one cached
// fetch per domain. That's cheap insurance, and it also keeps us out of the
// DMCA §1201 conversation: honouring a site's stated limits is the opposite of
// circumventing a technological measure.
//
// Scope: the standard subset that actually appears in the wild — User-agent
// groups, Allow/Disallow with longest-match-wins precedence, `*` and `$`
// wildcards, and Crawl-delay. Sitemap lines are captured too since they're a
// free source of contact-page URLs.
// =====================================================================
import { resilientFetch } from "../search/http-fetch.server";

export const HARVEST_USER_AGENT = "ScrapivoBot";

type Rule = { path: string; allow: boolean; length: number };

type RobotsPolicy = {
  rules: Rule[];
  crawlDelayMs: number;
  sitemaps: string[];
  /** No robots.txt (or it errored) → everything is allowed, per the standard. */
  absent: boolean;
  fetchedAt: number;
};

const CACHE = new Map<string, RobotsPolicy>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — robots.txt changes rarely

function normalizeHost(domain: string): string {
  return (domain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

/**
 * Parse robots.txt into the rule set that applies to us.
 *
 * Group selection follows the standard: an exact user-agent match wins over
 * `*`, and only ONE group applies. Directives outside any group are ignored,
 * except Sitemap which is global.
 */
export function parseRobots(
  body: string,
  userAgent = HARVEST_USER_AGENT,
): Omit<RobotsPolicy, "fetchedAt" | "absent"> {
  const ua = userAgent.toLowerCase();
  const lines = (body || "").split(/\r?\n/);

  const groups: Array<{ agents: string[]; rules: Rule[]; crawlDelay?: number }> = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      // Consecutive User-agent lines share one group.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (!current) continue;

    if (field === "disallow" || field === "allow") {
      // An empty Disallow means "allow everything" and carries no path.
      if (field === "disallow" && value === "") continue;
      if (!value) continue;
      current.rules.push({ path: value, allow: field === "allow", length: value.length });
    } else if (field === "crawl-delay") {
      const n = Number(value.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  const exact = groups.find((g) => g.agents.some((a) => a === ua || (a !== "*" && ua.includes(a))));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const chosen = exact ?? wildcard;

  return {
    rules: chosen?.rules ?? [],
    crawlDelayMs: Math.min(30_000, Math.round((chosen?.crawlDelay ?? 0) * 1000)),
    sitemaps,
  };
}

/** Glob-match a robots path pattern (`*` wildcard, `$` end anchor) against a URL path. */
function matchesRule(pattern: string, path: string): boolean {
  if (!pattern.includes("*") && !pattern.endsWith("$")) return path.startsWith(pattern);
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    "^" + body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (anchored ? "$" : ""),
  );
  return re.test(path);
}

async function loadPolicy(host: string): Promise<RobotsPolicy> {
  const cached = CACHE.get(host);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  let policy: RobotsPolicy = {
    rules: [],
    crawlDelayMs: 0,
    sitemaps: [],
    absent: true,
    fetchedAt: Date.now(),
  };
  try {
    const res = await resilientFetch(`https://${host}/robots.txt`, {
      retries: 0,
      headers: { "User-Agent": `${HARVEST_USER_AGENT}/1.0 (+https://scrapivo.app/bot)` },
    });
    // 4xx/5xx → treat as absent (the standard's "no restrictions" default).
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      const body = await res.text();
      // Some hosts serve an HTML 200 for missing files — that is not robots.txt.
      if (!ct.includes("html") && !/^\s*</.test(body)) {
        policy = { ...parseRobots(body), absent: false, fetchedAt: Date.now() };
      }
    }
  } catch {
    /* unreachable robots.txt → absent */
  }
  CACHE.set(host, policy);
  return policy;
}

export type RobotsDecision = {
  allowed: boolean;
  /** Delay the site asked us to honour between requests, in ms. */
  crawlDelayMs: number;
  reason: string;
};

/**
 * Is this URL allowed for our crawler? Longest matching rule wins; Allow beats
 * Disallow at equal length (Google's tie-break, and the least surprising one).
 */
export async function isCrawlAllowed(
  url: string,
  userAgent = HARVEST_USER_AGENT,
): Promise<RobotsDecision> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, crawlDelayMs: 0, reason: "invalid url" };
  }
  const host = normalizeHost(parsed.hostname);
  const policy = await loadPolicy(host);
  if (policy.absent || !policy.rules.length) {
    return {
      allowed: true,
      crawlDelayMs: policy.crawlDelayMs,
      reason: policy.absent ? "no robots.txt" : "no rules for our agent",
    };
  }

  const path = parsed.pathname + parsed.search;
  let best: Rule | null = null;
  for (const rule of policy.rules) {
    if (!matchesRule(rule.path, path)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow))
      best = rule;
  }
  if (!best)
    return { allowed: true, crawlDelayMs: policy.crawlDelayMs, reason: "no matching rule" };
  return {
    allowed: best.allow,
    crawlDelayMs: policy.crawlDelayMs,
    reason: `${best.allow ? "Allow" : "Disallow"}: ${best.path}`,
  };
}

/** Sitemap URLs the site advertises — a free list of pages worth harvesting. */
export async function robotsSitemaps(domain: string): Promise<string[]> {
  const policy = await loadPolicy(normalizeHost(domain));
  return policy.sitemaps.slice(0, 5);
}

/** Crawl-delay the site asked for, clamped. Callers should sleep this between fetches. */
export async function robotsCrawlDelayMs(domain: string): Promise<number> {
  const policy = await loadPolicy(normalizeHost(domain));
  return policy.crawlDelayMs;
}
