// =====================================================================
// Discovery Query Engine (Phase 0, Task 0.1)
//
// A systematic, reusable, combinatorial boolean-query generator that every
// source (existing SearXNG-based fetchers + new ones) can call instead of
// hand-writing 2-3 queries per platform.
//
// Pure module: NO network, NO side effects. Fully unit-testable offline.
//
// NOTE ON PROJECT REALITY: the original build spec referred to this file as
// `server/services/dorkEngine.js`. This project has no `server/` dir; the
// live search pipeline is the TanStack server fn `runSearch`
// (src/lib/search.functions.ts) which calls src/lib/search/*. This module is
// therefore placed alongside query-expander.ts / searxng.server.ts and typed
// in TS to match that pipeline.
// =====================================================================

// ---------------------------------------------------------------------
// Buyer-phrase intent templates (parameterized by {role}).
// Each renders to a search fragment. Some bake an exact phrase around the
// whole thing ("looking for a {role}"); others quote the intent and the
// role separately ("we're hiring" "{role}") so the role can appear
// anywhere in the post, which converts better on formal platforms.
// ---------------------------------------------------------------------
export const INTENT_TEMPLATES: string[] = [
  'looking for a {role}',
  'need a {role}',
  'hiring a {role}',
  'hiring {role}s',
  'anyone know a good {role}',
  'can anyone recommend a {role}',
  '{role} needed',
  '{role} wanted',
  '"we\'re hiring" "{role}"',
  '"we are hiring" "{role}"',
  '"open role" "{role}"',
  // Want/need demand phrasing — buyers who aren't posting a formal job:
  // "I need someone to build…", "willing to pay", "who can help with…".
  'i need a {role}',
  '"i want" "{role}"',
  '"willing to pay" "{role}"',
  '"who can help" "{role}"',
];

// Which template *indices* render as a single exact phrase (wrap whole thing
// in quotes) vs. already-quoted composites we pass through verbatim.
// Composite templates already contain their own quotes.
function isComposite(tpl: string): boolean {
  return tpl.includes('"');
}

// ---------------------------------------------------------------------
// Platform scopes → site: operator combination.
// discord_public = disboard.org (public server *listings* only). We never
// read inside Discord servers; that needs bot/API access this build avoids.
// ---------------------------------------------------------------------
export const PLATFORM_SCOPES: Record<string, string> = {
  facebook_groups: "site:facebook.com/groups",
  linkedin_posts: "site:linkedin.com/posts",
  reddit: "site:reddit.com",
  quora: "site:quora.com",
  twitter_x: "site:twitter.com OR site:x.com",
  indie_forums: "site:indiehackers.com OR site:producthunt.com",
  // Public Discord server *listings* only (Disboard / top.gg). Never scrape private Discord.
  discord_public: "site:disboard.org OR site:top.gg/servers",
  // Public Fiverr gig/request pages via search — no private Fiverr API
  fiverr_public: "site:fiverr.com",
  // Public Instagram post/profile pages indexed by search engines
  instagram: "site:instagram.com",
  // Public TikTok videos/profiles indexed by search engines
  tiktok: "site:tiktok.com",
  // Public WhatsApp group *invite* pages only — content inside chats is never touched
  whatsapp_public: "site:chat.whatsapp.com",
  // Public GitHub issues/discussions (bounty/hiring chatter beyond the API source)
  github_public: "site:github.com",
  // Public Threads posts indexed by search engines
  threads: "site:threads.net",
  // YouTube videos/channels indexed by search engines + captions
  youtube: "site:youtube.com",
  // Company About / careers pages (public firmographic signals)
  company_pages: 'inurl:about OR inurl:careers OR inurl:jobs',
  // Software review sites — competitor-comparison / dissatisfaction signals
  reviews: "site:g2.com OR site:capterra.com",
};

export type PlatformScopeKey = keyof typeof PLATFORM_SCOPES;

