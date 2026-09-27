/**
 * Source Intelligence Registry — knowledge layer for known good research routes.
 *
 * Principle (beta completion pass §3): the registry is NOT a whitelist that
 * restricts the engine. Known sources are high-confidence shortcuts; real-time
 * discovery remains the universal path. Decisions here record what we know
 * about a source's access conditions so the planner can prefer structured
 * feeds and refuse hosts we must not touch.
 *
 * Not every source populates every field. `decision` is the enforcement bit:
 *   allowed     — runnable
 *   needs_key   — runnable only with configured credentials
 *   needs_review— owner decision required (access conditions unclear/robots)
 *   disabled    — never contact (no documented feed / terms forbid)
 */

export type SourceEntity =
  | "person"
  | "company"
  | "business"
  | "investor"
  | "accelerator"
  | "job"
  | "signal";

export type SourceKind =
  | "database"
  | "public_api"
  | "public_feed"
  | "directory"
  | "search"
  | "official_site"
  | "community"
  | "government"
  | "browser_only";

export type AccessMode =
  | "structured"
  | "http"
  | "search_only"
  | "browser"
  | "disabled";

export type SourceDecision = "allowed" | "needs_key" | "needs_review" | "disabled";

/** §49 source invocation outcomes — "failed" is never "zero results". */
export type SourceHealth =
  | "success"
  | "empty"
  | "partial"
  | "blocked"
  | "rate_limited"
  | "timeout"
  | "format_changed"
  | "auth_required"
  | "error";

export interface SourceDefinition {
  id: string;
  name: string;
  entityTypes: SourceEntity[];
  sourceKind: SourceKind;
  accessMode: AccessMode;
  decision: SourceDecision;
  decisionReason?: string;
  checkedAt?: string;
  documentation?: string;
  /** Feed/endpoint the adapter reads, where one exists. */
  endpoint?: string;
  robotsPolicy?: string;
  termsNotes?: string;
  requiresKey?: boolean;
  publishedRateLimit?: string;
  internalRateLimit?: string;
  crawlDelayMs?: number;
  /** Browser/HTTP concurrency per host. Default 1. */
  concurrency?: number;
  attributionRequired?: boolean;
  attributionText?: string;
  /** Runtime adapter id in the jobs registry / capability catalog. */
  adapter?: string;
  recognitionPatterns?: string[];
  notes?: string;
}

const CHECKED = "2026-09-27";

function ats(
  id: string,
  name: string,
  endpoint: string,
  patterns: string[],
  extra?: Partial<SourceDefinition>,
): SourceDefinition {
  return {
    id: `ats-${id}`,
    name: `${name} (ATS)`,
    entityTypes: ["job", "company"],
    sourceKind: "public_api",
    accessMode: "structured",
    decision: "allowed",
    checkedAt: CHECKED,
    endpoint,
    robotsPolicy: "respected; crawl-delay honored",
    internalRateLimit: "1 req/s per host",
    concurrency: 1,
    adapter: id,
    recognitionPatterns: patterns,
    ...extra,
  };
}

/**
 * Canonical catalog. Job families follow the documented public feeds audited
 * in the beta pass; "never contact" hosts carry explicit reasons so the
 * planner can refuse them instead of hammering.
 */
