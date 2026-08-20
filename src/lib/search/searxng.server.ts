import type { Lead } from "../scoring";
import { AsyncLocalStorage } from "node:async_hooks";
import { URL_BLOCKLIST } from "./query-expander";

export type SearxngResult = {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  /**
   * The time_range the query ran under. SERP results almost never carry a
   * publishedDate, so social leads were being hard-dropped downstream as
   * "undated" — a LinkedIn dork returning 60 rows yielded 1 lead. But the
   * engine already constrained the query to this window, so the result IS
   * recent by construction. We record the window rather than inventing a
   * timestamp we do not actually know.
   */
  freshnessWindow?: string;
};

const MAX_QUERIES_PER_SEARCH = 8;

// Task 4.1 — resilience knobs. A single free SearXNG's upstream engines
// (Google CSE / Brave / Startpage) rate-limit fast, especially on site: dorks,
// and when suspended SearXNG returns HTTP 200 with an EMPTY result list rather
// than an error. So "silently return empty on first failure" is the real
// failure mode we must fix: we retry with exponential backoff on both hard
// failures (non-ok / throw) AND soft failures (200-but-zero-results), and we
// rotate which engine group each query targets so one provider's suspension
// degrades coverage gracefully instead of zeroing the whole batch.
const SEARXNG_QUERY_RETRIES = 1; // keep light — rate-limited instances waste wall-clock
const SEARXNG_RETRY_BASE_MS = 400;
const SEARXNG_INTER_QUERY_MS = 120; // fallback if jitter disabled
/** Abort remaining queries after this many consecutive errors/empties. */
const SEARXNG_CIRCUIT_BREAK = 2;

// Engine groups the app can target explicitly via SearXNG's `engines` param.
// site:-capable engines lead for dork queries; the broad group is for general
// keyword queries. Overridable with SEARXNG_ENGINES (comma-separated) which,
// if set, is used verbatim for every query (rotation disabled).
// site: dorks only work on the consumer engines, and those are exactly the ones
// that suspend first — so bing (the most tolerant of the four) is included and
// the list is rotated per query in enginesForQuery().
const SITE_CAPABLE_ENGINES = ["google", "brave", "startpage", "qwant", "bing"];
// Broad queries get the independent indexes too (presearch/yep/crowdview/mwmbl).
// They return less, but they keep returning it when Google and Brave have cut
// us off — which is the difference between "fewer leads" and "no leads".
const BROAD_ENGINES = [
  "bing",
  "google",
  "brave",
  "startpage",
  "qwant",
  "duckduckgo",
  "mojeek",
  "yahoo",
  "presearch",
  "yep",
  "crowdview",
];

function isSiteQuery(q: string): boolean {
  return /\b(?:site|intitle|inurl):/i.test(q);
}