// Conversion-priority table (simple, non-ML). Higher = more likely to
// convert for buyer-intent discovery, so it gets more of the query budget
// when a cross-scope cap forces trimming. Reddit + LinkedIn posts convert
// best for hiring intent; disboard listings are the weakest signal.
export const PLATFORM_CONVERSION_PRIORITY: Record<string, number> = {
  reddit: 10,
  linkedin_posts: 9,
  twitter_x: 7,
  facebook_groups: 6,
  indie_forums: 6,
  quora: 4,
  fiverr_public: 5,
  instagram: 4,
  tiktok: 3,
  github_public: 3,
  youtube: 4,
  company_pages: 5,
  discord_public: 2,
  whatsapp_public: 2,
};

// Platform-specific intent-phrase tuning (Task 0.3 groundwork).
// Reddit r/forhire conventions differ from LinkedIn's formal phrasing which
// differs from Twitter/X's terse style. We encode a preferred *ordering* of
// template indices per platform; templates not listed still trail behind so
// nothing is lost, just deprioritized. Indices map into INTENT_TEMPLATES.
export const PLATFORM_PHRASE_PRIORITY: Record<string, number[]> = {
  // Reddit: terse "needed/wanted", direct "need a" / "i need a", plus explicit hiring.
  reddit: [6, 7, 1, 11, 2, 3, 0],
  // LinkedIn: formal "we're hiring"/"we are hiring"/"open role" first.
  linkedin_posts: [8, 9, 10, 2, 0],
  // Twitter/X: terse needed/wanted, "willing to pay", short "hiring".
  twitter_x: [6, 7, 13, 2, 3, 1],
  // Facebook groups: recommendation-style ("anyone know", "recommend", "i need a").
  facebook_groups: [4, 5, 0, 1, 11, 6],
  // Quora: question/recommendation framing.
  quora: [4, 5, 0, 1],
  // Indie forums: builder "need a" / recommendation.
  indie_forums: [1, 0, 5, 6, 8],
  // Disboard: listing text is thin; recommendation/hiring keywords.
  discord_public: [2, 3, 6, 0],
  // Fiverr: buyer-style "need a" / "looking for" on public pages.
  fiverr_public: [1, 0, 6, 7, 4],
  // Instagram/TikTok: terse hiring/looking-for captions.
  instagram: [2, 3, 0, 1],
  tiktok: [2, 3, 0, 1],
  // WhatsApp invite pages / GitHub issues: hiring keywords in listing text.
  whatsapp_public: [2, 3, 6],
  github_public: [6, 2, 1],
  // Threads: terse social phrasing like Twitter/Instagram.
  threads: [6, 7, 2, 1, 11],
  // YouTube: hiring / need / looking-for in titles & descriptions.
  youtube: [2, 3, 0, 1, 6],
  // Company about/careers pages: formal hiring language.
  company_pages: [8, 9, 10, 2, 0],
  // Reviews: recommendation/alternative framing.
  reviews: [4, 5, 0],
};

// Exclusion terms baked in by default.
//   -"open to work"  kills candidate/seeker posts when hunting employer intent
//   -jobs.com, -indeed.com  kill aggregator noise vs. primary-source posts
// NOTE: bare `-jobs.com` is treated by search engines as a string-contains
// exclusion, NOT a host exclusion. Callers wanting a true host filter should
// pass `-site:indeed.com` etc. via `exclusions`. Kept as spec'd by default,
// caller-overridable.
export const DEFAULT_EXCLUSIONS: string[] = [
  '-"open to work"',
  "-jobs.com",
  "-indeed.com",
];

// SearXNG time_range values. dateRange maps onto these.
export type DateRange = "day" | "week" | "month" | "year" | "";
const VALID_TIME_RANGES = new Set(["day", "week", "month", "year"]);