export const SOURCE_REGISTRY: SourceDefinition[] = [
  // ---- Structured ATS families (jobs) ----
  ats("greenhouse", "Greenhouse", "boards-api.greenhouse.io/v1/boards/{board}/jobs (EU: boards-api.eu.greenhouse.io)", [
    "job-boards\\.greenhouse\\.io/([A-Za-z0-9_-]+)",
    "job-boards\\.eu\\.greenhouse\\.io/([A-Za-z0-9_-]+)",
    "boards\\.greenhouse\\.io/([A-Za-z0-9_-]+)",
  ], { notes: "first_published is the posting date; updated_at is an edit" }),
  ats("lever", "Lever", "api.lever.co/v0/postings?mode=json", [
    "jobs\\.lever\\.co/([A-Za-z0-9_-]+)",
    "jobs\\.eu\\.lever\\.co/([A-Za-z0-9_-]+)",
  ], { crawlDelayMs: 1000, notes: "robots.txt Crawl-delay: 1" }),
  ats("ashby", "Ashby", "api.ashbyhq.com/posting-api/board/{board}?includeCompensation=true", [
    "jobs\\.ashbyhq\\.com/([A-Za-z0-9_-]+)",
  ]),
  ats("workable", "Workable", "apply.workable.com/api/v1/widget/accounts/{board}?details=true", [
    "apply\\.workable\\.com/([A-Za-z0-9_-]+)",
  ], { notes: "robots.txt ai-train=no observed; widget API is the documented public feed" }),
  ats("recruitee", "Recruitee", "{board}.recruitee.com/api/offers/", [
    "([A-Za-z0-9-]+)\\.recruitee\\.com",
  ], { notes: "public-offer token policy has a stated deadline (2027-02-10); re-check before relying on it" }),
  ats("personio", "Personio", "{board}.jobs.personio.de/xml (or .jobs.personio.com/xml)", [
    "([A-Za-z0-9-]+)\\.jobs\\.personio\\.de",
    "([A-Za-z0-9-]+)\\.jobs\\.personio\\.com",
  ], { notes: "XML feed; some boards need ?language=en when descriptions are empty" }),
  ats("teamtailor", "Teamtailor", "{board}.teamtailor.com/jobs.rss (or .na.teamtailor.com), paged", [
    "([A-Za-z0-9-]+)\\.teamtailor\\.com",
    "([A-Za-z0-9-]+)\\.na\\.teamtailor\\.com",
  ], { notes: "RSS 2.0, paginate until a page has fewer than 100 items" }),
  ats("gem", "Gem", "api.gem.com/job_board/v0/{board}/job_posts/", [
    "api\\.gem\\.com/job_board/v0/([A-Za-z0-9_-]+)/",
  ]),
  ats("smartrecruiters", "SmartRecruiters", "api.smartrecruiters.com/v1/companies/{board}/postings", [
    "([A-Za-z0-9-]+)\\.smartrecruiters\\.com",
    "api\\.smartrecruiters\\.com/v1/companies/([A-Za-z0-9_-]+)",
  ]),
  {
    id: "ats-workday",
    name: "Workday (ATS)",
    entityTypes: ["job", "company"],
    sourceKind: "public_api",
    accessMode: "http",
    decision: "needs_review",
    decisionReason: "No uniform public feed; CXS endpoints are tenant-specific and only reachable for verified tenant/host pairs",
    checkedAt: CHECKED,
    endpoint: "{tenant}.{host}/wday/cxs/{tenant}/{site}/jobs (POST)",
    adapter: "workday",
    recognitionPatterns: ["([A-Za-z0-9-]+)\\.(wd\\d+)\\.(myworkdayjobs|workdayjobs)\\.com"],
    notes: "data/workday_tenants.json holds verified pairs; rotate, cap volume",
  },

  // ---- Public job feeds / boards ----
  {
    id: "feed-remoteok",
    name: "Remote OK",
    entityTypes: ["job"],
    sourceKind: "public_feed",
    accessMode: "structured",
    decision: "allowed",
    checkedAt: CHECKED,
    endpoint: "remoteok.com/api",
    internalRateLimit: "4 refreshes / 24h, 1h apart",
    attributionRequired: true,
    attributionText: "Found on Remote OK",
    adapter: "remoteok",
  },
  {
    id: "feed-themuse",
    name: "The Muse",
    entityTypes: ["job"],
    sourceKind: "public_api",
    accessMode: "structured",
    decision: "needs_key",
    requiresKey: true,
    checkedAt: CHECKED,
    attributionRequired: true,
    attributionText: "Job listing from The Muse",
    adapter: "themuse",
  },
  {
    id: "feed-remotive",
    name: "Remotive",
    entityTypes: ["job"],
    sourceKind: "public_feed",
    accessMode: "structured",
    decision: "needs_review",
    decisionReason: "robots.txt is reported to disallow /api/* — owner must confirm current robots.txt before this feed runs",
    checkedAt: CHECKED,
    adapter: "remotive",
  },
  {
    id: "feed-usajobs",
    name: "USAJOBS",
    entityTypes: ["job"],
    sourceKind: "public_api",
    accessMode: "structured",
    decision: "needs_key",
    requiresKey: true,
    decisionReason: "Official API requires a registered key; robots.txt on the search host disallows general crawling",
    checkedAt: CHECKED,
    adapter: "usajobs",
  },
  {
    id: "feed-freehire",
    name: "FreeHire aggregated postings",
    entityTypes: ["job"],
    sourceKind: "database",
    accessMode: "structured",
    decision: "allowed",
    checkedAt: CHECKED,
    adapter: "freehire",
    notes: "Internal aggregated corpus (3.3M postings); first tier for spec job searches",
  },
  ...["weworkremotely", "jobicy", "arbeitnow", "workingnomads", "himalayas", "internshala", "4dayweek", "nodesk", "hn", "workatastartup", "githubjobs"].map((id) => ({
    id: `feed-${id}`,
    name: id,
    entityTypes: ["job"] as SourceEntity[],
    sourceKind: "public_feed" as SourceKind,
    accessMode: "structured" as AccessMode,
    decision: "allowed" as SourceDecision,
    checkedAt: CHECKED,
    adapter: id,
  })),

  // ---- General discovery ----
  {
    id: "search-searxng",
    name: "Self-hosted metasearch",
    entityTypes: ["person", "company", "business", "investor", "accelerator", "job", "signal"],
    sourceKind: "search",
    accessMode: "search_only",
    decision: "allowed",
    checkedAt: CHECKED,
    internalRateLimit: "fail-closed probe before use",
    adapter: "searxng",
  },
  {
    id: "search-browser",
    name: "Live web via browser",
    entityTypes: ["person", "company", "business", "investor", "accelerator", "job", "signal"],
    sourceKind: "browser_only",
    accessMode: "browser",
    decision: "allowed",
    checkedAt: CHECKED,
    internalRateLimit: "per-domain serialization, concurrency 1",
    adapter: "agentic-browser",
    notes: "Last-mile only; never the default when HTTP/structured suffices",
  },
  {
    id: "search-paid-serp",
    name: "Paid SERP",
    entityTypes: ["person", "company", "business", "investor", "accelerator", "job", "signal"],
    sourceKind: "search",
    accessMode: "search_only",
    decision: "needs_key",
    requiresKey: true,
    checkedAt: CHECKED,
    adapter: "paid-serp",
  },

  // ---- Entity-class structured sources ----
  {
    id: "db-indexed",
    name: "Stored canonical graph",
    entityTypes: ["person", "company", "business", "investor", "accelerator", "job", "signal"],
    sourceKind: "database",
    accessMode: "structured",
    decision: "allowed",
    checkedAt: CHECKED,
    adapter: "indexed-db",
    notes: "Our own compounding research graph; always tried first",
  },
  {
    id: "db-osm",
    name: "OpenStreetMap places",
    entityTypes: ["business"],
    sourceKind: "government",
    accessMode: "structured",
    decision: "allowed",
    checkedAt: CHECKED,
    endpoint: "Overpass API",
    internalRateLimit: "1 req/s, tiered budget",
    attributionRequired: true,
    attributionText: "© OpenStreetMap contributors",
    adapter: "osm-local",
  },
  {
    id: "api-foursquare",
    name: "Foursquare Places",
    entityTypes: ["business"],
    sourceKind: "public_api",
    accessMode: "structured",
    decision: "needs_key",
    requiresKey: true,
    checkedAt: CHECKED,
    adapter: "foursquare",
  },
  {
    id: "api-geoapify",
    name: "Geoapify Places",
    entityTypes: ["business"],
    sourceKind: "public_api",
    accessMode: "structured",
    decision: "needs_key",
    requiresKey: true,
    checkedAt: CHECKED,
    adapter: "geoapify",
  },
  {
    id: "db-company-registry",
    name: "Company registry datasets",
    entityTypes: ["company"],
    sourceKind: "database",
    accessMode: "structured",
    decision: "allowed",
    checkedAt: CHECKED,
    adapter: "company-registry",
  },
  {
    id: "community-web",
    name: "Public community/news sources (Reddit RSS, HN, StackExchange, Dev.to, Fediverse, gov notices)",
    entityTypes: ["signal", "company", "person"],
    sourceKind: "community",
    accessMode: "http",
    decision: "allowed",
    checkedAt: CHECKED,
    internalRateLimit: "jittered spacing; stop after first 429",
    adapter: "searxng",
  },
  {
    id: "web-official-sites",
    name: "Official sites (team/about/careers/contact pages)",
    entityTypes: ["person", "company", "business", "investor", "accelerator"],
    sourceKind: "official_site",
    accessMode: "http",
    decision: "allowed",
    checkedAt: CHECKED,
    adapter: "direct-http",
    notes: "HTTP first, browser only when rendering is required",
  },

  // ---- Explicit refusals (never contact) ----
  ...[
    ["linkedin", "LinkedIn", "terms forbid automated access"],
    ["indeed", "Indeed", "terms forbid automated access"],
    ["glassdoor", "Glassdoor", "terms forbid automated access"],
    ["bamboohr", "BambooHR", "no documented public feed"],
    ["breezyhr", "Breezy HR", "no documented public feed"],
    ["jazzhr", "JazzHR", "no documented public feed"],
    ["rippling", "Rippling", "API terms could not be cleared for automated reading"],
    ["icims", "iCIMS", "no documented public feed"],
    ["oracle-taleo", "Oracle / Taleo", "no documented public feed"],
    ["ukg", "UKG", "no documented public feed"],
    ["jobvite", "Jobvite", "no documented public feed"],
  ].map(([id, name, reason]) => ({
    id: `refuse-${id}`,
    name,
    entityTypes: ["job", "company", "person"] as SourceEntity[],
    sourceKind: "official_site" as SourceKind,
    accessMode: "disabled" as AccessMode,
    decision: "disabled" as SourceDecision,
    decisionReason: reason,
    checkedAt: CHECKED,
    notes: "Search-engine discovery may still surface a posting URL, but we never contact the host to crawl it",
  })),
];