/** Rotate engine subsets across queries to spread load off any single provider. */
function enginesForQuery(q: string, index: number): string {
  const override = process.env.SEARXNG_ENGINES;
  if (override && override.trim()) return override.trim();

  // Pinning engines is OFF by default, because it was the direct cause of the
  // social layer returning nothing. Measured 2026-08-02, same dork, same box:
  //
  //   no engines param                        -> 59 results
  //   engines=google,brave,startpage,qwant,bing -> 0 results, with
  //     brave "Suspended: too many requests", qwant "Suspended: access denied",
  //     startpage "Suspended: CAPTCHA"
  //
  // Naming engines forces the query onto exactly the providers that suspend
  // first and excludes the ones the local instance actually has working. The
  // rotation was meant to spread load; in practice it guaranteed zeroes. Let
  // SearXNG pick from its own configured, healthy set instead — and keep the
  // pools below reachable through SEARXNG_ENGINES for deliberate tuning.
  void isSiteQuery;
  void index;
  void SITE_CAPABLE_ENGINES;
  void BROAD_ENGINES;
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function detectPlatformFromUrl(url: string): { source: string; platform: string } {
  const u = url.toLowerCase();
  if (u.includes("reddit.com")) return { source: "reddit", platform: "Reddit Post" };
  if (u.includes("linkedin.com/posts") || u.includes("linkedin.com/feed/update")) {
    return { source: "linkedin", platform: "LinkedIn Post" };
  }
  if (u.includes("linkedin.com/in/")) return { source: "linkedin", platform: "LinkedIn Profile" };
  if (u.includes("linkedin.com/jobs")) return { source: "linkedin", platform: "LinkedIn Jobs" };
  if (u.includes("twitter.com") || u.includes("x.com"))
    return { source: "twitter", platform: "Twitter/X" };
  if (u.includes("news.ycombinator.com")) return { source: "hn", platform: "Hacker News" };
  if (u.includes("instagram.com")) return { source: "instagram", platform: "Instagram" };
  if (u.includes("facebook.com")) return { source: "facebook", platform: "Facebook" };
  if (u.includes("bsky.app")) return { source: "bluesky", platform: "Bluesky" };
  if (u.includes("tiktok.com")) return { source: "tiktok", platform: "TikTok" };
  if (u.includes("youtube.com") || u.includes("youtu.be")) {
    return { source: "youtube", platform: "YouTube" };
  }
  if (u.includes("threads.net")) return { source: "threads", platform: "Threads" };
  if (u.includes("g2.com") || u.includes("capterra.com")) {
    return { source: "reviews", platform: "Software Reviews" };
  }
  if (u.includes("chat.whatsapp.com"))
    return { source: "whatsapp", platform: "WhatsApp Group (public invite)" };
  if (u.includes("disboard.org") || u.includes("top.gg"))
    return { source: "discord", platform: "Discord Server Listing" };
  if (u.includes("github.com")) return { source: "github", platform: "GitHub" };
  if (u.includes("fiverr.com")) return { source: "fiverr", platform: "Fiverr (public)" };
  if (u.includes("quora.com")) return { source: "quora", platform: "Quora" };
  return { source: "searxng", platform: "Web Search" };
}

type SearxngRawResult = { url?: string; title?: string; content?: string; publishedDate?: string };

// =====================================================================
// Query cache + global budget — the fix for "sometimes 20 leads, sometimes 1"
//
// Measured 2026-07-29 against a healthy local SearXNG: three consecutive
// searches returned 28 → 7 → 7 results as the free upstream engines suspended
// themselves one by one ("google cse: too many requests", "brave: Suspended",
// "duckduckgo: access denied"). The cause is volume, not configuration — a
// single Discover run fans out ~8 queries across ~10 SearXNG-backed sources,
// so 40–80 upstream queries land in a few seconds and Google/Brave/DDG cut us
// off. The NEXT search then sees suspended engines and returns almost nothing.
//
// Two mechanisms fix that, and both matter:
//   1. CACHE — sources ask for heavily overlapping dorks, and the same user
//      re-runs the same search. Serving a repeat from cache costs the upstream
//      engines nothing.
//   2. BUDGET — a hard ceiling on live upstream queries per rolling minute, so
//      one greedy run can't poison the next five. Exceeding it degrades to
//      cache-only rather than firing queries that will come back empty anyway.
// =====================================================================

/** Results stay useful far longer than they stay fresh; leads are re-scored anyway. */
const SEARXNG_CACHE_TTL_MS = 10 * 60_000;
/**
 * How long a cached result stays usable when we CANNOT go upstream.
 *
 * Past the fresh TTL an entry is no longer good enough to serve by default, but
 * it is far better than the alternative when the budget is spent or the engines
 * are suspended. site: dorks are not date-filtered anyway (the engines ignore
 * time_range on them), so a 45-minute-old copy of
 * `site:linkedin.com/posts "looking for a designer"` is materially the same
 * result set — and serving it costs the upstream engines nothing.
 */
const SEARXNG_CACHE_STALE_MS = 45 * 60_000;
/**
 * Negative cache. A dork that just came back empty is empty because the engines
 * are suspended, not because the phrase has no matches — measured: the same
 * dork returns 59 rows once they recover. Re-asking inside this window spends a
 * global slot on a guaranteed zero and starves the queries that could succeed,
 * which is precisely how back-to-back searches 2 and 3 ended up with no social.
 */
const SEARXNG_EMPTY_TTL_MS = 90_000;
const SEARXNG_CACHE_MAX = 400;
/**
 * Live upstream queries allowed per rolling minute.
 *
 * Was 18, which was calibrated against the OLD failure mode: we pinned every
 * query to google/brave/startpage/qwant/bing, and those suspend almost
 * immediately. With engine pinning removed the local instance spreads across
 * its own healthy set, and it is far more tolerant than that number assumed —
 * measured 2026-08-02: 32 concurrent site: dorks returned 32/32 successes,
 * 1608 rows, zero empties and zero errors, in 64 seconds.
 *
 * 40 keeps meaningful headroom over the measured 32 while no longer being the
 * binding constraint that starved the social sources.
 */
const SEARXNG_QUERIES_PER_MIN = 30;
/**
 * The ceiling above is split into two INDEPENDENT rolling windows.
 *
 * A single shared bucket was the reason searches 2 and 3 returned zero social.
 * The old "social reserve" only held capacity back from non-social within one
 * snapshot of the window; it reserved nothing across searches. Search 1 spends
 * ~12 non-social + ~10 social slots, and by search 3 the shared minute is full
 * — of the FIRST search's traffic — so every social dork is refused.
 *
 * With separate windows, non-social volume can never consume social capacity.
 * The totals are unchanged (14 + 16 = 30), so this adds no upstream load; it
 * only decides who is allowed to spend it.
 */
const SOCIAL_QUERIES_PER_MIN = 18;
const OTHER_QUERIES_PER_MIN = 12;
/**
 * Slots a search may take for social ON TOP of the window above, and only while
 * it has landed no social query at all.
 *
 * Windows alone cannot fix the reported bug. Each search wants ~10 social
 * dorks, so three searches in one minute want 30 against a ceiling of 12 — the
 * third is refused everything and reports zero social however the ceiling is
 * arranged. A small floor that ONLY an otherwise-starved request can draw on
 * makes "this search found no social leads because an earlier search used the
 * minute" impossible by construction.
 *
 * 12 + 15 + 3 = 30, i.e. the measured ceiling is still the hard maximum.
 */
const SOCIAL_STARVATION_FLOOR = 3;
/** Allocation for ONE Discover run — the unit that actually matters for fairness. */
const SEARXNG_QUERIES_PER_REQUEST = 24;

const queryCache = new Map<string, { at: number; results: SearxngRawResult[] }>();

function cacheKey(q: string, timeRange: string): string {
  return `${timeRange}::${q.toLowerCase().trim()}`;
}

type CacheRead = { results: SearxngRawResult[]; stale: boolean };

/**
 * Fresh hits and stale hits are both returned; the caller decides. A stale hit
 * is only good enough once we've been refused a live query, so it must not
 * short-circuit a query we are still allowed to make.
 */
function readCache(q: string, timeRange: string): CacheRead | null {
  const key = cacheKey(q, timeRange);
  const hit = queryCache.get(key);
  if (!hit) return null;
  const age = Date.now() - hit.at;

  if (hit.results.length === 0) {
    if (age <= SEARXNG_EMPTY_TTL_MS) return { results: [], stale: false };
    queryCache.delete(key);
    return null;
  }
  if (age <= SEARXNG_CACHE_TTL_MS) return { results: hit.results, stale: false };
  if (age <= SEARXNG_CACHE_STALE_MS) return { results: hit.results, stale: true };
  queryCache.delete(key);
  return null;
}

function writeCache(q: string, timeRange: string, results: SearxngRawResult[]): void {
  if (queryCache.size >= SEARXNG_CACHE_MAX) {
    // Cheap eviction: drop the oldest quarter rather than tracking an LRU.
    const sorted = [...queryCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of sorted.slice(0, Math.floor(SEARXNG_CACHE_MAX / 4))) queryCache.delete(k);
  }
  queryCache.set(cacheKey(q, timeRange), { at: Date.now(), results });
}

/** True when a live upstream query is still within the rolling-minute budget. */
/**
 * Per-source quotas.
 *
 * The budget used to be one flat bucket, first-come-first-served. Consumers
 * ask for ~45 queries against a ceiling of 18, so whichever source happened to
 * run first drained it — measured: `decisionmakers` alone requests 8 — and the
 * social dorks, which run late, got nothing. A LinkedIn dork that returns 60
 * results standalone contributed 0 leads to a real search.
 *
 * Quotas cap each source instead of racing them, so social always gets its
 * share. The numbers sum above the global ceiling on purpose: the ceiling
 * still applies, the quotas only stop any one source from monopolising it.
 */
const SOURCE_QUOTAS: Record<string, number> = {
  // Social platforms first — this is the class the product was missing.
  linkedin: 4,
  twitter: 3,
  instagram: 3,
  facebook: 3,
  threads: 2,
  quora: 3,
  substack: 2,
  discord: 2,
  youtube: 1,
  // Web/other
  webboolean: 3,
  decisionmakers: 2,
  fiverr: 1,
  startups: 1,
};
const DEFAULT_QUOTA = 2;

/** key -> timestamps, so each source's quota rolls on the same 60s window. */
const perSourceTimestamps = new Map<string, number[]>();

// ── Per-request budget ──────────────────────────────────────────────────────
//
// A rolling global minute is the wrong unit for fairness. Two searches run
// back to back share one window, so the second gets whatever the first left —
// measured: `marketing` ran within a minute of `writer` and skipped the social
// dorks entirely (151 leads, zero social), while `writer` got 15 social leads.
// Every search deserves its own allocation.
//
// So: quotas are now scoped to the request via AsyncLocalStorage, which
// survives the async fan-out without threading a parameter through a dozen
// source functions. The global rolling window stays, but only as protection
// for the UPSTREAM engines (they suspend around 20-25 queries/min) — and it
// now WAITS for a slot instead of hard-failing, turning "later searches get
// nothing" into "later searches take slightly longer".
type RequestBudget = {
  total: number;
  used: number;
  /**
   * Spend tracked SEPARATELY per class.
   *
   * A single shared counter was the reason the non-social SearXNG sources
   * reported nothing. The non-social cap was `total - REQUEST_SOCIAL_RESERVE`
   * (24 - 12 = 12) but it was compared against `used`, which social spending
   * also incremented. Measured 2026-08-02 on `need a design`: the social dorks
   * spent 12, `used` hit the non-social cap, and every later non-social query
   * was refused on arrival — the window froze at `other 5/15` while social sat
   * at 12/12, and webboolean / decisionmakers / youtube / fiverr / discord all
   * returned zero without ever asking upstream.
   */
  usedByClass: Record<BudgetClass, number>;
  perSource: Map<string, number>;
  /** Live social queries this run has landed — drives the starvation floor. */
  socialLive: number;
};
const budgetStore = new AsyncLocalStorage<RequestBudget>();

/** Wrap one Discover run so its SearXNG quotas are its own. */
export function withSearxngBudget<T>(
  fn: () => Promise<T>,
  total = SEARXNG_QUERIES_PER_REQUEST,
): T | Promise<T> {
  return budgetStore.run(
    { total, used: 0, usedByClass: { social: 0, other: 0 }, perSource: new Map(), socialLive: 0 },
    fn,
  );
}

/**
 * Longest we will wait for a global slot before giving up on a query.
 *
 * 2.5s was too short: three back-to-back searches fill the rolling minute, and
 * the later ones gave up instantly and returned no social at all. Sources get a
 * 28s budget, so waiting up to 9s for a slot is affordable and turns "the
 * second search silently loses social" into "the second search is a bit
 * slower" — which is the entire point of waiting rather than failing.
 */
const SOCIAL_WAIT_MAX_MS = 9000;
/**
 * Non-social sources wait less. They have plenty of non-SearXNG fallbacks, and
 * every second one spends blocked is a second the social dorks — which have
 * none — lose off the 28s source budget.
 */
const OTHER_WAIT_MAX_MS = 4000;
const GLOBAL_WAIT_STEP_MS = 250;

/**
 * Social platforms get their own window, globally and per request.
 *
 * Fair quotas alone did not survive ordering: the non-social SearXNG sources
 * are registered earlier in the fan-out, so they claimed every slot and the
 * social dorks arrived to an empty budget — measured as 0 social leads on the
 * 2nd and 3rd back-to-back searches.
 */
const SOCIAL_KEYS = new Set([
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "quora",
  "substack",
]);

type BudgetClass = "social" | "other";
const globalWindows: Record<BudgetClass, number[]> = { social: [], other: [] };
const CLASS_LIMITS: Record<BudgetClass, number> = {
  social: SOCIAL_QUERIES_PER_MIN,
  other: OTHER_QUERIES_PER_MIN,
};

/**
 * What ONE Discover run may spend per class. Independent of each other, so a
 * social-heavy run can no longer refuse the web sources (or the reverse).
 * Social gets the larger share because it is the class with no fallback: a
 * LinkedIn buyer post is only reachable through a dork, whereas the job boards
 * and feeds reach their data without touching SearXNG at all.
 */
const REQUEST_CLASS_CAPS: Record<BudgetClass, number> = { social: 18, other: 8 };

function classOf(sourceKey: string): BudgetClass {
  return SOCIAL_KEYS.has(sourceKey) ? "social" : "other";
}

function pruneWindow(cls: BudgetClass): number[] {
  const now = Date.now();
  globalWindows[cls] = globalWindows[cls].filter((t) => now - t < 60_000);
  return globalWindows[cls];
}

function globalSlotFree(cls: BudgetClass): boolean {
  return pruneWindow(cls).length < CLASS_LIMITS[cls];
}

/**
 * Last resort for a request that would otherwise report zero social leads.
 * Bounded twice: by the floor itself, and by the overall measured ceiling, so
 * it can never push upstream load past what the engines tolerate.
 */
function starvationSlotFree(req: RequestBudget | undefined): boolean {
  if (!req || req.socialLive >= SOCIAL_STARVATION_FLOOR) return false;
  const total = pruneWindow("social").length + pruneWindow("other").length;
  return total < SEARXNG_QUERIES_PER_MIN;
}

/**
 * Reserve one live upstream query.
 *
 * Two independent gates, and both must pass:
 *   1. the REQUEST's own allocation (fairness between sources in this search)
 *   2. a global slot in this source's class (protection for upstream engines)
 */
async function takeBudget(sourceKey = "default"): Promise<boolean> {
  const req = budgetStore.getStore();
  const cls = classOf(sourceKey);
  let reserved = false;

  if (req) {
    const cap = REQUEST_CLASS_CAPS[cls];
    const quota = SOURCE_QUOTAS[sourceKey] ?? DEFAULT_QUOTA;
    const mine = req.perSource.get(sourceKey) ?? 0;
    if (req.usedByClass[cls] >= cap || req.used >= req.total || mine >= quota) return false;
    // Claim the slot BEFORE the await below. Ten platforms fan out at once, so
    // counting only after the wait let all ten past a cap of one and blew the
    // allocation this is here to enforce.
    req.used++;
    req.usedByClass[cls]++;
    req.perSource.set(sourceKey, mine + 1);
    reserved = true;
  } else {
    // No request scope (scripts, warmers). Fall back to the rolling per-source
    // window so an unscoped caller still cannot monopolise a platform.
    const now = Date.now();
    const quota = SOURCE_QUOTAS[sourceKey] ?? DEFAULT_QUOTA;
    const mine = (perSourceTimestamps.get(sourceKey) ?? []).filter((t) => now - t < 60_000);
    if (mine.length >= quota) return false;
  }

  const release = () => {
    if (!req || !reserved) return;
    req.used--;
    req.usedByClass[cls] = Math.max(0, req.usedByClass[cls] - 1);
    req.perSource.set(sourceKey, Math.max(0, (req.perSource.get(sourceKey) ?? 1) - 1));
  };

  // Wait briefly for a global slot rather than failing outright.
  const maxWait = cls === "social" ? SOCIAL_WAIT_MAX_MS : OTHER_WAIT_MAX_MS;
  let waited = 0;
  while (!globalSlotFree(cls)) {
    // A starved search doesn't wait — the whole point of the floor is that it
    // gets its first few social queries even when the minute belongs to
    // somebody else.
    if (cls === "social" && starvationSlotFree(req)) break;
    if (waited >= maxWait) {
      release();
      return false;
    }
    await sleep(GLOBAL_WAIT_STEP_MS);
    waited += GLOBAL_WAIT_STEP_MS;
  }

  const now = Date.now();
  globalWindows[cls].push(now);
  if (req && cls === "social") req.socialLive++;
  if (!req) {
    const mine = (perSourceTimestamps.get(sourceKey) ?? []).filter((t) => now - t < 60_000);
    mine.push(now);
    perSourceTimestamps.set(sourceKey, mine);
  }
  return true;
}

/** Observability: how much of the budget is left, for the debug payload. */
export function searxngBudgetState(): {
  used: number;
  limit: number;
  cached: number;
  social: { used: number; limit: number };
  other: { used: number; limit: number };
} {
  const social = pruneWindow("social").length;
  const other = pruneWindow("other").length;
  return {
    used: social + other,
    limit: SEARXNG_QUERIES_PER_MIN,
    cached: queryCache.size,
    social: { used: social, limit: CLASS_LIMITS.social },
    other: { used: other, limit: CLASS_LIMITS.other },
  };
}

/**
 * Ceiling on dorks IN FLIGHT at once, which is a different lever from the
 * per-minute budget and turned out to be the one that mattered.
 *
 * Every dork this instance receives fans out to ~12 upstream engines, so N
 * concurrent dorks means 12N simultaneous outgoing requests. Measured
 * 2026-08-02, 40 concurrent dorks: 18 ok / 10 empty / 12 error, p50 48s, p90
 * 60s, with brave/google/qwant/mojeek/presearch/startpage all reporting
 * "Suspended: too many requests" or CAPTCHA. Firing everything at once is what
 * both suspends the engines AND pushes latency past the source budget, so the
 * successful dorks get discarded too — the burst was losing twice.
 *
 * Holding the fan-out narrow keeps each dork inside its 6s engine timeout and
 * keeps per-engine request rate under the limits that trigger a suspension.
 */
const SEARXNG_MAX_INFLIGHT = Number(process.env.SEARXNG_MAX_INFLIGHT ?? 3);
let inflight = 0;
const inflightWaiters: Array<() => void> = [];

async function acquireInflight(): Promise<void> {
  if (inflight < SEARXNG_MAX_INFLIGHT) {
    inflight++;
    return;
  }
  await new Promise<void>((resolve) => inflightWaiters.push(resolve));
  inflight++;
}

function releaseInflight(): void {
  inflight--;
  inflightWaiters.shift()?.();
}

/**
 * Run ONE query against SearXNG with retry-with-backoff. Returns the raw
 * results (possibly empty). Retries on hard failure (throw / non-ok) and on
 * soft failure (HTTP 200 but zero results, i.e. upstream engines suspended).
 */
async function querySearxngOnce(
  baseUrl: string,
  q: string,
  index: number,
  timeRange: string,
  sourceKey: string,
): Promise<{
  results: SearxngRawResult[];
  status: "ok" | "empty" | "error" | "cached" | "budget";
}> {
  // 1) Cache first — costs the upstream engines nothing. A fresh hit (or a
  //    recent empty, which means "the engines are suspended for this dork")
  //    answers immediately; a stale hit is held back in case we're allowed to
  //    ask for real.
  const cached = readCache(q, timeRange);
  if (cached && !cached.stale) {
    return { results: cached.results, status: cached.results.length ? "cached" : "empty" };
  }

  // 2) Budget. Firing past it just earns a suspension that harms the NEXT
  //    search too, so we stop instead and report it honestly — but a stale copy
  //    of this exact dork is free, and it is the difference between "the third
  //    search has no social leads" and "the third search has slightly older
  //    ones".
  if (!(await takeBudget(sourceKey))) {
    if (cached) return { results: cached.results, status: "cached" };
    return { results: [], status: "budget" };
  }

  const { resilientFetch } = await import("./http-fetch.server");
  const engines = enginesForQuery(q, index);
  const localSearx =
    /127\.0\.0\.1|localhost/i.test(baseUrl) || process.env.SEARXNG_LOCAL_FETCH === "1";

  let lastStatus: "empty" | "error" = "error";
  /** Distinguishes "no matches" from "the engines could not answer". */
  let enginesFailed = false;
  for (let attempt = 0; attempt <= SEARXNG_QUERY_RETRIES; attempt++) {
    if (attempt > 0) await sleep(SEARXNG_RETRY_BASE_MS * 2 ** (attempt - 1));
    try {
      const params = new URLSearchParams({
        q,
        format: "json",
        categories: "general",
        language: "en",
      });
      // A time_range on a site: dork returns NOTHING — measured 2026-08-02:
      // `site:linkedin.com/posts "looking for a designer"` gives 59 results
      // unfiltered and 0 with time_range=day or week. Engines do not date-filter
      // site-scoped queries. Callers that need recency must pass a range and
      // accept fewer sources; callers dorking a platform must omit it.
      if (timeRange) params.set("time_range", timeRange);
      if (engines) params.set("engines", engines);
      const url = `${baseUrl.replace(/\/$/, "")}/search?${params}`;
      await acquireInflight();
      let res: Response;
      try {
        // Local SearXNG must not go through Chrome-header resilientFetch —
        // under Discover fan-out that path threw connection errors that looked
        // identical to "container not running" and wiped socialdorks to 0.
        res = localSearx
          ? await fetch(url, {
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(12_000),
            })
          : await resilientFetch(url, { headers: { Accept: "application/json" } });
      } finally {
        releaseInflight();
      }
      if (!res.ok) {
        lastStatus = "error";
        continue; // retry
      }
      const data = (await res.json()) as {
        results?: SearxngRawResult[];
        unresponsive_engines?: unknown[];
      };
      const results = data?.results ?? [];
      if (results.length > 0) {
        writeCache(q, timeRange, results);
        return { results, status: "ok" };
      }
      // Zero results has two very different causes and they must not be
      // conflated: the phrase genuinely has no matches, or the engines that
      // could have answered were suspended/timed out. SearXNG tells us which
      // via unresponsive_engines, and getting this wrong is expensive — an
      // engine failure cached as "empty" makes the next search skip the dork
      // on purpose, which is how one bad minute turned into a run of searches
      // with no social leads at all.
      enginesFailed = (data.unresponsive_engines?.length ?? 0) > 0;
      lastStatus = enginesFailed ? "error" : "empty";
    } catch {
      lastStatus = "error";
      enginesFailed = true;
    }
  }

  // Upstream gave us nothing. An older copy beats an empty page.
  if (cached) return { results: cached.results, status: "cached" };
  // Only remember a miss that was really a miss. A dork the engines refused
  // stays uncached so the next search is free to ask again.
  if (lastStatus === "empty" && !enginesFailed) writeCache(q, timeRange, []);
  return { results: [], status: lastStatus };
}

/** The host a `site:` dork asked for, or null for an unscoped query. */
function dorkedHost(q: string): string | null {
  const m = /\bsite:([^\s")]+)/i.exec(q);
  if (!m) return null;
  return m[1].toLowerCase().replace(/^www\./, "");
}

/**
 * True when `url` is on `want`, which may include a path prefix
 * (`linkedin.com/posts`). Subdomains count — a site:reddit.com dork should
 * accept old.reddit.com — but a suffix match must not let "notlinkedin.com"
 * through, hence the boundary check on the character before the host.
 */
function onHost(url: string, want: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const [wantHost, ...wantPath] = want.split("/");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== wantHost && !host.endsWith(`.${wantHost}`)) return false;
  if (!wantPath.length) return true;
  return parsed.pathname.toLowerCase().startsWith(`/${wantPath.join("/")}`);
}

export async function searchSearxng(
  queries: string[],
  maxQueries = MAX_QUERIES_PER_SEARCH,
  timeRange = "day",
  /** Quota bucket — see SOURCE_QUOTAS. Sources that omit it share "default". */
  sourceKey = "default",
): Promise<SearxngResult[]> {
  const rawBase = process.env.SEARXNG_URL;
  if (!rawBase) return [];
  // Windows Docker often binds IPv4 only; Node resolving `localhost` to ::1
  // produced connection errors that looked identical to "container not running"
  // and wiped every social dork mid-search.
  const baseUrl = rawBase.replace(/:\/\/localhost(?=[:/]|$)/i, "://127.0.0.1");
  // Vercel / serverless cannot reach a laptop Docker SearXNG. If Production still
  // has SEARXNG_URL=http://127.0.0.1:8888, every socialdork call hangs/fails and
  // Discover looks like "Freelancer-only". Skip and let SerpAPI/Tavily carry social.
  if (
    process.env.VERCEL === "1" &&
    /:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(?=[:/]|$)/i.test(baseUrl)
  ) {
    if (process.env.NODE_ENV === "development" || process.env.SCRAPIVO_DEBUG_SOURCES) {
      console.warn(
        "[searxng] skipping localhost URL on Vercel — set a public SEARXNG_URL or rely on USE_PAID_SOURCES + SerpAPI",
      );
    }
    return [];
  }

  const results: SearxngResult[] = [];
  const seen = new Set<string>();
  let okCount = 0;
  let emptyCount = 0;
  let errorCount = 0;

  const list = queries.slice(0, maxQueries);
  let consecutiveMisses = 0;
  let budgetHit = false;
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    const { results: raw, status } = await querySearxngOnce(baseUrl, q, i, timeRange, sourceKey);
    if (status === "ok" || status === "cached") {
      okCount++;
      // A cache hit proves nothing about upstream health, but it also isn't a
      // miss — resetting here keeps a run of cached queries from tripping the
      // breaker on a perfectly healthy instance.
      consecutiveMisses = 0;
    } else if (status === "budget") {
      // Out of upstream budget: stop immediately. Continuing would fire queries
      // that are guaranteed to come back empty AND deepen the suspension that
      // ruins the next search.
      budgetHit = true;
      break;
    } else if (status === "empty") {
      emptyCount++;
      consecutiveMisses++;
    } else {
      errorCount++;
      consecutiveMisses++;
    }

    const wantHost = dorkedHost(q);
    for (const r of raw) {
      const link = r.url || "";
      if (!link || seen.has(link)) continue;
      if (URL_BLOCKLIST.some((b) => link.toLowerCase().includes(b))) continue;
      // An engine that does not implement site: answers the dork anyway, with
      // rows from anywhere. Measured 2026-08-02:
      // `site:linkedin.com/posts "looking for a designer"` returned 55 rows and
      // ZERO were on linkedin.com — all of them mwmbl, which ignores the
      // operator. That noise reaches the scorer and the LLM, which is what a
      // funnel of 59 raw -> 3 shown was mostly spending itself on. If the query
      // named a host, hold the results to it.
      if (wantHost && !onHost(link, wantHost)) continue;
      seen.add(link);
      results.push({
        url: link,
        title: r.title || "",
        content: (r.content || "").slice(0, 400),
        publishedDate: r.publishedDate,
        freshnessWindow: timeRange,
      });
    }
    // Don't burn 30s+ retrying a dead SearXNG instance across every source.
    if (consecutiveMisses >= SEARXNG_CIRCUIT_BREAK && okCount === 0) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[searxng] circuit-open after ${consecutiveMisses} misses — skipping remaining ${list.length - i - 1} queries`,
        );
      }
      break;
    }
    if (i < list.length - 1 && consecutiveMisses === 0) {
      const { jitterMs } = await import("./fetch-gate.server");
      await sleep(jitterMs(800, 1600));
    } else if (i < list.length - 1) {
      await sleep(SEARXNG_INTER_QUERY_MS);
    }
  }

  // Visibility (Task 4.1 / 1.5 spirit): never fail silently. If every query
  // came back empty/errored, that's an infra signal (engines suspended), not a
  // "no leads" signal — surface it in dev logs so it's discoverable.
  if (process.env.NODE_ENV === "development" && (emptyCount > 0 || errorCount > 0 || budgetHit)) {
    const b = searxngBudgetState();
    console.warn(
      `[searxng:${sourceKey}] ${okCount} ok / ${emptyCount} empty / ${errorCount} error across ${list.length} queries` +
        ` | budget social ${b.social.used}/${b.social.limit}, other ${b.other.used}/${b.other.limit},` +
        ` ${b.cached} cached` +
        (budgetHit
          ? " — BUDGET EXHAUSTED, remaining queries skipped to protect the next search"
          : "") +
        (okCount === 0 && !budgetHit
          ? // Errors and empties mean opposite things and need opposite fixes.
            // An EMPTY 200 is the engines being suspended — wait it out. An
            // ERROR is usually the container not running at all, which reads
            // identically in the old wording ("engines likely rate-limited")
            // and sent a whole debugging session after the wrong problem while
            // every social source silently returned nothing.
            errorCount === list.length
            ? ` — every query ERRORED: SearXNG at ${baseUrl} is likely not running.` +
              ` Start it with \`docker compose up -d searxng\` and retry.`
            : " — ALL queries returned nothing (upstream engines likely rate-limited)"
          : ""),
    );
  }
  return results;
}