export interface DorkQueryOptions {
  /** Primary role, e.g. "AI engineer" (from query-classifier). Required. */
  role: string;
  /** Expanded synonyms / adjacent titles. */
  relatedRoles?: string[];
  /**
   * Platform scope(s). Accepts:
   *  - a scope key ("reddit") or array of keys (["reddit","quora"])
   *  - a raw site: string ("site:example.com")
   *  - omitted → all PLATFORM_SCOPES (spec acceptance: "across all scopes")
   */
  platformScope?: PlatformScopeKey | string | Array<PlatformScopeKey | string>;
  /** Buyer-phrase templates. Defaults to INTENT_TEMPLATES. */
  intentTemplates?: string[];
  /** Negative terms. Defaults to DEFAULT_EXCLUSIONS. Pass [] to disable. */
  exclusions?: string[];
  /** Maps to SearXNG time_range. */
  dateRange?: DateRange;
  /** Per-search hard cap on generated queries. Default 30. */
  limit?: number;
  /** intitle: terms to AND into every query. */
  titleTerms?: string[];
  /** inurl: terms to AND into every query. */
  urlTerms?: string[];
  /** Google AROUND(n) proximity, e.g. { a: "budget", n: 5, b: "design" }. */
  proximity?: { a: string; n: number; b: string };
  /**
   * Apply PLATFORM_PHRASE_PRIORITY so each platform leads with the phrasing
   * that converts there. Default true.
   */
  platformTunedPhrasing?: boolean;
}