const BY_ID = new Map(SOURCE_REGISTRY.map((s) => [s.id, s]));

export function sourceById(id: string): SourceDefinition | undefined {
  return BY_ID.get(id);
}

export function sourcesForEntity(entity: SourceEntity): SourceDefinition[] {
  return SOURCE_REGISTRY.filter((s) => s.entityTypes.includes(entity));
}

/** Runnable = allowed, or needs_key with credentials configured by the caller. */
export function isSourceRunnable(def: SourceDefinition, hasKey = false): boolean {
  if (def.decision === "allowed") return true;
  if (def.decision === "needs_key") return hasKey;
  return false;
}

export function runnableSourceIdsForEntity(entity: SourceEntity, hasKey = false): string[] {
  return sourcesForEntity(entity)
    .filter((s) => isSourceRunnable(s, hasKey))
    .map((s) => s.id);
}

/** Hosts we must never contact, with reasons — enforced by the network layer. */
export const NEVER_CONTACT_HOSTS: ReadonlyMap<string, string> = new Map(
  SOURCE_REGISTRY.filter((s) => s.decision === "disabled").map((s) => [s.id.replace("refuse-", ""), s.decisionReason ?? "refused"]),
);

const NEVER_CONTACT_SUFFIXES = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "bamboohr.com",
  "breezy.hr",
  "jazzhr.com",
  "rippling.com",
  "icims.com",
  "taleo.net",
  "ukg.com",
  "jobvite.com",
];

export function isNeverContactHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return NEVER_CONTACT_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}