function authorFromLinkedInPostUrl(url: string): { name: string; profile_url: string } | null {
  const m = (url || "").match(/linkedin\.com\/posts\/([A-Za-z0-9-]+?)_/i);
  if (!m) return null;
  const slug = m[1];
  const parts = slug.split("-").filter(Boolean);
  while (parts.length > 1 && /\d/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2 || parts.length > 4) return null;
  if (
    parts.some((p) =>
      /^(services|agency|studio|labs|lab|solutions|digital|technologies|technology|consulting|consultancy|group|media|partners|ventures|holdings|systems|software|apps?|official|hq)$/i.test(
        p,
      ),
    )
  ) {
    return null;
  }
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  if (name.replace(/[^A-Za-z]/g, "").length < 3) return null;
  return { name, profile_url: `https://www.linkedin.com/in/${slug}` };
}

export function searxngResultsToLeads(
  results: SearxngResult[],
  intentBoost = 10,
): Array<Lead & { intentBoost?: number }> {
  return results.map((r) => {
    const { source, platform } = detectPlatformFromUrl(r.url);
    let author: string | undefined;
    let author_url: string | undefined;
    try {
      const u = new URL(r.url);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      const path = u.pathname;
      if (host.endsWith("reddit.com")) {
        const user = path.match(/\/(?:user|u)\/([^/?#]+)/i)?.[1];
        if (user && user.toLowerCase() !== "deleted") {
          author = user;
          author_url = `https://reddit.com/user/${user}`;
        }
      } else if (host === "twitter.com" || host === "x.com") {
        const tw = path.match(/^\/([A-Za-z0-9_]+)\/status\//);
        if (tw && !["i", "home", "search"].includes(tw[1].toLowerCase())) {
          author = `@${tw[1]}`;
          author_url = `https://x.com/${tw[1]}`;
        }
      } else if (host.endsWith("linkedin.com")) {
        const fromLi = authorFromLinkedInPostUrl(r.url);
        if (fromLi) {
          author = fromLi.name;
          author_url = fromLi.profile_url;
        } else {
          const fromTitle = r.title.match(
            /^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){1,3})\s+(?:on LinkedIn|hiring)\b/i,
          )?.[1];
          if (fromTitle && !/\b(Inc|LLC|Ltd|Labs|Services|Agency)\b/i.test(fromTitle)) {
            author = fromTitle;
          }
        }
      } else if (host.endsWith("instagram.com")) {
        const handle =
          r.content?.match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ||
          r.title?.match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ||
          r.content?.match(/\b([a-z0-9_.]{3,30}\.design)\b/i)?.[1];
        if (handle) {
          author = handle.replace(/^@/, "");
          author_url = `https://www.instagram.com/${author}/`;
        }
      }
    } catch {
      /* ignore */
    }
    return {
      source,
      platform,
      title: r.title,
      snippet: r.content,
      full_post_url: r.url,
      author,
      author_url,
      posted_at: r.publishedDate || undefined,
      // Carry the query's time window so the clients-path gate can tell
      // "we don't know when this was posted" apart from "the engine already
      // restricted this to the last day". Only the first deserves a drop.
      freshness_window: r.publishedDate ? undefined : r.freshnessWindow,
      posted_at_relative:
        r.publishedDate || !r.freshnessWindow
          ? undefined
          : r.freshnessWindow === "day"
            ? "within 24h"
            : r.freshnessWindow === "week"
              ? "within a week"
              : undefined,
      engagement: 15,
      intentBoost,
    };
  });
}