export interface DorkQueryPlanEntry {
  query: string;
  scope: string; // scope key or raw scope string used
  timeRange: DateRange;
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

/**
 * Sanitize a role for safe interpolation: strip stray quotes/operators a
 * classifier might leak, collapse whitespace. Prevents query injection like
 * `AI "engineer` from breaking phrase matching.
 */
export function sanitizeRole(role: string): string {
  return (role || "")
    .replace(/["'()]/g, " ")
    .replace(/\bOR\b|\bAND\b/gi, " ")
    // Strip any leaked search operators so a garbled role can't inject scope.
    .replace(/-?\b(?:site|intitle|inurl|intext|filetype|around)\s*:/gi, " ")
    .replace(/around\s*\(\s*\d+\s*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fillTemplate(tpl: string, role: string): string {
  // Composite templates already contain quotes for the intent phrase; only
  // substitute the role (itself quoted inside the template).
  if (isComposite(tpl)) return tpl.replace(/\{role\}/g, role);
  // Simple templates → wrap the whole rendered phrase as one exact phrase.
  const phrase = tpl.replace(/\{role\}/g, role);
  return `"${phrase}"`;
}

function resolveScopes(
  scope: DorkQueryOptions["platformScope"],
): Array<{ key: string; operator: string }> {
  if (scope == null) {
    return Object.entries(PLATFORM_SCOPES).map(([key, operator]) => ({ key, operator }));
  }
  const arr = Array.isArray(scope) ? scope : [scope];
  const out: Array<{ key: string; operator: string }> = [];
  for (const s of arr) {
    if (PLATFORM_SCOPES[s as string]) {
      out.push({ key: s as string, operator: PLATFORM_SCOPES[s as string] });
    } else if (typeof s === "string" && s.trim()) {
      // raw site: string or freeform scope
      out.push({ key: s, operator: s.trim() });
    }
  }
  return out;
}

function scopePriority(key: string): number {
  return PLATFORM_CONVERSION_PRIORITY[key] ?? 3;
}

function orderTemplatesForScope(
  scopeKey: string,
  templates: string[],
  tuned: boolean,
): string[] {
  if (!tuned) return templates;
  const order = PLATFORM_PHRASE_PRIORITY[scopeKey];
  if (!order) return templates;
  const seen = new Set<number>();
  const ordered: string[] = [];
  for (const idx of order) {
    if (idx >= 0 && idx < templates.length && !seen.has(idx)) {
      ordered.push(templates[idx]);
      seen.add(idx);
    }
  }
  // trailing: any templates not explicitly prioritized (nothing lost)
  templates.forEach((t, i) => {
    if (!seen.has(i)) ordered.push(t);
  });
  return ordered;
}

function wrapScope(operator: string, body: string): string {
  // OR-combos must be parenthesized so the exclusions/phrases bind correctly.
  const scopeFragment = operator.includes(" OR ") ? `(${operator})` : operator;
  return `${scopeFragment} ${body}`.trim();
}

function buildOperators(opts: DorkQueryOptions): string {
  const parts: string[] = [];
  for (const t of opts.titleTerms ?? []) {
    const term = t.trim();
    if (term) parts.push(`intitle:${term.includes(" ") ? `"${term}"` : term}`);
  }
  for (const u of opts.urlTerms ?? []) {
    const term = u.trim();
    if (term) parts.push(`inurl:${term.includes(" ") ? `"${term}"` : term}`);
  }
  if (opts.proximity && opts.proximity.a && opts.proximity.b) {
    const { a, n, b } = opts.proximity;
    parts.push(`${a} AROUND(${Math.max(1, Math.floor(n))}) ${b}`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------
// core: build the plan (query + scope + timeRange), then cap by priority.
// ---------------------------------------------------------------------
export function generateDorkQueryPlan(opts: DorkQueryOptions): DorkQueryPlanEntry[] {
  const limit = Math.max(1, opts.limit ?? 30);
  const dateRange: DateRange = VALID_TIME_RANGES.has(opts.dateRange ?? "")
    ? (opts.dateRange as DateRange)
    : "";

  // roles = role + relatedRoles, sanitized + deduped (case-insensitive)
  const rawRoles = [opts.role, ...(opts.relatedRoles ?? [])];
  const roleSeen = new Set<string>();
  const roles: string[] = [];
  for (const r of rawRoles) {
    const clean = sanitizeRole(r);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (roleSeen.has(key)) continue;
    roleSeen.add(key);
    roles.push(clean);
  }
  if (roles.length === 0) return [];

  const templates = opts.intentTemplates ?? INTENT_TEMPLATES;
  const exclusions = opts.exclusions ?? DEFAULT_EXCLUSIONS;
  const exclusionStr = exclusions.join(" ").trim();
  const operatorStr = buildOperators(opts);
  const tuned = opts.platformTunedPhrasing !== false;

  const scopes = resolveScopes(opts.platformScope);
  if (scopes.length === 0) return [];

  // Build a per-scope ordered list of candidate queries (cross-product of
  // roles × platform-tuned templates), deduped within scope.
  type ScopeBucket = { key: string; priority: number; queries: string[] };
  const buckets: ScopeBucket[] = scopes.map(({ key, operator }) => {
    const orderedTemplates = orderTemplatesForScope(key, templates, tuned);
    const seen = new Set<string>();
    const queries: string[] = [];
    // Order the cross-product template-major so each scope leads with its
    // best-converting phrasing across all roles before moving on.
    for (const tpl of orderedTemplates) {
      for (const role of roles) {
        const phrase = fillTemplate(tpl, role);
        const body = [phrase, operatorStr, exclusionStr].filter(Boolean).join(" ");
        const query = wrapScope(operator, body);
        const dk = query.toLowerCase();
        if (seen.has(dk)) continue;
        seen.add(dk);
        queries.push(query);
      }
    }
    return { key, priority: scopePriority(key), queries };
  });

  // Weighted round-robin cap: iterate rounds, each round pulls one query from
  // every scope in descending priority order, until we hit the limit or all
  // buckets are drained. This guarantees every scope gets coverage while
  // higher-priority scopes fill first within each round.
  buckets.sort((a, b) => b.priority - a.priority);
  const plan: DorkQueryPlanEntry[] = [];
  const cursors = new Array(buckets.length).fill(0);
  let progressed = true;
  while (plan.length < limit && progressed) {
    progressed = false;
    for (let i = 0; i < buckets.length && plan.length < limit; i++) {
      const b = buckets[i];
      if (cursors[i] < b.queries.length) {
        plan.push({ query: b.queries[cursors[i]], scope: b.key, timeRange: dateRange });
        cursors[i]++;
        progressed = true;
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------
// Primary contract (spec Task 0.1): returns a flat, deduped string[].
// ---------------------------------------------------------------------
export function generateDorkQueries(opts: DorkQueryOptions): string[] {
  return generateDorkQueryPlan(opts).map((e) => e.query);
}
