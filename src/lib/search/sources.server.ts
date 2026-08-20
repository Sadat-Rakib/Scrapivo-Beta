import { companyCandidates, type Lead } from "../scoring";
import {
  expandQuery,
  isRecent,
  isBuyerContent,
  isRelevantToSkill,
  isStronglyRelevantToSkill,
  isWeakFamilyTerm,
  detectDecisionMaker,
  URL_BLOCKLIST,
  JOB_BOARD_MAX_AGE_DAYS,
  CLIENTS_SOCIAL_MAX_AGE_DAYS,
  ATS_COMPANY_MAX_AGE_DAYS,
  SOCIAL_MAX_AGE_DAYS,
  extractDateFromText,
  ageDays,
  type ExpandedQueries,
} from "./query-expander";
import {
  isRelevantToRoleQuery,
  JOB_BOARD_SOURCES,
  FIRST_PARTY_MARKETPLACE_SOURCES,
} from "../validation";
import { classifyIntents, shouldHardDropByLlm } from "../ai/intent-classifier.server";
import { INTENT_BOOST, SUBREDDIT_REGISTRY, type SubredditSource } from "./subreddit-registry";
import type { ClassifiedQuery } from "./query-classifier";
import {
  searchAshby,
  searchGreenhouse,
  searchLever,
  searchSmartRecruiters,
  searchWorkable,
  searchRecruitee,
} from "./ats-sources.server";
import { searchSecEdgar } from "./gov-sources.server";
import { searchNewsSignals } from "./news-signals.server";
import { searchLocalBusinesses } from "./foursquare-places.server";
import { searchOsmLocalBusinesses } from "./osm-local-businesses.server";
import {
  searchWorkAtAStartup,
  searchStartupsGallery,
  searchGitHubHiringLists,
  searchFiverrPublic,
  searchDiscordPublic,
  searchInstagramPublic,
  searchFacebookPublic,
} from "./startup-sources.server";
import { fuseCompanySignals } from "./company-fusion.server";
import { searchGitHubJobRepos } from "./github-jobs.server";
import { searchGitHubIntent, competitorsFromQuery } from "./github-intent.server";
import { searchRedditRss } from "./reddit-rss.server";
import {
  searchDiscourse,
  searchProductHunt,
  searchPublicTenders,
  searchTedTenders,
} from "./community-sources.server";
import { searchDealroomJustFounded } from "./dealroom-sources.server";
import { searchNeuronFeedStartups } from "./neuronfeed-sources.server";
import { searchStackExchange } from "./stackexchange-sources.server";
import {
  searchFreelancer,
  searchRemoteOkApi,
  searchWorkingNomads,
} from "./freelance-sources.server";
import { classifyDemand, personNoun } from "./demand-classifier";
import { paidDiscoveryEnabled } from "./paid-discovery";
export { paidDiscoveryEnabled } from "./paid-discovery";

/** Per-source wall-clock budget so one slow API can't stall Discover. */
/**
 * Public JSON APIs increasingly reject requests with no User-Agent — Bluesky's
 * AppView started 403ing bare fetches, which silently zeroed that source.
 * Anything hitting a public API should send this.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SOURCE_BUDGET_MS = 16_000;
/** Free Reddit/HN/Twitter need headroom; paid paths are opt-in separately. */
const CRITICAL_SOURCE_BUDGET_MS = 28_000;
const PAID_BACKUP_BUDGET_MS = 6_000;

function withBudget<T>(p: Promise<T>, fallback: T, ms = SOURCE_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    p.then(
      (v) => {
        if (timer) clearTimeout(timer);
        return v;
      },
      () => {
        if (timer) clearTimeout(timer);
        return fallback;
      },
    ),
    timeout,
  ]);
}

export type SearchParams = {
  classified: ClassifiedQuery;
  expanded: ExpandedQueries;
  subredditBoosts: string[];
  prefs?: {
    yearsExperience?: number | null;
    preferJunior?: boolean;
    preferMid?: boolean;
    preferSenior?: boolean;
    preferRemote?: boolean;
    maxAgeHours?: number;
    explicitExperience?: boolean;
    location?: string | null;
  };
};

export type SearchDebug = {
  rawCount: number;
  afterRelevance: number;
  afterScore: number;
  afterLlm: number;
  redditBySub?: Record<string, number>;
  sourceCounts?: Record<string, number>;
};

const REDDIT_MAX_REQUESTS = 18;

const ok = async <T>(r: Response): Promise<T | null> => (r.ok ? ((await r.json()) as T) : null);
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// ---- text cleaning -------------------------------------------------
// Many sources (HN Algolia, RSS feeds, Reddit) return content with HTML
// entities (&#x2F;, &amp;, &quot;) and stray tags. Decode + strip so the
// UI never shows "&#x2F;" or "&amp;" artifacts.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "\u201C",
  rdquo: "\u201D",
  lsquo: "\u2018",
  rsquo: "\u2019",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  middot: "\u00B7",
};
function decodeEntities(s: string): string {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return "";
      }
    })
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m);
}
function cleanText(s: string | undefined | null): string {
  if (!s) return "";
  return decodeEntities(String(s))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function cleanLead<T extends { title?: string; snippet?: string; author?: string }>(l: T): T {
  return {
    ...l,
    title: cleanText(l.title).slice(0, 200) || "Untitled",
    snippet: cleanText(l.snippet).slice(0, 600),
    author: l.author ? cleanText(l.author) : l.author,
  };
}
export { cleanText };

// Per-source intentBoost is added to the final score so platforms with
// guaranteed-buyer postings (Upwork, r/forhire [Hiring], HN Who's Hiring,
// RemoteOK) outrank generic web hits.
type SourceLead = Lead & { intentBoost?: number };

// A bare profile URL ("x.com/samavishay") is a PERSON'S PAGE, not a post —
// search engines index them constantly and they carry zero buyer intent.
function isSocialProfilePage(url: string): boolean {
  const u = (url || "").split("?")[0];
  return (
    /(?:twitter|x)\.com\/[A-Za-z0-9_]{1,15}\/?$/i.test(u) ||
    /(?:twitter|x)\.com\/[A-Za-z0-9_]{1,15}\/(?:media|with_replies|likes|highlights)\/?$/i.test(
      u,
    ) ||
    /instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/i.test(u) ||
    /tiktok\.com\/@[A-Za-z0-9_.]{1,30}\/?$/i.test(u)
  );
}

// Re-export so the old keyword utility imports keep working.
export { expandQuery, isRecent, isBuyerContent } from "./query-expander";
export function extractKeywords(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
}

// =====================================================================
// Reddit — registry-driven subreddit fan-out
// =====================================================================
const REDDIT_UA = { "user-agent": "Scrapivo:lead-discovery:v1.0 (contact: hello@scrapivo.com)" };
const REDDIT_BATCH_SIZE = 8;
const REDDIT_BATCH_DELAY_MS = 300;

function redditSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function passesFlairFilter(flair: string, title: string, entry: SubredditSource): boolean {
  const flairLower = flair.toLowerCase();
  const titleLower = title.toLowerCase();
  if (entry.requireFlair) {
    const req = entry.requireFlair.toLowerCase();
    if (!flairLower.includes(req) && !titleLower.includes(`[${req}]`)) return false;
  }
  if (entry.flairBlocklist) {
    for (const blocked of entry.flairBlocklist) {
      const b = blocked.toLowerCase();
      if (flairLower.includes(b) || titleLower.includes(`[${b}]`)) return false;
    }
  }
  return true;
}

function redditSearchQueryForEntry(entry: SubredditSource, phrase: string): string {
  if (entry.requireFlair) return `flair:${entry.requireFlair} ${phrase}`;
  if (entry.requireBuyerIntent) {
    return `${phrase} (hiring OR "looking for" OR "need a" OR "seeking")`;
  }
  return phrase;
}

function selectRedditTargets(
  boosts: string[],
): Array<{ entry: SubredditSource; maxQueries: number }> {
  const registryMap = new Map(SUBREDDIT_REGISTRY.map((e) => [e.subreddit.toLowerCase(), e]));
  const result: Array<{ entry: SubredditSource; maxQueries: number }> = [];
  const seen = new Set<string>();

  const push = (sub: string, maxQueries: number) => {
    const key = sub.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const entry = registryMap.get(key);
    if (entry) {
      result.push({ entry, maxQueries });
      return;
    }
    // Boosts from expander/classifier that aren't in the registry yet —
    // still poll them with a medium-strength synthetic entry.
    const name = sub.replace(/^r\//i, "").trim();
    if (name.length < 2) return;
    result.push({
      entry: {
        subreddit: name,
        intentSignalStrength: "medium",
        notes: "Synthetic from query boosts (not in base registry)",
      },
      maxQueries,
    });
  };

  push("forhire", 3);
  push("hiring", 3);
  for (const b of boosts) push(b, 2);
  for (const e of SUBREDDIT_REGISTRY) {
    if (e.intentSignalStrength === "very_high") push(e.subreddit, 2);
  }
  for (const e of SUBREDDIT_REGISTRY) {
    push(e.subreddit, 1);
  }
  return result;
}

// ── Task 1.4 — Reddit OAuth (app-only / client_credentials) ────────────────
// When REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are set we use an authenticated
// OAuth client (oauth.reddit.com) which is the compliant, higher-limit path;
// Reddit's non-commercial cap is 100 QPM, and our per-search REDDIT_MAX_REQUESTS
// cap (40) + batch delays keep us well under it, with resilientFetch backing
// off on 429/403. When creds are absent we fall back to the existing
// unauthenticated .json endpoint (www → old.reddit.com) so nothing regresses.
let redditToken: { value: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.expiresAt > Date.now() + 30_000) return redditToken.value;
  try {
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...REDDIT_UA,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    redditToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return redditToken.value;
  } catch {
    return null;
  }
}

async function fetchRedditJson(
  url: string,
): Promise<{ data: any | null; status: number; blocked: boolean }> {
  const { resilientFetch } = await import("./http-fetch.server");

  // Authenticated OAuth path (preferred when creds present).
  const token = await getRedditToken();
  if (token) {
    try {
      const oauthUrl = url.replace(
        /^https:\/\/(?:www|old)\.reddit\.com/,
        "https://oauth.reddit.com",
      );
      const res = await resilientFetch(oauthUrl, {
        headers: { ...REDDIT_UA, Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      if (res.ok) return { data: (await res.json()) as any, status: res.status, blocked: false };
      if (res.status === 401) redditToken = null;
      if (res.status === 403 || res.status === 429) {
        return { data: null, status: res.status, blocked: true };
      }
    } catch {
      /* fall through to unauthenticated */
    }
  }

  // Unauthenticated fallback (www → old.reddit.com).
  try {
    const res = await resilientFetch(url, {
      headers: { ...REDDIT_UA, Accept: "application/json" },
    });
    if (res.ok) return { data: (await res.json()) as any, status: res.status, blocked: false };
    if (res.status === 403) {
      const oldUrl = url.replace("www.reddit.com", "old.reddit.com");
      const res2 = await resilientFetch(oldUrl, { headers: { Accept: "application/json" } });
      if (res2.ok) return { data: (await res2.json()) as any, status: res2.status, blocked: false };
      return {
        data: null,
        status: res2.status,
        blocked: res2.status === 403 || res2.status === 429,
      };
    }
    return { data: null, status: res.status, blocked: res.status === 429 };
  } catch {
    return { data: null, status: 0, blocked: false };
  }
}

function pushRedditPost(
  p: any,
  entry: SubredditSource,
  seen: Set<string>,
  out: SourceLead[],
  maxAgeDays = 2,
): boolean {
  if (!p?.id || seen.has(p.id)) return false;
  const title = p.title || "";
  const flair = p.link_flair_text || "";
  if (!passesFlairFilter(flair, title, entry)) return false;
  const date = new Date((p.created_utc ?? 0) * 1000).toISOString();
  // Social buyer posts: prefer ≤2 days (callers pass tighter windows when needed).
  const ageDays = maxAgeDays ?? 2;
  if (!isRecent(date, ageDays)) return false;
  const body = (p.selftext || "").slice(0, 500);
  const text = `${title} ${body}`;
  if (entry.requireBuyerIntent && !isBuyerContent(text, [])) return false;
  seen.add(p.id);
  const boost = INTENT_BOOST[entry.intentSignalStrength];
  const isForhire = entry.subreddit === "forhire";
  out.push({
    source: "reddit",
    platform: redditPlatformLabel(entry),
    title: isForhire ? `[HIRING] ${title}` : title,
    snippet: body || title,
    full_post_url: `https://reddit.com${p.permalink}`,
    author: p.author && p.author !== "[deleted]" ? p.author : undefined,
    author_url:
      p.author && p.author !== "[deleted]" ? `https://reddit.com/user/${p.author}` : undefined,
    posted_at: date,
    engagement: (p.score ?? 0) + (p.num_comments ?? 0),
    is_decision_maker: detectDecisionMaker(text),
    intentBoost: boost,
  });
  return true;
}

async function fetchSubredditWithQuery(
  entry: SubredditSource,
  qx: ExpandedQueries,
  seen: Set<string>,
  searchQuery: string,
  timeRange: "hour" | "day" = "day",
  stats?: { requests: number; ok: number; empty: number; blocked: number },
): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const limit = entry.requireBuyerIntent ? 15 : 25;
  const url = `https://www.reddit.com/r/${entry.subreddit}/search.json?q=${encodeURIComponent(searchQuery)}&restrict_sr=1&sort=new&t=${timeRange}&limit=${limit}`;
  const { data, blocked } = await fetchRedditJson(url);
  if (stats) {
    stats.requests++;
    if (blocked) stats.blocked++;
    else if (!data?.data?.children?.length) stats.empty++;
    else stats.ok++;
  }
  for (const c of data?.data?.children ?? []) {
    pushRedditPost(
      c.data,
      entry,
      seen,
      out,
      timeRange === "hour" ? 1 : CLIENTS_SOCIAL_MAX_AGE_DAYS,
    );
  }
  return out;
}

/** Fresh /new.json listing — catches posts keyword search misses. */
async function fetchSubredditNew(
  entry: SubredditSource,
  seen: Set<string>,
  stats?: { requests: number; ok: number; empty: number; blocked: number },
): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const url = `https://www.reddit.com/r/${entry.subreddit}/new.json?limit=25`;
  const { data, blocked } = await fetchRedditJson(url);
  if (stats) {
    stats.requests++;
    if (blocked) stats.blocked++;
    else if (!data?.data?.children?.length) stats.empty++;
    else stats.ok++;
  }
  for (const c of data?.data?.children ?? []) {
    pushRedditPost(c.data, entry, seen, out, CLIENTS_SOCIAL_MAX_AGE_DAYS);
  }
  return out;
}

function redditPlatformLabel(entry: SubredditSource): string {
  if (entry.subreddit === "forhire") return "Reddit r/forhire [Hiring]";
  return `Reddit r/${entry.subreddit}`;
}

/**
 * Reddit discovery — FREE-FIRST (no paid keys required).
 *
 * Priority:
 *  1. PullPush — free public archive (always)
 *  2. Official .json /new + search — light parallel pass
 *  3. ScrapeCreators — ONLY when USE_PAID_SOURCES=true
 */
export async function searchReddit(
  qx: ExpandedQueries,
  subredditBoosts: string[] = [],
): Promise<{
  leads: SourceLead[];
  subCounts: Record<string, number>;
  stats: { requests: number; ok: number; empty: number; blocked: number };
}> {
  const out: SourceLead[] = [];
  const subCounts: Record<string, number> = {};
  const seen = new Set<string>();
  const targets = selectRedditTargets(subredditBoosts);
  const phrases = qx.redditBuyerQueries.slice(0, 4);
  const stats = { requests: 0, ok: 0, empty: 0, blocked: 0 };
  const hasOauth = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
  const usePaid = paidDiscoveryEnabled();
  let via = "";

  // ── 1+2) PullPush + light public JSON in parallel (never wait on paid SC) ──
  const [pp, publicBundle] = await Promise.all([
    searchPullPushReddit(qx, seen, {
      maxLeads: 40,
      maxRequests: 8,
      subredditBoosts,
    }),
    (async () => {
      const local: SourceLead[] = [];
      let requests = 0;
      // /new on top demand subs — fast and free
      for (const { entry } of targets.slice(0, 5)) {
        if (requests >= 8) break;
        const leads = await fetchSubredditNew(entry, seen, stats);
        if (leads.length) {
          subCounts[entry.subreddit] = (subCounts[entry.subreddit] ?? 0) + leads.length;
          local.push(...leads);
        }
        requests = stats.requests;
      }
      // Hour/day search on top 2 boosts
      for (const { entry } of targets.slice(0, 2)) {
        if (!phrases.length || requests >= 12) break;
        const searchQuery = redditSearchQueryForEntry(entry, phrases[0]);
        const leads = await fetchSubredditWithQuery(entry, qx, seen, searchQuery, "day", stats);
        if (leads.length) {
          subCounts[entry.subreddit] = (subCounts[entry.subreddit] ?? 0) + leads.length;
          local.push(...leads);
        }
        requests = stats.requests;
      }
      return local;
    })(),
  ]);

  if (pp.length) {
    out.push(...pp);
    subCounts["pullpush"] = (subCounts["pullpush"] ?? 0) + pp.length;
    via = "pullpush";
  }
  if (publicBundle.length) {
    out.push(...publicBundle);
    via = via ? `${via}+public-json` : hasOauth ? "oauth" : "public-json";
  }

  // ── 3) Paid ScrapeCreators — opt-in only ──
  if (usePaid && process.env.SCRAPECREATORS_KEY && out.length < 12) {
    const sc = await withBudget(
      searchScrapeCreatorsReddit(qx, seen, {
        maxLeads: 30,
        maxRequests: 6,
        subredditBoosts,
      }),
      [],
      12_000,
    );
    if (sc.length) {
      out.push(...sc);
      subCounts["scrapecreators"] = (subCounts["scrapecreators"] ?? 0) + sc.length;
      via = via ? `${via}+scrapecreators` : "scrapecreators";
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info(
      `[reddit] ${out.length} leads via ${via || "none"}` +
        (usePaid ? " (paid enabled)" : " (free-only: PullPush + public JSON)") +
        (out.length === 0 ? " — ALL queries returned nothing" : ""),
    );
  }

  try {
    const { dropRemovedPosts } = await import("./reddit-rss.server");
    const kept = await dropRemovedPosts(out);
    return { leads: kept, subCounts, stats };
  } catch {
    return { leads: out, subCounts, stats };
  }
}

function jobBoardTerms(qx: ExpandedQueries): string[] {
  const terms = qx.jobBoardTerms.slice(0, 4);
  if (terms.length) return terms;
  return [qx.role, qx.skill, `${qx.skill} developer`, `${qx.skill} freelancer`].filter(Boolean);
}

// =====================================================================
// Hacker News — monthly "Who is hiring?" + "Seeking Freelancer?" threads
// =====================================================================
export async function searchHackerNews(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const now = new Date();
  const currentMonth = months[now.getMonth()];
  const currentYear = now.getFullYear();

  try {
    const threadSearch = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`Ask HN Who is hiring ${currentMonth} ${currentYear}`)}&tags=story&hitsPerPage=5`;
    const threads = await safe(
      fetch(threadSearch).then((r) => ok<any>(r)),
      null,
    );
    const thread =
      (threads?.hits ?? []).find(
        (h: any) =>
          (h.title || "").toLowerCase().includes("who is hiring") &&
          (h.title || "").includes(String(currentYear)),
      ) || (threads?.hits ?? [])[0];

    if (thread?.objectID) {
      const commentsUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(qx.skill)}&tags=comment,story_${thread.objectID}&hitsPerPage=30`;
      const data = await safe(
        fetch(commentsUrl).then((r) => ok<any>(r)),
        null,
      );
      for (const c of data?.hits ?? []) {
        const text = (c.comment_text || "").replace(/<[^>]+>/g, " ").trim();
        if (text.length < 50) continue;
        const date =
          c.created_at || (c.created_at_i ? new Date(c.created_at_i * 1000).toISOString() : null);
        if (!isRecent(date, 7)) continue; // monthly thread, but only fresh comments
        // HN "Who is Hiring" includes both [HIRING] and [SEEKING WORK].
        // Drop seeker/profile posts; only keep real hiring comments.
        const lower = text.toLowerCase();
        if (
          lower.includes("seeking work") ||
          lower.includes("seeking position") ||
          lower.startsWith("seeking")
        )
          continue;
        if (!isRelevantToSkill(text, qx.skill)) continue;
        out.push({
          source: "hn",
          platform: `HN: Ask HN Who Is Hiring (${currentMonth} ${currentYear})`,
          title: text.slice(0, 120),
          snippet: text.slice(0, 500),
          full_post_url: `https://news.ycombinator.com/item?id=${c.objectID}`,
          author: c.author,
          author_url: `https://news.ycombinator.com/user?id=${c.author}`,
          posted_at: date || undefined,
          engagement: c.points ?? 0,
          is_decision_maker: true,
          intentBoost: 25,
        });
      }
    }
  } catch {}

  // Broad buyer intent across ALL of Hacker News, not just the hiring thread.
  //
  // This used to be a single /search call for "freelancer <skill>". /search is
  // RELEVANCE ranked over HN's entire history, so its top hits are years old,
  // and every one of them was then dropped by the 2-day freshness filter — the
  // source reported 0 leads on a query whose API returns 30 rows. /search_by_date
  // with a created_at_i floor asks the API for the recent ones directly, so the
  // freshness filter has something to keep.
  const cutoff = Math.floor(Date.now() / 1000) - SOCIAL_MAX_AGE_DAYS * 86_400;
  // Natural-language asks name the PERSON ("designer"), not the field
  // ("design"), and qx.skill holds the field — same trap the social dorks hit.
  const craft = personNoun(qx.skill, qx.role);
  const sweeps: Array<{ query: string; tags: string; label: string; boost: number }> = [
    { query: `looking for ${craft}`, tags: "comment", label: "HN comment", boost: 18 },
    { query: `need a ${craft}`, tags: "comment", label: "HN comment", boost: 18 },
    { query: `hiring ${craft}`, tags: "story", label: "HN post", boost: 15 },
    { query: `freelance ${craft}`, tags: "comment", label: "HN comment", boost: 15 },
  ];

  const sweptUrls = new Set(out.map((l) => l.full_post_url));
  const swept = await Promise.all(
    sweeps.map(async (s) => {
      const url =
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(s.query)}` +
        `&tags=${s.tags}&numericFilters=created_at_i>${cutoff}&hitsPerPage=25`;
      const data = await safe(
        fetch(url).then((r) => ok<any>(r)),
        null,
      );
      return { spec: s, hits: (data?.hits ?? []) as any[] };
    }),
  );

  for (const { spec, hits } of swept) {
    for (const h of hits) {
      const text = ((h.comment_text || h.story_text || h.title || "") as string)
        .replace(/<[^>]+>/g, " ")
        .trim();
      if (text.length < 40) continue;
      const date =
        h.created_at || (h.created_at_i ? new Date(h.created_at_i * 1000).toISOString() : null);
      if (!isRecent(date)) continue;
      if (!isBuyerContent(text, qx.negativePhrases)) continue;
      if (!isRelevantToSkill(text, qx.skill)) continue;
      const link = `https://news.ycombinator.com/item?id=${h.objectID}`;
      if (sweptUrls.has(link)) continue;
      sweptUrls.add(link);
      out.push({
        source: "hn",
        platform: `HN: ${spec.label}`,
        title: text.slice(0, 120),
        snippet: text.slice(0, 500),
        full_post_url: link,
        author: h.author,
        author_url: `https://news.ycombinator.com/user?id=${h.author}`,
        posted_at: date || undefined,
        engagement: h.points ?? 0,
        is_decision_maker: detectDecisionMaker(text),
        intentBoost: spec.boost,
      });
    }
  }
  return out;
}

// =====================================================================
// Upwork RSS — every post is a real client gig
// =====================================================================
export async function searchUpwork(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const q of jobBoardTerms(qx)) {
    try {
      const url = `https://www.upwork.com/ab/feed/jobs/rss?q=${encodeURIComponent(q)}&sort=recency&paging=0%3B10`;
      const text = await safe(
        fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; RSS reader)",
            accept: "application/rss+xml",
          },
        }).then((r) => (r.ok ? r.text() : "")),
        "",
      );
      if (!text) continue;
      const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      for (const m of items) {
        const x = m[1];
        const title =
          x.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
        const link = x.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
        const pub = x.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
        const desc = (
          x.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? ""
        )
          .replace(/<[^>]+>/g, " ")
          .slice(0, 500);
        if (!link || !title || seen.has(link)) continue;
        seen.add(link);
        // Never invent "now" — undated RSS items stay undated for freshness gates.
        let date: string | undefined;
        if (pub) {
          const parsed = new Date(pub);
          if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString();
        }
        if (date && !isRecent(date)) continue;
        const coFromDesc =
          desc
            .match(/\b(?:company|client|posted by)\s*:\s*([A-Za-z0-9][\w&.'\s-]{1,40})/i)?.[1]
            ?.trim() ||
          desc.match(/\bClient\s+([A-Za-z0-9][\w&.'\s-]{1,40}?)\s+posted/i)?.[1]?.trim() ||
          title.match(/@\s*([^|•@]+)$/)?.[1]?.trim() ||
          "";
        const company =
          coFromDesc && !/^upwork|client|anonymous|confidential$/i.test(coFromDesc)
            ? coFromDesc
            : undefined;
        const snippet = company ? `Company: ${company}\n${desc}` : desc;
        out.push({
          source: "upwork",
          platform: "Upwork Job Posting",
          title: `JOB: ${title}`,
          snippet,
          full_post_url: link,
          author: company || undefined,
          posted_at: date,
          engagement: 50,
          is_decision_maker: true,
          intentBoost: 20,
        });
      }
    } catch {
      /* continue */
    }
  }

  // RSS often blocked (410 Gone) — fall back to public Upwork job dorks via
  // SearXNG locally or hosted Google SERP on Vercel.
  if (out.length < 3) {
    const skill = qx.skill || qx.role || "";
    const dorks = [
      `site:upwork.com/jobs "${skill}" (looking OR need OR hiring)`,
      `site:upwork.com/freelance-jobs "${skill}"`,
      `site:upwork.com/jobs "~" "${skill}"`,
    ];
    try {
      const { searchSiteDorks } = await import("./serp-providers.server");
      const results = await searchSiteDorks(dorks, {
        maxPerQuery: 8,
        tbs: "qdr:w",
        timeRange: "week",
      });
      for (const r of results) {
        const link = r.url || "";
        if (!/upwork\.com\/(jobs|freelance-jobs)/i.test(link) || seen.has(link)) continue;
        if (!isBuyerContent(`${r.title} ${r.content}`, qx.negativePhrases || [])) continue;
        seen.add(link);
        const co = `${r.title} ${r.content}`
          .match(/\b(?:company|client)\s*:\s*([A-Za-z0-9][\w&.'\s-]{1,40})/i)?.[1]
          ?.trim();
        out.push({
          source: "upwork",
          platform: "Upwork Job Posting",
          title: `JOB: ${r.title}`,
          snippet: co ? `Company: ${co}\n${r.content}` : (r.content || "").slice(0, 400),
          full_post_url: link,
          author: co || undefined,
          posted_at: r.publishedDate || undefined,
          engagement: 40,
          is_decision_maker: true,
          intentBoost: 14,
          match_reasons: ["Upwork public search fallback"],
        });
      }
    } catch {
      /* continue */
    }
  }
  return out;
}

// =====================================================================
// RemoteOK — real remote jobs (tag API), recency filtered
// =====================================================================
export async function searchRemoteOK(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const term of jobBoardTerms(qx)) {
    const tag = term.replace(/\s+/g, "-").toLowerCase();
    try {
      const url = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`;
      const data = await safe(
        fetch(url, { headers: { "user-agent": "Scrapivo Job Aggregator" } }).then((r) =>
          ok<any[]>(r),
        ),
        [] as any[],
      );
      const jobs = Array.isArray(data) ? data.slice(1) : [];
      for (const j of jobs.slice(0, 25)) {
        if (!j.url || !j.position || seen.has(j.url)) continue;
        seen.add(j.url);
        const date = j.date
          ? new Date(typeof j.date === "number" ? j.date * 1000 : j.date).toISOString()
          : null;
        if (!date || !isRecent(date, JOB_BOARD_MAX_AGE_DAYS)) continue;
        const snippet = [
          `REMOTE JOB: ${j.position}`,
          j.company ? `Company: ${j.company}` : "",
          j.salary ? `Salary: ${j.salary}` : "",
          (j.description || "").replace(/<[^>]+>/g, " ").slice(0, 300),
        ]
          .filter(Boolean)
          .join("\n");
        out.push({
          source: "remoteok",
          platform: "RemoteOK",
          title: `${j.position} @ ${j.company || "Company"}`,
          snippet,
          full_post_url: j.url,
          author: j.company,
          author_url: j.company_url,
          posted_at: date,
          engagement: 60,
          is_decision_maker: true,
          intentBoost: 20,
        });
      }
    } catch {}
  }
  return out;
}

// =====================================================================
// GitHub — open hiring / paid-contributor issues (jobs/both only; not clients)
// =====================================================================
const GITHUB_RECRUITMENT_BLOCKLIST = [
  "recruitment agency",
  "staffing agency",
  "staffing firm",
  "resume scored",
  "recruiting firm",
  "talent acquisition partner",
  "it recruitment",
];

/** Real hire language in title/body — not OSS bounty spam. */
const GITHUB_HIRE_RE =
  /\b(we are hiring|we're hiring|hiring (a|an)|\[hiring\]|looking to hire|looking for (a |an )?(developer|engineer|designer|freelancer|contractor)|paid (contribution|contract|freelance)|contract (role|position)|full[- ]?time|part[- ]?time)\b/i;

export async function searchGitHub(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "Scrapivo/1.0",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const fromDate = new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0];
  const skill = qx.skill || qx.role || "";
  // Prefer open hiring issues; avoid bare label:bounty (OSS noise).
  const queries = [
    `"${skill}" ("we are hiring" OR "we're hiring" OR "[hiring]" OR "hiring a") is:issue is:open created:>${fromDate}`,
    `"${skill}" ("looking to hire" OR "looking for a developer" OR "looking for an engineer") is:issue is:open created:>${fromDate}`,
    `"${skill}" ("paid contract" OR "paid freelance" OR "contractor needed") is:issue is:open created:>${fromDate}`,
  ];
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=12`;
      const data = await safe(
        fetch(url, { headers }).then((r) => ok<any>(r)),
        null,
      );
      for (const i of data?.items ?? []) {
        const link = i.html_url as string;
        if (!link || seen.has(link)) continue;
        // Align with clients social window when reused; jobs path uses 2d.
        if (!isRecent(i.created_at, CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;
        const body = (i.body || "").replace(/<[^>]+>/g, " ").slice(0, 400);
        const text = `${i.title || ""} ${body}`;
        const lower = text.toLowerCase();
        if (GITHUB_RECRUITMENT_BLOCKLIST.some((p) => lower.includes(p))) continue;
        // Reject pure bounty/help-wanted without hire language.
        if (!GITHUB_HIRE_RE.test(text)) continue;
        if (!isBuyerContent(text, qx.negativePhrases)) continue;
        seen.add(link);
        const repoOwner = (
          link.match(/github\.com\/([^/]+)\/[^/]+\/(?:issues|pull)\//i)?.[1] || ""
        ).trim();
        const authorLogin = (i.user?.login || "").trim();
        const orgCompany =
          repoOwner &&
          authorLogin &&
          repoOwner.toLowerCase() !== authorLogin.toLowerCase() &&
          !/^(docs|examples|awesome|tutorials)$/i.test(repoOwner)
            ? repoOwner
            : undefined;
        const snippet = orgCompany ? `Company: ${orgCompany}\n${body}` : body;
        out.push({
          source: "github",
          platform: "GitHub: Hiring",
          title: i.title || "GitHub hiring issue",
          snippet,
          full_post_url: link,
          author: authorLogin || undefined,
          author_url: i.user?.html_url,
          posted_at: i.created_at,
          engagement: (i.reactions?.total_count ?? 0) + (i.comments ?? 0),
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 8,
        });
      }
    } catch {
      /* continue */
    }
  }
  return out;
}

// =====================================================================
// Bluesky — buyer-intent phrases only
// =====================================================================
export async function searchBluesky(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  // "need a design" is not an ask anyone posts — see personNoun.
  const craft = personNoun(qx.skill, qx.role);
  const terms = [
    `hiring ${craft}`,
    `looking for ${craft}`,
    `need a ${craft}`,
    `i need ${craft}`,
    `${craft} wanted`,
  ];
  for (const t of terms.slice(0, 4)) {
    try {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(t)}&limit=20&sort=latest`;
      // NOTE (verified 2026-07-29): public.api.bsky.app now 403s searchPosts
      // for UNAUTHENTICATED callers — with or without a User-Agent. This source
      // therefore returns nothing until BLUESKY_IDENTIFIER/BLUESKY_APP_PASSWORD
      // are set and a session token is attached. The UA is still correct to
      // send; it just isn't sufficient. Bluesky's Jetstream firehose
      // (wss://jetstream2.us-east.bsky.network) is public and real-time, and is
      // the better long-term path for demand detection.
      const data = await safe(
        fetch(url, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "application/json",
          },
        }).then((r) => ok<any>(r)),
        null,
      );
      for (const p of data?.posts ?? []) {
        const text = p.record?.text || "";
        const date = p.record?.createdAt || p.indexedAt || "";
        if (!isRecent(date)) continue;
        if (!isBuyerContent(text, qx.negativePhrases)) continue;
        const handle = p.author?.handle || "";
        const rkey = (p.uri || "").split("/").pop() || "";
        out.push({
          source: "bluesky",
          platform: "Bluesky",
          title: text.slice(0, 120),
          snippet: text,
          full_post_url: `https://bsky.app/profile/${handle}/post/${rkey}`,
          author: `@${handle}`,
          author_url: `https://bsky.app/profile/${handle}`,
          posted_at: date,
          engagement: (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0),
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 8,
        });
      }
    } catch {}
  }
  return out;
}

// =====================================================================
// Twitter/X — guest API with SearXNG/SerpAPI boolean fallback
// =====================================================================
const TWITTER_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7ssbmtoTGPLhAAK%2FWFwqGFDFmkLzQ5ZXBOp0pMnbad6whJUE1NtGgA";

async function getTwitterGuestToken(): Promise<string | null> {
  try {
    const res = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { guest_token?: string };
    return data.guest_token || null;
  } catch {
    return null;
  }
}

export async function searchTwitter(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  const twitterQueries = [
    `"looking for" "${qx.skill}" lang:en`,
    `"hiring" "${qx.skill}" lang:en -is:retweet`,
    `"${qx.skill} needed" OR "${qx.skill} wanted" lang:en`,
  ];

  const guestToken = await getTwitterGuestToken();
  if (guestToken) {
    for (const q of twitterQueries.slice(0, 2)) {
      try {
        const params = new URLSearchParams({
          q,
          count: "20",
          tweet_mode: "extended",
          result_type: "recent",
        });
        const res = await fetch(`https://api.twitter.com/1.1/search/tweets.json?${params}`, {
          headers: {
            Authorization: `Bearer ${TWITTER_BEARER}`,
            "x-guest-token": guestToken,
          },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { statuses?: Array<Record<string, unknown>> };
        for (const tweet of data?.statuses ?? []) {
          const tweetId = String(tweet.id_str || "");
          if (!tweetId || seen.has(tweetId)) continue;
          const text = String(tweet.full_text || tweet.text || "");
          const postedAt = tweet.created_at
            ? new Date(String(tweet.created_at)).toISOString()
            : null;
          if (!postedAt || !isRecent(postedAt)) continue;
          if (!isBuyerContent(text, qx.negativePhrases)) continue;
          seen.add(tweetId);
          const author = tweet.user as Record<string, unknown> | undefined;
          const screenName = String(author?.screen_name || "");
          out.push({
            source: "twitter",
            platform: "Twitter/X",
            title: text.slice(0, 120),
            snippet: text.slice(0, 500),
            full_post_url: `https://twitter.com/${screenName}/status/${tweetId}`,
            author: screenName ? `@${screenName}` : undefined,
            author_url: screenName ? `https://twitter.com/${screenName}` : undefined,
            posted_at: postedAt,
            engagement: Number(tweet.favorite_count ?? 0) + Number(tweet.retweet_count ?? 0),
            is_decision_maker: detectDecisionMaker(text + " " + String(author?.description || "")),
            intentBoost: 14,
          });
        }
      } catch {}
    }
  }

  // Paid SERP Twitter backup — Serper/ScrapingDog (opt-in)
  if (out.length < 3 && paidDiscoveryEnabled()) {
    try {
      const { searchGoogleSerp, hasGoogleSerpProvider } = await import("./serp-providers.server");
      if (hasGoogleSerpProvider()) {
        for (const phrase of qx.buyerPhrases.slice(0, 2)) {
          const googleQuery = `site:twitter.com OR site:x.com "${phrase}" -filter:retweets`;
          const data = await searchGoogleSerp(googleQuery, { tbs: "qdr:d", num: 10 });
          for (const r of data?.organic_results ?? []) {
            const link = r.link || "";
            if (!link || seen.has(link)) continue;
            if (!link.includes("twitter.com") && !link.includes("x.com")) continue;
            if (isSocialProfilePage(link)) continue;
            const text = `${r.title || ""} ${r.snippet || ""}`;
            if (!isBuyerContent(text, qx.negativePhrases)) continue;
            seen.add(link);
            out.push({
              source: "twitter",
              platform: "Twitter/X",
              title: r.title || "",
              snippet: (r.snippet || "").slice(0, 400),
              full_post_url: link,
              posted_at: undefined,
              engagement: 10,
              is_decision_maker: detectDecisionMaker(text),
              intentBoost: 12,
            });
          }
        }
      }
    } catch {
      /* optional */
    }
  }

  return out;
}

// =====================================================================
// LinkedIn — guest jobs API + post URLs via boolean web search
// =====================================================================
/** Parse relative SerpAPI date strings ("2 days ago", "Jan 12, 2026") when present. */
function parseSerpDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const rel = s.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith("second")
      ? n * 1_000
      : unit.startsWith("minute")
        ? n * 60_000
        : unit.startsWith("hour")
          ? n * 3_600_000
          : unit.startsWith("day")
            ? n * 86_400_000
            : unit.startsWith("week")
              ? n * 7 * 86_400_000
              : unit.startsWith("month")
                ? n * 30 * 86_400_000
                : n * 365 * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return undefined;
}

/** Prefer engine date, then snippet/title extraction. */
function resolveLeadDate(
  engineDate: string | undefined,
  title: string,
  snippet: string,
): string | undefined {
  return parseSerpDate(engineDate) || extractDateFromText(`${title} ${snippet}`);
}

const LINKEDIN_FREELANCE_BUYER_RE =
  /\b(freelancer|contractor|freelance|budget|who can|need someone to|looking to hire|willing to pay|need a (freelance|contractor|developer|designer)|seeking (a |an )?(freelance|contractor))\b/i;

export async function searchLinkedIn(
  qx: ExpandedQueries,
  opts?: { postsOnly?: boolean; location?: string | null },
): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  const postsOnly = opts?.postsOnly === true;
  const locParam =
    opts?.location && !/^(global|worldwide|anywhere)$/i.test(opts.location)
      ? opts.location
      : "Worldwide";

  // Clients / buying_signal: posts only — guest Jobs API injects off-skill titles
  // and polluted snippets ("Active LinkedIn listing for ${qx.role}").
  if (!postsOnly) {
    try {
      const jobsUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(qx.role)}&location=${encodeURIComponent(locParam)}&start=0&count=25`;
      const { resilientText } = await import("./http-fetch.server");
      const html = await resilientText(jobsUrl, {
        headers: { Accept: "application/json, text/html" },
      });
      if (html) {
        const jobIds = [...html.matchAll(/data-entity-urn="urn:li:jobPosting:(\d+)"/g)].map(
          (m) => m[1],
        );
        const titles = [
          ...html.matchAll(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/g),
        ].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
        const companies = [
          ...html.matchAll(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/g),
        ].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
        const dates = [...html.matchAll(/datetime="([^"]+)"/g)].map((m) => m[1]);

        for (let i = 0; i < Math.min(jobIds.length, 20); i++) {
          const jobId = jobIds[i];
          if (!jobId || seen.has(jobId)) continue;
          const title = titles[i] || "Open Position";
          const company = companies[i] || "Company";
          const postedAt = dates[i] ? new Date(dates[i]).toISOString() : null;
          if (!postedAt || !isRecent(postedAt)) continue;
          seen.add(jobId);
          out.push({
            source: "linkedin",
            platform: "LinkedIn Jobs",
            title: `${title} @ ${company}`,
            // Do NOT inject qx.role into the snippet — that fakes skill matches.
            snippet: `Job posting: ${title} at ${company}.`,
            full_post_url: `https://www.linkedin.com/jobs/view/${jobId}`,
            author: company,
            posted_at: postedAt,
            engagement: 40,
            is_decision_maker: true,
            intentBoost: 16,
          });
        }
      }
    } catch {}
  }

  const postQueries = qx.booleanWebQueries
    .filter((q) => q.includes("linkedin.com/posts"))
    .slice(0, 2);
  if (paidDiscoveryEnabled() && postQueries.length) {
    try {
      const { searchGoogleSerp, hasGoogleSerpProvider } = await import("./serp-providers.server");
      if (hasGoogleSerpProvider()) {
        for (const q of postQueries) {
          const data = await searchGoogleSerp(q, { tbs: "qdr:d", num: 10 });
          for (const r of data?.organic_results ?? []) {
            const link = r.link || "";
            if (!link || seen.has(link) || !link.includes("linkedin.com")) continue;
            if (!/linkedin\.com\/posts\//i.test(link) && postsOnly) continue;
            const text = `${r.title || ""} ${r.snippet || ""}`;
            if (!isBuyerContent(text, qx.negativePhrases)) continue;
            if (
              !LINKEDIN_FREELANCE_BUYER_RE.test(text) &&
              !/\b(need someone|who can|willing to pay|budget|freelancer|contractor)\b/i.test(text)
            ) {
              continue;
            }
            seen.add(link);
            const idFromUrl = identityFromSocialUrl(link, r.title || "");
            out.push({
              source: "linkedin",
              platform: "LinkedIn Post",
              title: r.title || "",
              snippet: (r.snippet || "").slice(0, 400),
              full_post_url: link,
              author: idFromUrl.author,
              author_url: idFromUrl.author_url,
              posted_at: parseSerpDate(r.date || r.published_date),
              engagement: 12,
              is_decision_maker: detectDecisionMaker(text),
              intentBoost: 15,
            });
          }
        }
      }
    } catch {
      /* optional */
    }
  }

  return out;
}

// =====================================================================
// Boolean web search — SearXNG (self-hosted) with SerpAPI fallback
// =====================================================================
export async function searchWebBoolean(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");

  // Marketplace/aggregator listing pages are SELLERS, not buyers — a page
  // titled "24 Best React Services To Buy Online" must never become a lead.
  const MARKETPLACE_TITLE_RE =
    /\bservices to buy\b|\bhire the best\b|\|\s*fiverr|fiverr pro\b|freelance services marketplace|\btop \d+ (freelancers|agencies|companies)\b|\bbest \d+\b|\d+\+?\s*best[- ]rated|best[- ]rated .{0,40} services|services near you|\d{1,3}(,\d{3})*\+?\s+.{0,40}\b(jobs|openings)\b/i;

  // Fewer SearXNG queries — when engines are rate-limited, 10×retries stalls Discover.
  const searxResults = await searchSearxng(qx.booleanWebQueries, 4, "day", "webboolean");
  for (const lead of searxngResultsToLeads(searxResults, 12)) {
    const text = `${lead.title} ${lead.snippet}`;
    if (MARKETPLACE_TITLE_RE.test(lead.title)) continue;
    if (isSocialProfilePage(lead.full_post_url)) continue;
    if (!isBuyerContent(text, qx.negativePhrases)) continue;
    if (!lead.full_post_url || seen.has(lead.full_post_url)) continue;
    seen.add(lead.full_post_url);
    out.push(lead as SourceLead);
  }

  if (out.length < 4 && paidDiscoveryEnabled()) {
    try {
      const { searchGoogleSerp, hasGoogleSerpProvider } = await import("./serp-providers.server");
      if (hasGoogleSerpProvider()) {
        for (const q of qx.booleanWebQueries.slice(0, 2)) {
          const data = await searchGoogleSerp(q, { tbs: "qdr:d", num: 10 });
          for (const r of data?.organic_results ?? []) {
            const link = r.link || "";
            if (!link || seen.has(link)) continue;
            if (URL_BLOCKLIST.some((b) => link.toLowerCase().includes(b))) continue;
            if (isSocialProfilePage(link)) continue;
            const text = `${r.title || ""} ${r.snippet || ""}`;
            if (!isBuyerContent(text, qx.negativePhrases)) continue;
            seen.add(link);
            const idFromUrl = identityFromSocialUrl(link, r.title || "");
            const lower = link.toLowerCase();
            let source = idFromUrl.source || "searxng";
            let platform = idFromUrl.platform || "Web Search";
            if (!idFromUrl.source) {
              if (lower.includes("reddit.com")) {
                source = "reddit";
                platform = "Reddit Post";
              } else if (lower.includes("linkedin.com/posts")) {
                source = "linkedin";
                platform = "LinkedIn Post";
              } else if (lower.includes("twitter.com") || lower.includes("x.com")) {
                source = "twitter";
                platform = "Twitter/X";
              }
            }
            out.push({
              source,
              platform,
              title: r.title || "",
              snippet: (r.snippet || "").slice(0, 400),
              full_post_url: link,
              author: idFromUrl.author,
              author_url: idFromUrl.author_url,
              posted_at: parseSerpDate(r.date || r.published_date),
              engagement: 10,
              is_decision_maker: detectDecisionMaker(text),
              intentBoost: 10,
            });
          }
        }
      }
    } catch {
      /* optional */
    }
  }

  if (out.length > 0 && (process.env.SCRAPE_WORKER_URL || process.env.STEALTH_WORKER_URL)) {
    const { enrichLeadsFromUrls } = await import("./page-enrichment.server");
    await enrichLeadsFromUrls(out, 5);
  }

  return out;
}

// =====================================================================
// Stealth worker — gated platforms when APIs / SearXNG are thin
// =====================================================================
export async function searchStealthWorker(qx: ExpandedQueries): Promise<SourceLead[]> {
  const workerUrl = process.env.STEALTH_WORKER_URL;
  if (!workerUrl) return [];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.STEALTH_WORKER_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: qx.skill,
        role: qx.role,
        platforms: ["linkedin", "instagram", "facebook"],
        maxResults: 10,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      posts?: Array<{
        platform: string;
        title: string;
        snippet: string;
        url: string;
        author?: string;
        posted_at?: string;
      }>;
    };
    return (data.posts ?? [])
      .filter((p) => p.url && isBuyerContent(`${p.title} ${p.snippet}`, qx.negativePhrases))
      .map(
        (p): SourceLead => ({
          source: p.platform.toLowerCase(),
          platform: p.platform,
          title: p.title,
          snippet: p.snippet,
          full_post_url: p.url,
          author: p.author,
          posted_at: p.posted_at || undefined,
          engagement: 8,
          is_decision_maker: detectDecisionMaker(`${p.title} ${p.snippet}`),
          intentBoost: 9,
        }),
      );
  } catch {
    return [];
  }
}

// =====================================================================
// Hosted Google SERP (Serper → ScrapingDog → SerpAPI) — social + public dorks
// =====================================================================
export async function searchSerpAPI(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  if (!paidDiscoveryEnabled()) return out;

  const { searchGoogleSerp, hasGoogleSerpProvider } = await import("./serp-providers.server");
  if (!hasGoogleSerpProvider()) {
    // CoreClaw-only fallback when no Serper/Dog/SerpAPI keys.
    try {
      const { searchCoreClawSerp } = await import("./coreclaw-sources.server");
      return await withBudget(searchCoreClawSerp(qx), [], PAID_BACKUP_BUDGET_MS);
    } catch {
      return out;
    }
  }

  const craftSeed =
    (qx.relatedSkills || []).find((s) => /lead\s*gen/i.test(s)) ||
    (qx.skill || "")
      .replace(/\b(services?|solutions?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() ||
    qx.skill;
  const craft = personNoun(craftSeed, qx.role);
  const skillQ = qx.skill || qx.role;
  const alts = [skillQ, craft, craftSeed, ...(qx.relatedSkills || []).slice(0, 4)]
    .filter(Boolean)
    .filter((v, i, a) => a.findIndex((x) => x!.toLowerCase() === v!.toLowerCase()) === i)
    .slice(0, 5);
  const altOr = alts.map((a) => `"${a}"`).join(" OR ");
  // Credit-efficient: 4 high-yield dorks (LI / X / FB / public). Instagram
  // only if the social trio is thin — avoids burning free Serper credits.
  const coreQueries = [
    `site:linkedin.com/posts ("looking for a ${craft}" OR "need a ${craft}" OR "hiring a ${craft}" OR "need a ${skillQ}" OR (${altOr}) ("looking for" OR "need a" OR hiring))`,
    `site:x.com OR site:twitter.com ("looking for a ${craft}" OR "need a ${craft}" OR "hiring ${skillQ}" OR (${altOr}) (hiring OR "looking for"))`,
    `site:facebook.com/groups ("looking for a ${craft}" OR "need a ${craft}" OR "recommend a ${craft}" OR (${altOr}) ("looking for" OR hiring))`,
    `(${altOr}) ("looking for" OR "need a" OR hiring OR "request for proposal" OR RFP) (site:.gov OR site:indiehackers.com OR site:dev.to OR site:news.ycombinator.com OR site:sam.gov)`,
  ];
  const igQuery = `site:instagram.com ("looking for a ${craft}" OR "need a ${craft}" OR "hiring a ${craft}" OR (${altOr}))`;
  const thinPublicQuery = `site:quora.com OR site:indiehackers.com ("looking for a ${craft}" OR "need a ${craft}" OR "recommend a ${craft}" OR (${altOr}))`;

  const SELLER_DROP_RE =
    /\b(hire me|my portfolio|my rates|available for hire|open to work|check out my (gig|work|service)|i (build|offer|provide|specialize)|dm me your|starting at\s*\$|for your (business|company|startup))\b/i;
  const seen = new Set<string>();

  const ingest = (
    data: { organic_results?: any[]; provider?: string } | null,
    window: "day" | "week",
  ) => {
    if (!data) return 0;
    let n = 0;
    const providerLabel =
      data.provider === "serper"
        ? "Paid web search (Serper)"
        : data.provider === "scrapingdog"
          ? "Paid web search (ScrapingDog)"
          : "Paid web search (SERP)";
    for (const r of data.organic_results ?? []) {
      const link = r.link || "";
      if (!link || seen.has(link)) continue;
      seen.add(link);
      const title = r.title || "";
      const snippet = (r.snippet || "").slice(0, 400);
      const text = `${title} ${snippet}`;
      if (URL_BLOCKLIST.some((b) => link.toLowerCase().includes(b))) continue;
      if (/reddit\.com/i.test(link)) continue;
      if (SELLER_DROP_RE.test(text)) continue;
      const onPlatform = /linkedin\.com\/posts|facebook\.com|instagram\.com|(twitter|x)\.com/i.test(
        link,
      );
      if (!onPlatform && !isBuyerContent(text, qx.negativePhrases)) continue;
      const postedAt = resolveLeadDate(r.date || r.published_date, title, snippet);
      if (postedAt && onPlatform) {
        const age = ageDays(postedAt);
        if (age != null && age > CLIENTS_SOCIAL_MAX_AGE_DAYS) continue;
      }
      const idFromUrl = identityFromSocialUrl(link, title);
      const source = idFromUrl.source || "serpapi";
      const platform = idFromUrl.platform || "Google: Buyer Post";
      out.push({
        source,
        platform,
        title,
        snippet,
        full_post_url: link,
        author: idFromUrl.author,
        author_url: idFromUrl.author_url,
        posted_at: postedAt,
        engagement: 10,
        is_decision_maker: detectDecisionMaker(text),
        demand_verified: true,
        freshness_window: window,
        intentBoost: 12,
        match_reasons: [providerLabel, platform],
      });
      n++;
    }
    return n;
  };

  const dayBatches = await Promise.allSettled(
    coreQueries.map((q) => searchGoogleSerp(q, { tbs: "qdr:d", num: 20 })),
  );
  const emptyIdx: number[] = [];
  dayBatches.forEach((batch, i) => {
    if (batch.status !== "fulfilled" || !batch.value) {
      emptyIdx.push(i);
      return;
    }
    const hits = batch.value.organic_results?.length ?? 0;
    if (hits === 0) emptyIdx.push(i);
    else {
      ingest(batch.value, "day");
    }
  });

  // Always run Instagram — don't wait for LI/X/FB day yield to be thin.
  {
    const ig = await searchGoogleSerp(igQuery, { tbs: "qdr:d", num: 15 });
    ingest(ig, "day");
    const igWeek = await searchGoogleSerp(igQuery, { tbs: "qdr:w", num: 15 });
    ingest(igWeek, "week");
  }

  // Extra public/ask surface when overall day yield is still thin.
  if (out.length < 6) {
    const pub = await searchGoogleSerp(thinPublicQuery, { tbs: "qdr:d", num: 12 });
    ingest(pub, "day");
  }

  // Week fallback only when day yield is very thin — each week call can
  // burn a scarce SerpAPI credit if Serper/Dog fail.
  if (out.length < 5 && emptyIdx.length) {
    const weekBatches = await Promise.allSettled(
      emptyIdx.slice(0, 3).map((i) => searchGoogleSerp(coreQueries[i], { tbs: "qdr:w", num: 10 })),
    );
    for (const batch of weekBatches) {
      if (batch.status !== "fulfilled" || !batch.value) continue;
      ingest(batch.value, "week");
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info(`[serp] ${out.length} leads (Serper/ScrapingDog/SerpAPI)`);
  }

  // CoreClaw SERP backup — short race only (never stall Discover for 90s)
  if (out.length < 4) {
    try {
      const { searchCoreClawSerp } = await import("./coreclaw-sources.server");
      const cc = await withBudget(searchCoreClawSerp(qx), [], PAID_BACKUP_BUDGET_MS);
      for (const l of cc) {
        if (seen.has(l.full_post_url)) continue;
        seen.add(l.full_post_url);
        out.push(l);
      }
    } catch {
      /* optional */
    }
  }
  return out;
}

/**
 * Field decision-makers (CTO / founder / CEO) related to the skill —
 * fills People with relevant operators, not only people asking for help.
 */
export async function searchRelevantDecisionMakers(qx: ExpandedQueries): Promise<SourceLead[]> {
  const skill = (qx.skill || qx.role || "").trim();
  if (!skill) return [];
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  const ingest = (
    leads: Array<{
      full_post_url?: string;
      title?: string;
      snippet?: string;
      author?: string;
      author_url?: string;
      source?: string;
      platform?: string;
      match_reasons?: string[];
    }>,
  ) => {
    for (const lead of leads) {
      const text = `${lead.title || ""} ${lead.snippet || ""}`;
      if (
        !detectDecisionMaker(text) &&
        !/\b(cto|founder|ceo|owner|head of|co-?founder)\b/i.test(text)
      ) {
        continue;
      }
      if (!isRelevantToSkill(text, skill) && !isStronglyRelevantToSkill(text, skill)) continue;
      if (/\b(hire me|my portfolio|available for hire|open to work)\b/i.test(text)) continue;
      const idFromUrl = identityFromSocialUrl(lead.full_post_url || "", lead.title || "");
      const title = lead.title || "";
      const roleTitle =
        title.match(
          /^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){1,3})\s*[-|]\s*(?:CTO|CEO|Founder|Co-Founder|Owner|Head of)/i,
        ) || title.match(/^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){1,3})\s+(?:on LinkedIn)/i);
      const fromTitle = roleTitle ? roleTitle[1] : undefined;
      const author = lead.author || idFromUrl.author || fromTitle;
      if (!author) continue;
      const url = (lead.full_post_url || "").split("?")[0].toLowerCase();
      if (url && seen.has(url)) continue;
      if (url) seen.add(url);
      out.push({
        ...lead,
        source: idFromUrl.source || lead.source || "decisionmakers",
        platform: idFromUrl.platform || lead.platform || "Decision-maker",
        platform_label: "Decision-maker",
        author,
        author_url: lead.author_url || idFromUrl.author_url,
        is_decision_maker: true,
        intentBoost: 14,
        demand_verified: true,
        match_reasons: ["Relevant decision-maker in field", ...(lead.match_reasons ?? [])].slice(
          0,
          6,
        ),
        signal_type: "leading_indicator",
        why_match: `Decision-maker in ${skill} — relevant operator beyond buying posts`,
      } as SourceLead);
      if (out.length >= 40) break;
    }
  };

  try {
    const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");
    const queries = [
      `"${skill}" (CTO OR founder OR CEO OR owner) (hiring OR looking OR need OR building)`,
      `site:linkedin.com/in "${skill}" (CTO OR founder OR "Head of" OR CEO)`,
      `"${skill}" ("co-founder" OR "chief technology") (startup OR SaaS OR agency)`,
    ];
    const results = await searchSearxng(queries, 4, "week", "decisionmakers");
    ingest(searxngResultsToLeads(results, 18));
  } catch {
    /* optional */
  }

  // Hosted SERP when SearXNG is empty (Vercel) or thin — same gate as social-dorks.
  if (out.length < 8) {
    try {
      const { paidDiscoveryEnabled } = await import("./paid-discovery");
      const { searchGoogleSerp, hasGoogleSerpProvider } = await import("./serp-providers.server");
      if (paidDiscoveryEnabled() && hasGoogleSerpProvider()) {
        const dorks = [
          `"${skill}" (CTO OR founder OR CEO OR owner) (hiring OR looking OR need)`,
          `site:linkedin.com/in "${skill}" (CTO OR founder OR CEO OR "Head of")`,
          `"${skill}" ("co-founder" OR owner OR "VP of") (startup OR SaaS OR agency)`,
        ];
        for (const dork of dorks) {
          if (out.length >= 40) break;
          const data = await searchGoogleSerp(dork, { tbs: "qdr:w", num: 15 });
          if (!data?.organic_results?.length) continue;
          ingest(
            data.organic_results.map((r) => ({
              full_post_url: r.link || "",
              title: r.title || "",
              snippet: (r.snippet || "").slice(0, 400),
              source: "decisionmakers",
              platform: "Decision-maker",
            })),
          );
        }
        if (out.length) {
          console.info(`[decisionmakers] Serper path total ${out.length}`);
        }
      }
    } catch {
      /* optional */
    }
  }

  return out;
}

// =====================================================================
// YouTube — public video discovery via SearXNG site: dorks
// =====================================================================
export async function searchYouTubeSignals(qx: ExpandedQueries): Promise<SourceLead[]> {
  let out: SourceLead[] = [];
  const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");
  const queries = [
    `site:youtube.com "${qx.skill}" ("hiring" OR "looking for" OR "need a" OR "freelancer")`,
    `site:youtube.com "${qx.role}" ("hiring" OR "need help" OR "looking for someone")`,
  ];
  try {
    const results = await searchSearxng(queries, 2, "day", "youtube");
    for (const lead of searxngResultsToLeads(results, 8)) {
      const url = (lead.full_post_url || "").toLowerCase();
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) continue;
      const text = `${lead.title} ${lead.snippet}`;
      if (!isBuyerContent(text, qx.negativePhrases)) continue;
      out.push({
        ...lead,
        source: "youtube",
        platform: "YouTube",
        platform_label: "YouTube",
      } as SourceLead);
    }

    if (out.length > 0) {
      const { enhanceYouTubeLeads } = await import("./youtube-transcript.server");
      out = (await enhanceYouTubeLeads(out, qx.skill || qx.role || "")) as SourceLead[];
    }
  } catch {
    /* best-effort */
  }
  return out;
}

// =====================================================================
// ScrapeCreators — multi-sub Reddit + LinkedIn posts (paid reliability layer)
// =====================================================================

/** Parse human author from social URLs — never use hostname as author. */
function identityFromSocialUrl(
  link: string,
  title?: string,
): {
  source?: string;
  platform?: string;
  author?: string;
  author_url?: string;
} {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname;

    if (host.endsWith("reddit.com")) {
      const user = path.match(/\/(?:user|u)\/([^/?#]+)/i)?.[1];
      if (user && user.toLowerCase() !== "deleted") {
        return {
          source: "reddit",
          platform: "Reddit Post",
          author: user,
          author_url: `https://reddit.com/user/${user}`,
        };
      }
      return { source: "reddit", platform: "Reddit Post" };
    }
    if (host === "twitter.com" || host === "x.com") {
      const tw = path.match(/^\/([A-Za-z0-9_]+)\/status\//);
      if (tw && !["i", "home", "search", "intent", "share"].includes(tw[1].toLowerCase())) {
        return {
          source: "twitter",
          platform: "Twitter/X",
          author: `@${tw[1]}`,
          author_url: `https://x.com/${tw[1]}`,
        };
      }
      return { source: "twitter", platform: "Twitter/X" };
    }
    if (host.endsWith("linkedin.com") && /\/posts\//i.test(path)) {
      const m = path.match(/\/posts\/([A-Za-z0-9-]+?)_/i);
      if (m) {
        const slug = m[1];
        const parts = slug.split("-").filter(Boolean);
        while (parts.length > 1 && /\d/.test(parts[parts.length - 1])) parts.pop();
        const corpTail =
          /^(services|agency|studio|labs|lab|solutions|digital|technologies|consulting|group|media|partners)$/i;
        if (parts.length >= 2 && parts.length <= 4 && !parts.some((p) => corpTail.test(p))) {
          const name = parts
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
            .join(" ");
          return {
            source: "linkedin",
            platform: "LinkedIn Post",
            author: name,
            author_url: `https://www.linkedin.com/in/${slug}`,
          };
        }
      }
      // Title fallback: "Alaa Ezzeddine hiring … | LinkedIn"
      const fromTitle = (title || "").match(
        /^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){1,3})\s+(?:on LinkedIn|hiring)\b/i,
      )?.[1];
      if (fromTitle && !/\b(Inc|LLC|Ltd|Labs|Services|Agency)\b/i.test(fromTitle)) {
        return {
          source: "linkedin",
          platform: "LinkedIn Post",
          author: fromTitle,
        };
      }
      return { source: "linkedin", platform: "LinkedIn Post" };
    }
    if (host.endsWith("linkedin.com") && /\/in\//i.test(path)) {
      const slug = path.match(/\/in\/([^/?#]+)/i)?.[1];
      if (slug) {
        const parts = slug.split("-").filter((p) => p && !/^\d+$/.test(p));
        const name =
          parts.length >= 2 && parts.length <= 4
            ? parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ")
            : undefined;
        return {
          source: "linkedin",
          platform: "LinkedIn Profile",
          author: name,
          author_url: `https://www.linkedin.com/in/${slug}`,
        };
      }
      return { source: "linkedin", platform: "LinkedIn Profile" };
    }
    if (host.endsWith("instagram.com") && /\/(p|reel)\//i.test(path)) {
      // Username rarely in /p/ URLs; recover from title "@handle" when present.
      const handle =
        (title || "").match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ||
        (title || "").match(/\b([a-z0-9_.]{3,30}\.design)\b/i)?.[1];
      return {
        source: "instagram",
        platform: "Instagram Post",
        author: handle || undefined,
        author_url: handle ? `https://www.instagram.com/${handle.replace(/^@/, "")}/` : undefined,
      };
    }
    if (host.endsWith("facebook.com")) {
      return { source: "facebook", platform: "Facebook (public)" };
    }
    if (host.endsWith("news.ycombinator.com")) {
      const id = u.searchParams.get("id");
      return {
        source: "hn",
        platform: "Hacker News",
        author: id || undefined,
        author_url: id ? `https://news.ycombinator.com/user?id=${id}` : undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function searchScrapeCreatorsReddit(
  qx: ExpandedQueries,
  seen: Set<string> = new Set(),
  opts?: { maxLeads?: number; maxRequests?: number; subredditBoosts?: string[] },
): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const key = process.env.SCRAPECREATORS_KEY;
  if (!key) return out;

  const maxLeads = opts?.maxLeads ?? 25;
  const maxRequests = opts?.maxRequests ?? 8;
  let requests = 0;

  const skill = qx.skill || qx.role || "";
  const queries = [
    `[Hiring] ${skill}`,
    `"need a" ${skill}`,
    `looking for ${qx.role || skill}`,
  ].filter((q) => q.replace(/\s+/g, " ").trim().length > 4);

  const boostSubs = (opts?.subredditBoosts || [])
    .map((s) => s.replace(/^r\//i, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const defaultSubs = ["forhire", "hiring", "startups", "Entrepreneur", "webdev", "smallbusiness"];
  const subs = [...new Set([...boostSubs, ...defaultSubs])].slice(0, 8);

  const plan: Array<{ sub: string; q: string; timeframe: "hour" | "day" }> = [];
  for (const sub of subs) {
    const q = queries[sub === "forhire" ? 0 : 1] || queries[0];
    if (!q) continue;
    if (sub === "forhire") plan.push({ sub, q: queries[0], timeframe: "hour" });
    plan.push({ sub, q, timeframe: "day" });
  }

  for (const { sub, q, timeframe } of plan) {
    if (out.length >= maxLeads || requests >= maxRequests) break;
    requests++;
    try {
      const url =
        `https://api.scrapecreators.com/v1/reddit/search?query=${encodeURIComponent(q)}` +
        `&sort=new&timeframe=${timeframe}&subreddit=${encodeURIComponent(sub)}`;
      const data = await safe(
        fetch(url, { headers: { "x-api-key": key } }).then((r) => ok<any>(r)),
        null,
      );
      for (const p of data?.posts ?? data?.data ?? []) {
        if (out.length >= maxLeads) break;
        const id = String(p.id || p.fullname || p.permalink || "");
        if (id && seen.has(id)) continue;
        const date = p.created_utc
          ? new Date(p.created_utc * 1000).toISOString()
          : p.created_at || null;
        if (!isRecent(date, timeframe === "hour" ? 1 : CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;
        const title = p.title || "";
        const flair = (p.link_flair_text || "").toLowerCase();
        const snippet = (p.selftext || p.body || "").slice(0, 500);
        const text = `${title} ${snippet}`;
        const isHiring =
          flair.includes("hiring") ||
          title.toLowerCase().includes("[hiring]") ||
          isBuyerContent(text, qx.negativePhrases || []);
        if (sub === "forhire" && !isHiring) continue;
        if (sub !== "forhire" && !isBuyerContent(text, qx.negativePhrases || [])) continue;
        if (id) seen.add(id);
        const permalink = p.permalink
          ? p.permalink.startsWith("http")
            ? p.permalink
            : `https://reddit.com${p.permalink}`
          : p.url || "";
        out.push({
          source: "reddit",
          platform: `Reddit r/${sub}`,
          title:
            sub === "forhire" && !title.toLowerCase().includes("[hiring]")
              ? `[HIRING] ${title}`
              : title,
          snippet: snippet || title,
          full_post_url: permalink,
          author: p.author && p.author !== "[deleted]" ? p.author : undefined,
          author_url:
            p.author && p.author !== "[deleted]"
              ? `https://reddit.com/user/${p.author}`
              : undefined,
          posted_at: date || undefined,
          engagement: (p.score ?? 0) + (p.num_comments ?? 0),
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 20,
        });
      }
    } catch {
      /* continue */
    }
  }
  return out;
}

/** Free Reddit archive (no API key, no OAuth). Primary Reddit path when unpaid. */
async function searchPullPushReddit(
  qx: ExpandedQueries,
  seen: Set<string> = new Set(),
  opts?: { maxLeads?: number; maxRequests?: number; subredditBoosts?: string[] },
): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const maxLeads = opts?.maxLeads ?? 40;
  const maxRequests = opts?.maxRequests ?? 8;
  let requests = 0;
  const after = Math.floor(Date.now() / 1000) - 3 * 86_400;
  const skill = (qx.skill || qx.role || "").trim();
  if (!skill) return out;

  const related = (qx.relatedSkills || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.toLowerCase() !== skill.toLowerCase())
    .slice(0, 4);
  const crafts = [skill, ...related];

  const boostSubs = [
    ...(opts?.subredditBoosts || []),
    "forhire",
    "DesignJobs",
    "web_design",
    "UI_Design",
    "startups",
    "smallbusiness",
    "slavelabour",
  ]
    .map((s) => s.replace(/^r\//i, "").trim())
    .filter((v, i, a) => !!v && a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
    .slice(0, 6);

  const plan: Array<{ q: string; subreddit?: string }> = [
    { q: `[Hiring] ${crafts[0]}`, subreddit: "forhire" },
    { q: `"need a" ${crafts[0]}`, subreddit: boostSubs[0] },
    { q: `looking for ${crafts[0]}`, subreddit: boostSubs[1] || "startups" },
    {
      q: `"${crafts[0]}" ("need someone" OR "who can" OR "willing to pay" OR budget OR freelancer)`,
    },
    ...(crafts[1]
      ? [
          { q: `[Hiring] ${crafts[1]}`, subreddit: "forhire" },
          { q: `"need a" ${crafts[1]}`, subreddit: boostSubs[2] || "DesignJobs" },
        ]
      : []),
    ...(crafts[2]
      ? [
          {
            q: `looking for ${crafts[2]} (designer OR developer OR freelancer)`,
            subreddit: "forhire",
          },
        ]
      : []),
    {
      q: `"hiring" (${crafts
        .slice(0, 3)
        .map((c) => `"${c}"`)
        .join(" OR ")})`,
      subreddit: "forhire",
    },
  ];

  for (const { q, subreddit } of plan) {
    if (out.length >= maxLeads || requests >= maxRequests) break;
    requests++;
    try {
      let url =
        `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q)}` +
        `&size=40&sort=desc&sort_type=created_utc&after=${after}`;
      if (subreddit) url += `&subreddit=${encodeURIComponent(subreddit)}`;
      const data = await safe(
        fetch(url, { headers: { Accept: "application/json" } }).then((r) => ok<any>(r)),
        null,
      );
      for (const p of data?.data ?? []) {
        if (out.length >= maxLeads) break;
        const id = String(p.id || p.name || "");
        if (!id || seen.has(id)) continue;
        const date = p.created_utc ? new Date(Number(p.created_utc) * 1000).toISOString() : null;
        if (!isRecent(date, 3)) continue;
        const title = p.title || "";
        const snippet = (p.selftext || "").slice(0, 500);
        const text = `${title} ${snippet}`;
        if (!isBuyerContent(text, qx.negativePhrases || [])) continue;
        const sub = p.subreddit || subreddit || "reddit";
        seen.add(id);
        const permalink = p.permalink
          ? p.permalink.startsWith("http")
            ? p.permalink
            : `https://reddit.com${p.permalink}`
          : p.url || `https://reddit.com/comments/${id}`;
        out.push({
          source: "reddit",
          platform: `Reddit r/${sub}`,
          title,
          snippet: snippet || title,
          full_post_url: permalink,
          author: p.author && p.author !== "[deleted]" ? p.author : undefined,
          author_url:
            p.author && p.author !== "[deleted]"
              ? `https://reddit.com/user/${p.author}`
              : undefined,
          posted_at: date || undefined,
          engagement: (p.score ?? 0) + (p.num_comments ?? 0),
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 18,
        });
      }
    } catch {
      /* continue */
    }
  }
  return out;
}

async function searchScrapeCreatorsLinkedInPosts(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const key = process.env.SCRAPECREATORS_KEY;
  if (!key) return out;
  const queries = [
    `need a ${qx.skill}`,
    `looking for ${qx.role || qx.skill} freelancer`,
    `hiring ${qx.skill} contractor`,
  ];
  for (const q of queries.slice(0, 4)) {
    try {
      const url =
        `https://api.scrapecreators.com/v1/linkedin/search/posts?query=${encodeURIComponent(q)}` +
        `&date_posted=past_week`;
      const data = await safe(
        fetch(url, { headers: { "x-api-key": key } }).then((r) => ok<any>(r)),
        null,
      );
      for (const p of data?.posts ?? data?.data ?? data?.results ?? []) {
        const text = `${p.text || p.content || p.title || ""} ${p.snippet || ""}`;
        if (!isBuyerContent(text, qx.negativePhrases || [])) continue;
        const link = p.url || p.link || p.post_url || "";
        if (!link || !/linkedin\.com\/posts\//i.test(link)) continue;
        const date =
          p.posted_at ||
          p.created_at ||
          (p.timestamp ? new Date(p.timestamp).toISOString() : undefined);
        if (date && !isRecent(date, 7)) continue;
        out.push({
          source: "linkedin",
          platform: "LinkedIn Post (SC)",
          title: (p.text || p.content || text).slice(0, 110),
          snippet: text.slice(0, 400),
          full_post_url: link,
          author: p.author?.name || p.author_name || undefined,
          author_url: p.author?.url || p.author_url || undefined,
          posted_at: date,
          engagement: (p.reactions ?? 0) + (p.comments ?? 0),
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 16,
        });
      }
    } catch {
      /* continue */
    }
  }
  return out;
}

export async function searchScrapeCreators(qx: ExpandedQueries): Promise<SourceLead[]> {
  if (!paidDiscoveryEnabled()) return [];
  // Reddit is owned by searchReddit(); this path only adds LinkedIn posts.
  return searchScrapeCreatorsLinkedInPosts(qx);
}

// =====================================================================
// Tavily — deep buyer-intent web search (when key present)
// =====================================================================
export async function searchTavily(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  if (!paidDiscoveryEnabled()) return out;
  const key = process.env.TAVILY_API_KEY;
  if (!key) return out;
  const queries = [
    `people looking to hire ${qx.role} OR "${qx.skill} needed" OR "need a ${qx.skill}" freelance ${new Date().getFullYear()}`,
    `("${qx.skill}") ("looking for a tool" OR "need software" OR "struggling with" OR "anyone recommend")`,
    ...qx.booleanWebQueries.slice(0, 3),
  ];
  for (const q of queries.slice(0, 5)) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query: q,
          search_depth: "advanced",
          max_results: 15,
          include_domains: [
            "linkedin.com",
            "twitter.com",
            "x.com",
            "bsky.app",
            "instagram.com",
            "facebook.com",
            "news.ycombinator.com",
            "indiehackers.com",
            "dev.to",
            "lobste.rs",
            "wellfound.com",
            "angel.co",
            "upwork.com",
            "youtube.com",
            "tiktok.com",
            "sam.gov",
            "contractsfinder.service.gov.uk",
            "github.com",
          ],
          exclude_domains: [
            "wikipedia.org",
            "medium.com",
            "stackoverflow.com",
            "npmjs.com",
            "toptal.com",
            "freelancer.com",
            "indeed.com",
            "glassdoor.com",
            "reddit.com",
          ],
        }),
      });
      const data = res.ok ? await res.json() : null;
      for (const r of data?.results ?? []) {
        const text = `${r.title || ""} ${r.content || ""}`;
        if (!isBuyerContent(text, qx.negativePhrases)) continue;
        const link = r.url || "";
        if (isSocialProfilePage(link)) continue;
        // Reddit is covered natively — don't burn Tavily slots on it.
        if (/reddit\.com/i.test(link)) continue;
        const idFromUrl = identityFromSocialUrl(link, r.title || "");
        let source = idFromUrl.source || "tavily";
        let platform = idFromUrl.platform || "Web: Hiring/Job Post";
        if (!idFromUrl.source) {
          const lower = link.toLowerCase();
          if (lower.includes("twitter.com") || lower.includes("x.com")) {
            source = "twitter";
            platform = "Twitter/X";
          } else if (lower.includes("linkedin.com/posts")) {
            source = "linkedin";
            platform = "LinkedIn Post";
          } else if (lower.includes("instagram.com/p/") || lower.includes("instagram.com/reel/")) {
            source = "instagram";
            platform = "Instagram Post";
          } else if (lower.includes("facebook.com")) {
            source = "facebook";
            platform = "Facebook (public)";
          } else if (lower.includes("news.ycombinator.com")) {
            source = "hn";
            platform = "Hacker News";
          } else if (lower.includes("sam.gov") || /\.gov\//i.test(lower)) {
            source = "samgov";
            platform = "Government / public RFP";
          }
        }
        if (source === "tavily" && /\b(need a|looking for|who can|willing to pay)\b/i.test(text)) {
          platform = "Web: Buyer Demand";
        }
        const title = r.title || "";
        const snippet = (r.content || "").slice(0, 400);
        const postedAt =
          r.published_date || extractDateFromText(`${title} ${snippet}`) || undefined;
        if (
          postedAt &&
          onPlatformSocial(link) &&
          !isRecent(postedAt, CLIENTS_SOCIAL_MAX_AGE_DAYS)
        ) {
          continue;
        }
        out.push({
          source,
          platform,
          title,
          snippet,
          full_post_url: link,
          author: idFromUrl.author,
          author_url: idFromUrl.author_url,
          posted_at: postedAt,
          engagement: Math.round((r.score ?? 0.5) * 100),
          is_decision_maker: detectDecisionMaker(text),
          demand_verified: true,
          // Only claim day when we have a recent date; else leave unset for All chip.
          freshness_window: postedAt && isRecent(postedAt, 1) ? "day" : undefined,
          intentBoost: 10,
          match_reasons: ["Paid web search (Tavily)", platform],
        });
      }
    } catch {}
  }
  return out;
}

function onPlatformSocial(link: string): boolean {
  return /linkedin\.com\/posts|facebook\.com|instagram\.com|(twitter|x)\.com/i.test(link);
}

// =====================================================================
// USAJobs / We Work Remotely — real postings, recency-filtered
// =====================================================================
export async function searchUSAJobs(qx: ExpandedQueries): Promise<SourceLead[]> {
  const key = process.env.USAJOBS_KEY;
  if (!key) return [];
  try {
    const url = `https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(qx.role)}&ResultsPerPage=15`;
    const data = await safe(
      fetch(url, {
        headers: {
          "User-Agent": "scrapivo@app",
          "Authorization-Key": key,
          Host: "data.usajobs.gov",
        },
      }).then((r) => ok<any>(r)),
      null,
    );
    const items = data?.SearchResult?.SearchResultItems ?? [];
    return items
      .map((it: any): SourceLead => {
        const j = it.MatchedObjectDescriptor ?? {};
        return {
          source: "usajobs",
          platform: "USAJobs.gov",
          title: `${j.PositionTitle ?? ""} @ ${j.OrganizationName ?? ""}`,
          snippet: (j.UserArea?.Details?.JobSummary ?? j.QualificationSummary ?? "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 400),
          full_post_url: j.PositionURI,
          author: j.OrganizationName,
          posted_at: j.PublicationStartDate,
          engagement: 40,
          is_decision_maker: true,
          intentBoost: 18,
        };
      })
      .filter(
        (l: SourceLead) => !!l.full_post_url && isRecent(l.posted_at, JOB_BOARD_MAX_AGE_DAYS),
      );
  } catch {
    return [];
  }
}

export async function searchWeWorkRemotely(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  const pick = (s: string, tag: string) => {
    const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
  };
  for (const term of jobBoardTerms(qx)) {
    try {
      const url = `https://weworkremotely.com/remote-jobs/search.rss?term=${encodeURIComponent(term)}`;
      const text = await safe(
        fetch(url, { headers: { "user-agent": "scrapivo/1.0" } }).then((r) =>
          r.ok ? r.text() : "",
        ),
        "",
      );
      if (!text) continue;
      const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25);
      for (const m of items) {
        const body = m[1];
        const title = pick(body, "title");
        const link = pick(body, "link");
        if (!link || !title || seen.has(link)) continue;
        seen.add(link);
        const desc = pick(body, "description").replace(/<[^>]+>/g, " ");
        const date = pick(body, "pubDate");
        const posted = date ? new Date(date).toISOString() : undefined;
        if (!posted || !isRecent(posted, JOB_BOARD_MAX_AGE_DAYS)) continue;
        out.push({
          source: "weworkremotely",
          platform: "We Work Remotely",
          title: `JOB: ${title}`,
          snippet: desc.slice(0, 400),
          full_post_url: link,
          posted_at: posted,
          engagement: 45,
          is_decision_maker: true,
          intentBoost: 18,
        });
      }
    } catch {}
  }
  return out;
}

// =====================================================================
// Remotive — free remote-jobs API (no key)
// =====================================================================
export async function searchRemotive(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const term of jobBoardTerms(qx)) {
    try {
      const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=25`;
      const data = await safe(
        fetch(url, { headers: { "user-agent": "scrapivo/1.0" } }).then((r) => ok<any>(r)),
        null,
      );
      for (const j of data?.jobs ?? []) {
        if (!j.url || seen.has(j.url)) continue;
        seen.add(j.url);
        if (!isRecent(j.publication_date, JOB_BOARD_MAX_AGE_DAYS)) continue;
        out.push({
          source: "remotive",
          platform: "Remotive",
          title: `${j.title} @ ${j.company_name}`,
          snippet: (j.description || "").replace(/<[^>]+>/g, " ").slice(0, 400),
          full_post_url: j.url,
          author: j.company_name,
          author_url: j.company_logo_url,
          posted_at: j.publication_date,
          engagement: 45,
          is_decision_maker: true,
          intentBoost: 18,
        });
      }
    } catch {}
  }
  return out;
}

// =====================================================================
// Jobicy — free remote-jobs API (no key)
// =====================================================================
export async function searchJobicy(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const term of jobBoardTerms(qx)) {
    try {
      const url = `https://jobicy.com/api/v2/remote-jobs?count=25&tag=${encodeURIComponent(term)}`;
      const data = await safe(
        fetch(url).then((r) => ok<any>(r)),
        null,
      );
      for (const j of data?.jobs ?? []) {
        if (!j.url || seen.has(j.url)) continue;
        seen.add(j.url);
        if (!isRecent(j.pubDate, ATS_COMPANY_MAX_AGE_DAYS)) continue;
        out.push({
          source: "jobicy",
          platform: "Jobicy",
          title: `${j.jobTitle} @ ${j.companyName}`,
          snippet: (j.jobExcerpt || j.jobDescription || "").replace(/<[^>]+>/g, " ").slice(0, 400),
          full_post_url: j.url,
          author: j.companyName,
          author_url: j.companyLogo,
          posted_at: j.pubDate,
          engagement: 42,
          is_decision_maker: true,
          intentBoost: 16,
        });
      }
    } catch {}
  }
  return out;
}

// =====================================================================
// Arbeitnow — free EU + remote job board API (no key)
// =====================================================================
export async function searchArbeitnow(qx: ExpandedQueries): Promise<SourceLead[]> {
  try {
    const url = `https://www.arbeitnow.com/api/job-board-api`;
    const data = await safe(
      fetch(url).then((r) => ok<any>(r)),
      null,
    );
    const jobs: any[] = data?.data ?? [];
    const terms = jobBoardTerms(qx).map((t) => t.toLowerCase());
    return jobs
      .filter((j) => {
        const blob = `${j.title} ${j.description || ""} ${(j.tags || []).join(" ")}`.toLowerCase();
        return terms.some((t) => blob.includes(t));
      })
      .slice(0, 28)
      .map(
        (j): SourceLead => ({
          source: "arbeitnow",
          platform: "Arbeitnow",
          title: `${j.title} @ ${j.company_name}`,
          snippet: (j.description || "").replace(/<[^>]+>/g, " ").slice(0, 400),
          full_post_url: j.url,
          author: j.company_name,
          posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
          engagement: 35,
          is_decision_maker: true,
          intentBoost: 8,
        }),
      )
      .filter(
        (l: SourceLead) => !!l.full_post_url && isRecent(l.posted_at, JOB_BOARD_MAX_AGE_DAYS),
      );
  } catch {
    return [];
  }
}

// =====================================================================
// The Muse — public jobs API (no key)
// =====================================================================
export async function searchTheMuse(qx: ExpandedQueries): Promise<SourceLead[]> {
  try {
    const url = `https://www.themuse.com/api/public/jobs?category=Engineering&page=0`;
    const data = await safe(
      fetch(url).then((r) => ok<any>(r)),
      null,
    );
    const jobs: any[] = data?.results ?? [];
    const terms = jobBoardTerms(qx).map((t) => t.toLowerCase());
    return jobs
      .filter((j) => {
        const blob = `${j.name} ${j.contents || ""}`.toLowerCase();
        return terms.some((t) => blob.includes(t));
      })
      .slice(0, 15)
      .map(
        (j): SourceLead => ({
          source: "themuse",
          platform: "The Muse",
          title: `${j.name} @ ${j.company?.name ?? ""}`,
          snippet: (j.contents || "").replace(/<[^>]+>/g, " ").slice(0, 400),
          full_post_url: j.refs?.landing_page,
          author: j.company?.name,
          posted_at: j.publication_date,
          engagement: 30,
          is_decision_maker: true,
          intentBoost: 12,
        }),
      )
      .filter(
        (l: SourceLead) => !!l.full_post_url && isRecent(l.posted_at, JOB_BOARD_MAX_AGE_DAYS),
      );
  } catch {
    return [];
  }
}

// =====================================================================
// =====================================================================
// Mastodon + Lemmy live in fediverse-sources.server.ts
//
// The implementations that used to sit here both failed silently. Mastodon
// called /api/v2/search?type=statuses, which returns 200 with empty arrays to
// anonymous callers (verified 2026-08-02) — so it looked healthy while
// yielding nothing, forever. Lemmy hit one instance with one job-shaped query
// ("hiring <skill>"). The replacements use keyless endpoints that actually
// return data, across five instances each, and search for demand rather than
// job ads.
// =====================================================================
import { searchLemmy, searchMastodon } from "./fediverse-sources.server";
import { searchSocialDorks } from "./social-dorks.server";
export { searchLemmy, searchMastodon };

// =====================================================================
// SAM.gov — US federal contract opportunities (free public API, no key
// strictly required for the basic search endpoint via the public JSON)
// =====================================================================
export async function searchSamGov(qx: ExpandedQueries): Promise<SourceLead[]> {
  // SAM.gov's modern API requires a key; if SAM_GOV_KEY is set we use it,
  // otherwise the source quietly skips (still listed in plan, opt-in).
  const key = process.env.SAM_GOV_KEY;
  if (!key) return [];
  try {
    const today = new Date();
    const from = new Date(Date.now() - 14 * 86_400_000);
    const fmt = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
    const url = `https://api.sam.gov/opportunities/v2/search?api_key=${key}&postedFrom=${fmt(from)}&postedTo=${fmt(today)}&limit=15&q=${encodeURIComponent(qx.skill)}`;
    const data = await safe(
      fetch(url).then((r) => ok<any>(r)),
      null,
    );
    return (data?.opportunitiesData ?? [])
      .map(
        (o: any): SourceLead => ({
          source: "samgov",
          platform: "SAM.gov Federal Tender",
          title: o.title || "Federal opportunity",
          snippet: (o.description || o.synopsis || "").slice(0, 500),
          full_post_url: o.uiLink || o.links?.[0]?.href || "",
          author: o.organizationHierarchy?.[0]?.name || "US Federal Government",
          posted_at: o.postedDate,
          engagement: 70,
          is_decision_maker: true,
          intentBoost: 22,
        }),
      )
      .filter((l: SourceLead) => !!l.full_post_url && isRecent(l.posted_at));
  } catch {
    return [];
  }
}

// =====================================================================
// Dev.to — public articles API, filtered to buyer-intent posts
// =====================================================================
export async function searchDevTo(qx: ExpandedQueries): Promise<SourceLead[]> {
  try {
    const tag = qx.skill
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=30&top=7`;
    const data = await safe(
      fetch(url).then((r) => ok<any[]>(r)),
      [] as any[],
    );
    const out: SourceLead[] = [];
    for (const a of Array.isArray(data) ? data : []) {
      const text = `${a.title || ""} ${a.description || ""}`;
      if (!isRecent(a.published_at)) continue;
      if (!isBuyerContent(text, qx.negativePhrases)) continue;
      if (!isRelevantToSkill(text, qx.skill)) continue;
      out.push({
        source: "devto",
        platform: "Dev.to",
        title: a.title || "",
        snippet: (a.description || "").slice(0, 400),
        full_post_url: a.url || a.canonical_url || "",
        author: a.user?.name || a.user?.username,
        author_url: a.user?.username ? `https://dev.to/${a.user.username}` : undefined,
        posted_at: a.published_at,
        engagement: (a.public_reactions_count ?? 0) + (a.comments_count ?? 0),
        is_decision_maker: detectDecisionMaker(text),
        intentBoost: 5,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// =====================================================================
// Lobsters — public newest.json, filtered for buyer-intent / hiring
// =====================================================================
export async function searchLobsters(qx: ExpandedQueries): Promise<SourceLead[]> {
  try {
    const url = `https://lobste.rs/search.json?q=${encodeURIComponent(`${qx.skill} hiring`)}&what=stories&order=newest`;
    const data = await safe(
      fetch(url, { headers: { "user-agent": "scrapivo/1.0" } }).then((r) => ok<any>(r)),
      null,
    );
    const stories: any[] = data?.stories ?? data ?? [];
    const out: SourceLead[] = [];
    for (const s of stories.slice(0, 25)) {
      const text = `${s.title || ""} ${s.description || ""}`;
      if (!isRecent(s.created_at)) continue;
      if (!isBuyerContent(text, qx.negativePhrases)) continue;
      if (!isRelevantToSkill(text, qx.skill)) continue;
      out.push({
        source: "lobsters",
        platform: "Lobsters",
        title: s.title || "",
        snippet: (s.description || s.title || "").slice(0, 400),
        full_post_url: s.short_id_url || s.url || s.comments_url || "",
        author: s.submitter_user,
        posted_at: s.created_at,
        engagement: s.score ?? 0,
        is_decision_maker: detectDecisionMaker(text),
        intentBoost: 6,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// =====================================================================
// Indie Hackers — public listing RSS via Tavily-friendly URL fallback
// IH doesn't expose a stable public JSON. We use the official RSS for
// the "Tasks" / "Work" stream where buyer-intent gigs appear.
// =====================================================================
export async function searchIndieHackers(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const feeds = ["https://www.indiehackers.com/feed.xml"];
  for (const url of feeds) {
    try {
      const text = await safe(
        fetch(url, { headers: { "user-agent": "scrapivo/1.0" } }).then((r) =>
          r.ok ? r.text() : "",
        ),
        "",
      );
      if (!text) continue;
      const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30);
      for (const m of items) {
        const x = m[1];
        const title =
          x.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
        const link = x.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
        const pub = x.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
        const desc = (
          x.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? ""
        )
          .replace(/<[^>]+>/g, " ")
          .slice(0, 500);
        if (!link || !title) continue;
        const date = pub ? new Date(pub).toISOString() : new Date().toISOString();
        if (!isRecent(date, 21)) continue;
        const body = `${title} ${desc}`;
        if (!isBuyerContent(body, qx.negativePhrases)) continue;
        if (!isRelevantToSkill(body, qx.skill)) continue;
        out.push({
          source: "indiehackers",
          platform: "Indie Hackers",
          title,
          snippet: desc,
          full_post_url: link,
          posted_at: date,
          engagement: 12,
          is_decision_maker: detectDecisionMaker(body),
          intentBoost: 8,
        });
      }
    } catch {}
  }
  return out;
}

// =====================================================================
// Hashnode — GraphQL public API (no key), filtered for buyer-intent
// =====================================================================
export async function searchHashnode(qx: ExpandedQueries): Promise<SourceLead[]> {
  try {
    const query = `query Search($q: String!) {
      searchPostsOfPublication(first: 20, filter: { query: $q }) {
        edges { node { title brief url publishedAt author { name username } reactionCount responseCount } }
      }
    }`;
    const res = await fetch("https://gql.hashnode.com/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { q: `${qx.skill} hiring` } }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const edges: any[] = j?.data?.searchPostsOfPublication?.edges ?? [];
    const out: SourceLead[] = [];
    for (const e of edges) {
      const n = e.node;
      if (!n) continue;
      const text = `${n.title || ""} ${n.brief || ""}`;
      if (!isRecent(n.publishedAt)) continue;
      if (!isBuyerContent(text, qx.negativePhrases)) continue;
      if (!isRelevantToSkill(text, qx.skill)) continue;
      out.push({
        source: "hashnode",
        platform: "Hashnode",
        title: n.title,
        snippet: (n.brief || "").slice(0, 400),
        full_post_url: n.url,
        author: n.author?.name,
        author_url: n.author?.username ? `https://hashnode.com/@${n.author.username}` : undefined,
        posted_at: n.publishedAt,
        engagement: (n.reactionCount ?? 0) + (n.responseCount ?? 0),
        is_decision_maker: detectDecisionMaker(text),
        intentBoost: 5,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// =====================================================================
// Buyer-intent scoring (replaces engagement-based score)
// =====================================================================
const HIGH_SIGNALS = [
  "[hiring]",
  "we are hiring",
  "our startup is looking",
  "job posting",
  "paid position",
  "salary:",
  "budget:",
  "compensation:",
  "rate:",
  "hourly:",
  "full-time",
  "part-time",
  "contract position",
  "apply here",
  "dm to apply",
];
const MED_SIGNALS = [
  "looking for",
  "need a",
  "need someone",
  "seeking",
  "want to hire",
  "can anyone recommend",
  "who should i hire",
  "help wanted",
  "project available",
  "work available",
  "freelance opportunity",
];

// Hot band starts at 70 (see tierFor). Leading-indicator leads are clamped to
// this ceiling so they top out at "warm" and never cross into hot.
const HOT_THRESHOLD = 70;
const WARM_CAP = HOT_THRESHOLD - 1; // 69

function platformBase(label: string): number {
  const l = label.toLowerCase();
  if (l.includes("forhire") && l.includes("hiring")) return 25;
  if (l.includes("upwork")) return 24;
  if (l.includes("remoteok")) return 22;
  if (l.includes("who is hiring") || l.includes("who's hiring")) return 25;
  if (l.includes("r/hiring")) return 20;
  if (l.includes("we work remotely")) return 20;
  if (l.includes("usajobs")) return 18;
  if (l.includes("github")) return 15;
  if (l.includes("work at a startup") || l.includes("yc")) return 16;
  if (l.includes("geoapify") || l.includes("foursquare") || l.includes("local business")) return 22;
  if (l.includes("dealroom") || l.includes("neuronfeed") || l.includes("just founded")) return 32;
  if (
    l.includes("software recs") ||
    l.includes("stack exchange") ||
    l.includes("academia") ||
    l.includes("ell se")
  )
    return 36;
  if (l.includes("bluesky")) return 12;
  if (l.includes("google")) return 10;
  if (l.includes("web")) return 8;
  return 10;
}

function scoreSourceLead(lead: SourceLead): number {
  return scoreAndReason(lead).score;
}

export function scoreAndReason(
  lead: SourceLead,
  qx?: ExpandedQueries,
): { score: number; reasons: string[]; why: string } {
  const text = `${lead.title} ${lead.snippet}`.toLowerCase();
  const reasons: string[] = [];
  let score = platformBase(lead.platform || "");

  // recency — never invent a "just now" date; missing timestamps skip the recency bonus
  const hours = lead.posted_at
    ? (Date.now() - new Date(lead.posted_at).getTime()) / 3_600_000
    : null;
  if (hours == null) {
    reasons.push("Date unknown");
  } else if (hours < 3) {
    score += 38;
    reasons.push("Posted in the last few hours");
  } else if (hours < 6) {
    score += 34;
    reasons.push("Posted in the last few hours");
  } else if (hours < 12) {
    score += 30;
    reasons.push("Posted within the last 12h");
  } else if (hours < 24) {
    score += 26;
    reasons.push("Posted within the last 24h");
  } else if (hours < 48) {
    score += 16;
    reasons.push("Posted in the last 2 days");
  } else if (hours < 72) {
    score += 8;
    reasons.push("Posted in the last 3 days");
  } else if (hours < 168) {
    score += 3;
    reasons.push("Posted this week");
  } else if (
    lead.signal_type === "leading_indicator" ||
    lead.source === "dealroom" ||
    lead.source === "neuronfeed" ||
    lead.source === "startupsgallery" ||
    lead.source === "secedgar" ||
    lead.source === "stackexchange"
  ) {
    // Identity / deal-flow / evergreen Q&A rows — never zero on age.
    reasons.push("Company/Q&A identity signal (date not used as freshness gate)");
  } else {
    return { score: 0, reasons: [], why: "" };
  }

  const matchedHigh: string[] = [];
  HIGH_SIGNALS.forEach((s) => {
    if (text.includes(s)) matchedHigh.push(s);
  });
  const matchedMed: string[] = [];
  MED_SIGNALS.forEach((s) => {
    if (text.includes(s)) matchedMed.push(s);
  });
  score += Math.min(20, matchedHigh.length * 4 + matchedMed.length * 2);
  if (matchedHigh.length) reasons.push(`Strong buyer phrase: "${matchedHigh[0]}"`);
  if (matchedMed.length) reasons.push(`Intent phrase: "${matchedMed[0]}"`);

  const budget = (lead.snippet || "").match(
    /\$[\d,]+k?|\d+k\s*\/\s*(?:year|month|hr|hour)|budget of[^.\n]{0,40}/i,
  );
  if (budget) {
    score += 8;
    reasons.push(`Mentions budget/rate: ${budget[0].trim().slice(0, 40)}`);
  }

  if (
    /\basap\b|immediately|urgent(?:ly)?|this week|next week|start now|right away|looking for|need someone|need a\b|mass hiring|hiring asap|eod|cob|need by|deadline/i.test(
      text,
    )
  ) {
    score += 15;
    reasons.push("Urgent / active hiring intent");
  }
  if (/remote|timezone|based in|hybrid|work from home|wfh/i.test(text)) {
    reasons.push("Location/remote specified");
  }
  if (lead.is_decision_maker) {
    score += 10;
    reasons.push("Posted by a decision-maker");
  }

  // skill keyword match — only concrete words, never filler like "with"
  if (qx?.skill) {
    const skillWords = qx.skill
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RELEVANCE_STOPWORDS.has(w.toLowerCase()));
    const matched = skillWords.filter((w) => text.includes(w.toLowerCase()));
    if (matched.length) reasons.push(`Mentions your skill: ${matched.join(", ")}`);
  }

  score += lead.intentBoost ?? 0;
  if ((lead.intentBoost ?? 0) >= 18) reasons.push("From a high-trust hiring source");

  // Stack Exchange askers are evergreen product/tutor demand — floor to warm.
  if (lead.source === "stackexchange") {
    score = Math.max(score, 52);
    reasons.push("Public help-seeking Q&A");
  }

  let final = Math.min(100, Math.max(0, Math.round(score)));

  // ── Task 2.3 / 2.4 — hard warm-cap for leading indicators ──────────────
  // A Form D filing or a funding/expansion article is "this company will
  // likely need you soon", NOT "someone is actively asking right now". Even if
  // it happens to match high-specificity/urgency/budget keywords, it must NOT
  // be allowed to reach hot — otherwise we'd tell the user someone is waiting
  // to hear from them when nobody is. Clamp structurally, not via weights.
  if (lead.signal_type === "leading_indicator" && final >= WARM_CAP + 1) {
    final = WARM_CAP;
    reasons.push("Leading indicator (about to be in-market) — capped to warm");
  }
  const why = reasons.length
    ? `This is a ${final >= 70 ? "hot" : "warm"} buyer signal because ${reasons.slice(0, 3).join("; ").toLowerCase()}.`
    : "";
  return { score: final, reasons, why };
}

/** Hot (≥70) or Warm (≥45). Below warm is dropped — never show "weak"/"signal". */
export function tierFor(score: number): "hot" | "warm" {
  if (score >= 70) return "hot";
  return "warm";
}

// Generic words that must never count as a relevance match on their own —
// "Mentions your skill: with" was a real production bug.
const RELEVANCE_STOPWORDS = new Set([
  "with",
  "that",
  "this",
  "from",
  "their",
  "they",
  "them",
  "have",
  "has",
  "been",
  "were",
  "will",
  "would",
  "could",
  "should",
  "about",
  "into",
  "over",
  "under",
  "more",
  "than",
  "your",
  "then",
  "when",
  "what",
  "which",
  "while",
  "last",
  "past",
  "month",
  "months",
  "week",
  "weeks",
  "year",
  "years",
  "days",
  "currently",
  "recently",
  "hiring",
  "hire",
  "hired",
  "looking",
  "seeking",
  "experience",
  "experienced",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "designer",
  "designers",
  "specialist",
  "specialists",
  "company",
  "companies",
  "team",
  "teams",
  "people",
  "person",
  "candidates",
  "need",
  "needs",
  "needed",
  "want",
  "wants",
  "wanted",
  "open",
  "role",
  "roles",
  "position",
  "positions",
  "opening",
  "openings",
  "job",
  "jobs",
  "mention",
  "mentions",
  "mentioned",
  "remote",
  "work",
  "working",
]);

function meaningfulQueryTokens(raw: string): string[] {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !RELEVANCE_STOPWORDS.has(w) && !/^\d+[+]?$/.test(w));
}

/** Does this query name a specific skill/tech we can hard-gate on? */
function concreteSkillOf(classified: ClassifiedQuery): string | null {
  const skill = (classified.coreSkill || "").trim();
  if (!skill) return null;
  if (skill.length > 40 || skill.split(/\s+/).length > 3) return null;
  if (skill.toLowerCase() === classified.raw.toLowerCase()) return null;
  return skill;
}

function isInvestorHuntQuery(classified: ClassifiedQuery, qx: ExpandedQueries): boolean {
  return /investor|fundraising|raising capital|looking for investors/i.test(
    `${classified.coreSkill} ${classified.raw} ${qx.skill} ${(qx.relatedSkills || []).join(" ")}`,
  );
}

function isRelevantAtSource(
  text: string,
  classified: ClassifiedQuery,
  qx: ExpandedQueries,
): boolean {
  const lower = text.toLowerCase();

  // Investor deal-flow: startup identity rows + raise language count as hits.
  // (Dealroom/NeuronFeed rarely contain the word "investor".)
  if (isInvestorHuntQuery(classified, qx)) {
    if (
      /\b(looking for investors|raising (a |capital|seed|pre-?seed|series)|seeking (investment|investors)|fundraising|open to investors)\b/i.test(
        lower,
      )
    ) {
      return true;
    }
    if (
      /\b(newly founded|just founded|startup|founder)\b/i.test(lower) &&
      /\b(funding|seed|pre-?seed|angel|series[- ]?[a-c]|dealroom|company:)\b/i.test(lower)
    ) {
      return true;
    }
    if (/\bfunding:\s*(seed|pre-?seed|angel|series)/i.test(lower)) return true;
  }

  // Product customer-hunt: match capability keywords, never the whole pitch sentence.
  // Token-level OR — "need more clients" hits "clients" even without "find clients".
  if (classified.type === "product") {
    const terms = [classified.coreSkill, ...classified.relatedSkills, ...(qx.relatedSkills || [])]
      .filter(Boolean)
      .map((t) => t!.toLowerCase().trim())
      .filter((t) => t.length >= 3 && t.length <= 40 && !/^(i'm|selling|product that)$/i.test(t));
    if (!terms.length) return true;
    if (terms.some((t) => lower.includes(t))) return true;
    // Single-token stems from multi-word phrases (+ invoice↔invoicing).
    const tokens = new Set<string>();
    for (const t of terms) {
      for (const w of t.split(/\s+/)) {
        if (w.length < 4 || /^(with|from|that|this|help|need|find|more|manage)$/i.test(w)) continue;
        tokens.add(w);
        if (w.endsWith("ices")) tokens.add(w.slice(0, -1)); // invoices → invoice
        if (w.endsWith("ing") && w.length > 5) tokens.add(w.slice(0, -3));
        if (w === "invoice") tokens.add("invoicing");
        if (w === "invoicing") tokens.add("invoice");
        if (w === "clients") tokens.add("client");
        if (w === "client") tokens.add("clients");
        if (w === "billing") tokens.add("bill");
      }
    }
    if ([...tokens].some((w) => lower.includes(w))) return true;
    // Softwarerecs / marketplace often say "invoicing" / "billing software".
    return /invoice|invoicing|billing|bookkeep|freelance client|client acquisition|crm\b/i.test(
      lower,
    );
  }

  // Tutor: student-need language counts even without the exact word "teacher".
  if (
    /tutor|teacher|tutoring|homework/i.test(`${classified.coreSkill} ${qx.skill} ${classified.raw}`)
  ) {
    if (
      /\b(need (a |an )?(tutor|tutoring|teacher)|looking for (a |an )?(tutor|teacher)|homework help|tutor(ing)? needed|private (tutor|lessons)|struggling with .{0,20}(math|homework|english|physics))\b/i.test(
        lower,
      )
    ) {
      return true;
    }
    if (
      /\b(math|english|sat|act|physics|chemistry|biology|esl|calculus)\b.{0,30}\b(tutor|tutoring|help|lessons)\b/i.test(
        lower,
      )
    ) {
      return true;
    }
  }

  // Plain-English buying signals: when a concrete skill was detected
  // ("next.js"), every lead MUST mention it or a DIRECT variant. Weak family
  // words (javascript/frontend in a stack blurb) do not count — that's how a
  // BizDev role scored 100 on a React search.
  if (classified.signalMode === "buying_signal") {
    // Prefer expander skill when role templates remapped it (investor → fundraising).
    const mapped = (qx.skill || "").trim();
    const skill = mapped && mapped.length <= 40 ? mapped : concreteSkillOf(classified);
    const core = concreteSkillOf(classified);
    if (skill) {
      if (isStronglyRelevantToSkill(text, skill)) return true;
      if (core && core !== skill && isStronglyRelevantToSkill(text, core)) return true;
      // Related crafts — "lead generation services" must also keep SDR / lead gen /
      // appointment-setting ATS rows for the Companies tab.
      const related = [...(qx.relatedSkills || []), ...(classified.relatedSkills || [])]
        .filter(Boolean)
        .slice(0, 10);
      for (const rel of related) {
        if (rel.length < 3 || isWeakFamilyTerm(rel)) continue;
        if (isStronglyRelevantToSkill(text, rel)) return true;
        if (lower.includes(rel.toLowerCase())) return true;
      }
      // Named-company boards: role-query OR is enough (Companies tab volume).
      if (isRelevantToRoleQuery(text, classified.coreSkill, classified.relatedSkills)) {
        return true;
      }
      return false;
    }
    // No concrete skill (e.g. "faced a data breach in the last 12 months"):
    // require at least one distinctive word from the signal to appear.
    const tokens = meaningfulQueryTokens(classified.raw);
    if (!tokens.length) return true;
    return tokens.some((t) => lower.includes(t));
  }
  if (classified.type === "role") {
    return isRelevantToRoleQuery(text, classified.coreSkill, classified.relatedSkills);
  }
  if (isStronglyRelevantToSkill(text, qx.skill)) return true;
  // Related-skill fallback: only concrete related skills, never family words.
  return classified.relatedSkills
    .slice(0, 5)
    .some((s) => s.length > 2 && !isWeakFamilyTerm(s) && lower.includes(s.toLowerCase()));
}

// =====================================================================
// Orchestrator
// =====================================================================
export async function searchAllSources(
  params: SearchParams,
): Promise<{ leads: Lead[]; sources: string[]; debug?: SearchDebug }> {
  // Give this run its own SearXNG allocation. Without the wrapper every search
  // shared one rolling minute, so a second search started moments after the
  // first found the budget already spent and silently skipped social entirely.
  const { withSearxngBudget } = await import("./searxng.server");
  const { withSerpApiBudget } = await import("./serp-providers.server");
  return withSearxngBudget(() =>
    withSerpApiBudget(() => searchAllSourcesInner(params)),
  ) as Promise<{
    leads: Lead[];
    sources: string[];
    debug?: SearchDebug;
  }>;
}

async function searchAllSourcesInner(
  params: SearchParams,
): Promise<{ leads: Lead[]; sources: string[]; debug?: SearchDebug }> {
  const { classified, expanded: qx, prefs } = params;
  const subredditBoosts = [
    ...new Set([...(params.subredditBoosts || []), ...(qx.subreddits || [])].filter(Boolean)),
  ];
  // Paid Discover is opt-in only (USE_PAID_SOURCES=true). Default = free sources.
  const usePaidSources = paidDiscoveryEnabled();
  if (process.env.NODE_ENV === "development") {
    console.info(
      `[searchAllSources] mode=${usePaidSources ? "paid+free" : "FREE-ONLY"} (set USE_PAID_SOURCES=true to enable SerpAPI/Tavily/ScrapeCreators/CoreClaw)`,
    );
  }
  let redditSubCounts: Record<string, number> = {};
  const loc = classified.location ?? prefs?.location ?? null;
  const directoryMode = classified.intentMode === "directory_smb";

  // Directory ICP (e.g. "Marketing Agencies in India"): Places-first, skip global ATS/jobs/Reddit noise.
  //
  // NOTE: a directory query with no location used to `return` an empty result
  // here — zero sources ATTEMPTED, in ~6ms. That made a whole class of natural
  // queries silently produce nothing ("companies looking for writers" reads as
  // a directory query because of the word "companies"). Places search is
  // location-based and genuinely can't run without one, but bailing entirely is
  // the wrong response: fall through to the normal buyer-intent fan-out, which
  // needs no location and is what the user almost certainly meant.
  if (directoryMode && loc) {
    const dirTasks: Array<Promise<SourceLead[]>> = [
      withBudget(searchLocalBusinesses(qx, loc, { directoryMode: true, min: 10 }), []),
      withBudget(searchOsmLocalBusinesses(qx, loc), []),
      withBudget(searchWebBoolean(qx), []),
    ];
    const dirNames = ["localbiz", "osm", "webboolean"];
    if (usePaidSources) {
      dirTasks.push(withBudget(searchSerpAPI(qx), []), withBudget(searchTavily(qx), []));
      dirNames.push("serpapi", "tavily");
    }
    const settled = await Promise.allSettled(dirTasks);
    const all: SourceLead[] = [];
    const sourcesPresent = new Set<string>();
    const sourceCounts: Record<string, number> = {};
    settled.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.length) {
        all.push(...r.value);
        sourcesPresent.add(dirNames[i]);
        sourceCounts[dirNames[i]] = r.value.length;
      }
    });
    return finishSearch(all, sourcesPresent, sourceCounts, classified, qx, {});
  }

  // Buying-signal / client demand queries must never fan out employment boards,
  // even when project goal is "both" (that was flooding Jobicy/GitHub Jobs).
  const clientsOnly =
    classified.goal === "clients" ||
    (classified.goal !== "jobs" && classified.signalMode === "buying_signal");
  const audience = classified.audience ?? "all";
  const peopleOnly = audience === "people";
  // Companies/agencies still need social posts to extract firm names — only
  // skip person-only extras (bluesky flood etc.), not Reddit/LinkedIn.
  const companyFocus = audience === "companies" || audience === "agencies";

  // Buying-signal mode: social + demand sources; job boards only for goal=jobs.
  if (classified.signalMode === "buying_signal" && classified.signalFamily) {
    const family = classified.signalFamily;
    const tasks: Array<Promise<SourceLead[]>> = [];
    const names: string[] = [];
    const add = (name: string, p: Promise<SourceLead[]>, ms = SOURCE_BUDGET_MS) => {
      tasks.push(withBudget(p, [], ms));
      names.push(name);
    };

    const wantJobs =
      (family === "job_opening" || family === "job_description") && classified.goal === "jobs";

    // Always fan out person-authored social for buyer demand (needed for People
    // and for company-name extraction from posts).
    add(
      "reddit",
      searchReddit(qx, subredditBoosts).then((r) => {
        redditSubCounts = r.subCounts;
        return r.leads;
      }),
      CRITICAL_SOURCE_BUDGET_MS,
    );
    add(
      "redditrss",
      searchRedditRss(qx).then((r) => r.leads),
      CRITICAL_SOURCE_BUDGET_MS,
    );
    // Always await socialdorks FIRST among SearXNG consumers (paid or free).
    // Parallel LinkedIn/Twitter/Fiverr races burn the minute budget and leave
    // socialdorks at 0 — measured as Reddit-only Discover when SerpAPI is thin.
    let socialPrefetch: SourceLead[] = [];
    socialPrefetch = await withBudget(searchSocialDorks(qx), [], CRITICAL_SOURCE_BUDGET_MS);
    // Paid path: SerpAPI is the reliable LinkedIn/X/FB path when SearXNG is down.
    let serpPrefetch: SourceLead[] = [];
    if (usePaidSources) {
      serpPrefetch = await withBudget(searchSerpAPI(qx), [], CRITICAL_SOURCE_BUDGET_MS);
    }
    add("hn", searchHackerNews(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("discourse", searchDiscourse(qx));
    add("producthunt", searchProductHunt(qx));
    add("stackexchange", searchStackExchange(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("tenders", searchPublicTenders(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("ted", searchTedTenders(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("dealroom", searchDealroomJustFounded(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("neuronfeed", searchNeuronFeedStartups(qx), CRITICAL_SOURCE_BUDGET_MS);
    // Freelancer.com — critical for writer/video/design gigs (ATS under-serves
    // these crafts). Cap + buyer filter live inside the source.
    add("freelancer", searchFreelancer(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("remoteokapi", searchRemoteOkApi(qx));
    add("workingnomads", searchWorkingNomads(qx));

    // NEW ZERO-AUTH SOURCES (AgentReach equivalents)
    const craigslistP = import("./craigslist-sources.server")
      .then((m) => m.searchCraigslist(qx))
      .catch(() => []);
    add("craigslist", craigslistP, CRITICAL_SOURCE_BUDGET_MS);

    const devtoP = import("./devto-sources.server").then((m) => m.searchDevTo(qx)).catch(() => []);
    add("devto", devtoP, CRITICAL_SOURCE_BUDGET_MS);

    const quoraP = import("./quora-sources.server").then((m) => m.searchQuora(qx)).catch(() => []);
    add("quora", quoraP, CRITICAL_SOURCE_BUDGET_MS);
    // decisionmakers is SearXNG — free path leaves that budget for socialdorks.
    if (usePaidSources) {
      add("decisionmakers", searchRelevantDecisionMakers(qx));
    }
    if (!companyFocus) {
      add("bluesky", searchBluesky(qx));
      add("mastodon", searchMastodon(qx));
      // Parity with skill_role branch — buying_signal was missing Lemmy and
      // communities collapsed to Reddit-only for many client searches.
      add("lemmy", searchLemmy(qx));
    }
    if (usePaidSources) {
      add("scrapecreators", searchScrapeCreators(qx), CRITICAL_SOURCE_BUDGET_MS);
    }

    if (!peopleOnly) {
      // webboolean / youtube / decisionmakers are SearXNG consumers. They used
      // to race socialdorks for the same minute budget and win — leaving social
      // at zero. Only run them when social had room (paid mode), or skip them
      // on the free path where socialdorks is the dedicated social layer.
      if (usePaidSources) {
        add("webboolean", searchWebBoolean(qx));
        add("youtube", searchYouTubeSignals(qx));
        add("decisionmakers", searchRelevantDecisionMakers(qx));
        add("twitter", searchTwitter(qx), CRITICAL_SOURCE_BUDGET_MS);
        add(
          "linkedin",
          searchLinkedIn(qx, { postsOnly: clientsOnly, location: loc }),
          CRITICAL_SOURCE_BUDGET_MS,
        );
      }
      add("upwork", searchUpwork(qx), CRITICAL_SOURCE_BUDGET_MS);
      // GitHub hiring issues + org intent — safe on clients (demand-shaped filters).
      add("github", searchGitHub(qx));
      add("githubhiring", searchGitHubHiringLists(qx));
      // GitHub buyer intent is the opposite shape and safe on the clients path:
      // it only keeps issues whose repo is owned by an ORG with a website, so
      // every lead is a company with a domain the contact layer can work from.
      // Competitor names come from the user's own phrasing ("alternative to
      // Apollo") — without one, the switching templates are skipped rather than
      // run against a category noun that returns nothing.
      add("githubintent", searchGitHubIntent(qx, competitorsFromQuery(classified.raw)));
      // Fiverr + Discord Disboard are SearXNG consumers. Free path: socialdorks
      // already owns the social minute — do not race it.
      if (usePaidSources) {
        add("fiverr", searchFiverrPublic(qx));
        add("discord_public", searchDiscordPublic(qx));
        add("instagram", searchInstagramPublic(qx));
        add("facebook", searchFacebookPublic(qx));
      }
      add("stealth", searchStealthWorker(qx));
      add("samgov", searchSamGov(qx));
      add("news", searchNewsSignals(qx));
      add("secedgar", searchSecEdgar(qx));
      add("startupsgallery", searchStartupsGallery(qx));
      if (loc) {
        add("localbiz", searchLocalBusinesses(qx, loc, { directoryMode: false }));
        add("osm", searchOsmLocalBusinesses(qx, loc));
      }
    }
    // YC Work at a Startup — named companies hiring for this craft (Companies tab).
    if (!peopleOnly) {
      add("workatastartup", searchWorkAtAStartup(qx));
    }
    // ATS boards run on BOTH paths, for different reasons.
    //
    // For goal=jobs they're job listings. For goal=clients they're the single
    // best COMPANY signal we have: a company with an open "Content Writer" role
    // is a company that needs writing done, and it's exactly the "companies
    // showing signals" tier. Gating them behind wantJobs left the Companies tab
    // empty while 2,000+ live Greenhouse openings sat unused.
    //
    // ATS + named-company boards. Jobicy/Arbeitnow every row is "Role @ Company"
    // from a free API — company identity is as strong as Greenhouse. Keeping them
    // jobs-only left ~40 free company signals on the table per search.
    // Skip for product customer-hunts and investor deal-flow (wrong shape).
    const skipEmploymentBoards =
      classified.type === "product" || isInvestorHuntQuery(classified, qx);
    if (!skipEmploymentBoards) {
      add("ashby", searchAshby(qx));
      add("greenhouse", searchGreenhouse(qx));
      add("lever", searchLever(qx));
      add("smartrecruiters", searchSmartRecruiters(qx));
      add("workable", searchWorkable(qx));
      add("recruitee", searchRecruitee(qx));
      add("jobicy", searchJobicy(qx));
      add("arbeitnow", searchArbeitnow(qx));
    }

    if (wantJobs && !skipEmploymentBoards) {
      add("remoteok", searchRemoteOK(qx));
      add("weworkremotely", searchWeWorkRemotely(qx));
      add("remotive", searchRemotive(qx));
      add("githubhiring", searchGitHubHiringLists(qx));
      add("githubjobs", searchGitHubJobRepos(qx, classified));
    }
    // SerpAPI already awaited above when paid — do not double-bill the quota.
    if (usePaidSources) {
      add("tavily", searchTavily(qx), CRITICAL_SOURCE_BUDGET_MS);
    }

    const settled = await Promise.allSettled(tasks);
    const all: SourceLead[] = [];
    const sourcesPresent = new Set<string>();
    const sourceCounts: Record<string, number> = {};
    if (socialPrefetch.length) {
      all.push(...socialPrefetch);
      sourcesPresent.add("socialdorks");
      sourceCounts.socialdorks = socialPrefetch.length;
    } else {
      sourceCounts.socialdorks = 0;
    }
    if (serpPrefetch.length) {
      all.push(...serpPrefetch);
      sourcesPresent.add("serpapi");
      sourceCounts.serpapi = serpPrefetch.length;
    } else if (usePaidSources) {
      sourceCounts.serpapi = 0;
    }
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        // Always record attempted sources (including 0) for Reddit debugging.
        sourceCounts[names[i]] = r.value.length;
        if (r.value.length) {
          for (const lead of r.value) {
            const reasons = lead.match_reasons ?? [];
            const tag = `Matched signal: ${classified.raw.slice(0, 80)} (${names[i]})`;
            if (!reasons.some((x) => x.startsWith("Matched signal:"))) {
              lead.match_reasons = [tag, ...reasons].slice(0, 6);
            }
          }
          all.push(...r.value);
          sourcesPresent.add(names[i]);
        }
      }
    });
    return finishSearch(all, sourcesPresent, sourceCounts, classified, qx, redditSubCounts);
  }

  const tasks: Array<Promise<SourceLead[]>> = [];
  const names: string[] = [];
  const add = (name: string, p: Promise<SourceLead[]>, ms = SOURCE_BUDGET_MS) => {
    tasks.push(withBudget(p, [], ms));
    names.push(name);
  };

  // Social demand — always on for buyer discovery (including company-focus).
  add(
    "reddit",
    searchReddit(qx, subredditBoosts).then((r) => {
      redditSubCounts = r.subCounts;
      return r.leads;
    }),
    CRITICAL_SOURCE_BUDGET_MS,
  );
  add(
    "redditrss",
    searchRedditRss(qx).then((r) => r.leads),
    CRITICAL_SOURCE_BUDGET_MS,
  );
  // Always await socialdorks FIRST; on paid also await SerpAPI before other
  // SearXNG consumers so LinkedIn/X survive when Docker is down.
  let socialPrefetch: SourceLead[] = [];
  socialPrefetch = await withBudget(searchSocialDorks(qx), [], CRITICAL_SOURCE_BUDGET_MS);
  let serpPrefetch: SourceLead[] = [];
  if (usePaidSources) {
    serpPrefetch = await withBudget(searchSerpAPI(qx), [], CRITICAL_SOURCE_BUDGET_MS);
  }
  add("hn", searchHackerNews(qx), CRITICAL_SOURCE_BUDGET_MS);
  add("discourse", searchDiscourse(qx));
  add("producthunt", searchProductHunt(qx));
  add("stackexchange", searchStackExchange(qx), CRITICAL_SOURCE_BUDGET_MS);
  add("tenders", searchPublicTenders(qx), CRITICAL_SOURCE_BUDGET_MS);
  add("ted", searchTedTenders(qx), CRITICAL_SOURCE_BUDGET_MS);
  add("dealroom", searchDealroomJustFounded(qx), CRITICAL_SOURCE_BUDGET_MS);
  add("neuronfeed", searchNeuronFeedStartups(qx), CRITICAL_SOURCE_BUDGET_MS);
  // Freelancer.com — critical for writer/video/design (see clients branch).
  add("freelancer", searchFreelancer(qx), CRITICAL_SOURCE_BUDGET_MS);
  add("remoteokapi", searchRemoteOkApi(qx));
  add("workingnomads", searchWorkingNomads(qx));
  if (usePaidSources) {
    add("decisionmakers", searchRelevantDecisionMakers(qx));
    add("twitter", searchTwitter(qx), CRITICAL_SOURCE_BUDGET_MS);
    add(
      "linkedin",
      searchLinkedIn(qx, { postsOnly: clientsOnly, location: loc }),
      CRITICAL_SOURCE_BUDGET_MS,
    );
    add("webboolean", searchWebBoolean(qx), CRITICAL_SOURCE_BUDGET_MS);
  } else if (
    classified.type === "product" ||
    /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${qx.skill}`)
  ) {
    // Product/tutor volume depends on web dorks when SerpAPI is off.
    add("webboolean", searchWebBoolean(qx), CRITICAL_SOURCE_BUDGET_MS);
  }
  if (!companyFocus) {
    add("bluesky", searchBluesky(qx));
    add("mastodon", searchMastodon(qx));
    add("lemmy", searchLemmy(qx));
  }
  if (!peopleOnly) {
    if (!companyFocus) {
      add("devto", searchDevTo(qx));
      add("lobsters", searchLobsters(qx));
      add("indiehackers", searchIndieHackers(qx));
      add("hashnode", searchHashnode(qx));
      if (usePaidSources) add("youtube", searchYouTubeSignals(qx));
      add("stealth", searchStealthWorker(qx));
    }
  }

  if (usePaidSources) {
    // SerpAPI awaited above — do not double-bill.
    add("scrapecreators", searchScrapeCreators(qx), CRITICAL_SOURCE_BUDGET_MS);
    add("tavily", searchTavily(qx), CRITICAL_SOURCE_BUDGET_MS);
  }

  if (!peopleOnly) {
    add("upwork", searchUpwork(qx), CRITICAL_SOURCE_BUDGET_MS);
    // GitHub hiring / opportunity issues on every path (demand-filtered).
    add("github", searchGitHub(qx));
    add("githubhiring", searchGitHubHiringLists(qx));
    add("githubintent", searchGitHubIntent(qx, competitorsFromQuery(classified.raw)));
    if (usePaidSources) {
      add("fiverr", searchFiverrPublic(qx));
      add("discord_public", searchDiscordPublic(qx));
      add("instagram", searchInstagramPublic(qx));
      add("facebook", searchFacebookPublic(qx));
    }
    add("samgov", searchSamGov(qx));
    add("secedgar", searchSecEdgar(qx));
    add("news", searchNewsSignals(qx));
    add("startupsgallery", searchStartupsGallery(qx));
    if (loc) {
      add("localbiz", searchLocalBusinesses(qx, loc, { directoryMode: false }));
      add("osm", searchOsmLocalBusinesses(qx, loc));
    }
  }

  // YC Work at a Startup — named companies (Companies tab on clients too).
  if (!peopleOnly) {
    add("workatastartup", searchWorkAtAStartup(qx));
  }

  // Employment boards — only when explicitly hunting jobs.
  // Company-identity ATS boards run on EVERY path, not just goal="jobs".
  //
  // This was THE reason Discover looked Reddit-only: `classified.goal` defaults
  // to "clients", so `goal === "jobs"` was false and all six boards were skipped
  // on the path most queries take. searchGreenhouse() alone returns 159 results
  // for "marketing" when called directly — 6,565 live roles across 49 boards
  // were sitting unreachable.
  //
  // For goal=clients these are COMPANY SIGNALS: a company with an open
  // "Content Marketer" role is a company that needs marketing done. That is
  // exactly the Companies tier, and it's why that tab was empty too.
  // Product pitches + investor deal-flow skip employment boards (wrong shape).
  const skipEmploymentBoards = classified.type === "product" || isInvestorHuntQuery(classified, qx);
  if (!peopleOnly && !skipEmploymentBoards) {
    add("ashby", searchAshby(qx));
    add("greenhouse", searchGreenhouse(qx));
    add("lever", searchLever(qx));
    add("smartrecruiters", searchSmartRecruiters(qx));
    add("workable", searchWorkable(qx));
    add("recruitee", searchRecruitee(qx));
    // Named-company free boards — same reason as the buying_signal branch.
    add("jobicy", searchJobicy(qx));
    add("arbeitnow", searchArbeitnow(qx));
  }

  // Pure aggregators stay jobs-only.
  if (!clientsOnly && classified.goal === "jobs") {
    add("remoteok", searchRemoteOK(qx));
    add("usajobs", searchUSAJobs(qx));
    add("weworkremotely", searchWeWorkRemotely(qx));
    add("remotive", searchRemotive(qx));
    add("themuse", searchTheMuse(qx));
    add("githubhiring", searchGitHubHiringLists(qx));
    add("githubjobs", searchGitHubJobRepos(qx, classified));
  }

  const settled = await Promise.allSettled(tasks);
  const all: SourceLead[] = [];
  const sourcesPresent = new Set<string>();
  const sourceCounts: Record<string, number> = {};
  if (socialPrefetch.length) {
    all.push(...socialPrefetch);
    sourcesPresent.add("socialdorks");
    sourceCounts.socialdorks = socialPrefetch.length;
  } else {
    sourceCounts.socialdorks = 0;
  }
  if (serpPrefetch.length) {
    all.push(...serpPrefetch);
    sourcesPresent.add("serpapi");
    sourceCounts.serpapi = serpPrefetch.length;
  } else if (usePaidSources) {
    sourceCounts.serpapi = 0;
  }
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sourceCounts[names[i]] = r.value.length;
      if (r.value.length) {
        all.push(...r.value);
        sourcesPresent.add(names[i]);
      }
    }
  });

  return finishSearch(all, sourcesPresent, sourceCounts, classified, qx, redditSubCounts);
}

// =====================================================================
// Mega-corp exclusion — when the user hunts companies/agencies that need
// their service, Google/Nvidia-class corporations are never real leads:
// they have in-house teams and procurement walls. Hard-excluded on request.
// =====================================================================
const MEGA_CORPS = new Set([
  "google",
  "alphabet",
  "youtube",
  "nvidia",
  "microsoft",
  "apple",
  "amazon",
  "aws",
  "amazon web services",
  "meta",
  "facebook",
  "netflix",
  "tesla",
  "spacex",
  "ibm",
  "oracle",
  "salesforce",
  "adobe",
  "intel",
  "amd",
  "cisco",
  "samsung",
  "sony",
  "dell",
  "hp",
  "lenovo",
  "sap",
  "uber",
  "lyft",
  "airbnb",
  "stripe",
  "paypal",
  "visa",
  "mastercard",
  "jpmorgan",
  "jp morgan",
  "goldman sachs",
  "morgan stanley",
  "bank of america",
  "wells fargo",
  "citigroup",
  "citi",
  "deloitte",
  "pwc",
  "kpmg",
  "ernst and young",
  "ey",
  "accenture",
  "mckinsey",
  "boston consulting",
  "bcg",
  "bain",
  "infosys",
  "tata consultancy services",
  "tcs",
  "wipro",
  "hcl",
  "hcltech",
  "cognizant",
  "capgemini",
  "tech mahindra",
  "walmart",
  "target",
  "costco",
  "nike",
  "adidas",
  "coca cola",
  "coca-cola",
  "pepsi",
  "pepsico",
  "unilever",
  "procter and gamble",
  "johnson and johnson",
  "pfizer",
  "moderna",
  "boeing",
  "airbus",
  "general electric",
  "general motors",
  "ford",
  "toyota",
  "honda",
  "bmw",
  "mercedes",
  "mercedes-benz",
  "volkswagen",
  "siemens",
  "philips",
  "spotify",
  "shopify",
  "atlassian",
  "zoom",
  "dropbox",
  "github",
  "gitlab",
  "openai",
  "anthropic",
  "twitter",
  "x corp",
  "linkedin",
  "tiktok",
  "bytedance",
  "snap",
  "pinterest",
  "reddit",
  "disney",
  "warner bros",
  "comcast",
  "verizon",
  "at and t",
  "att",
  "t-mobile",
  "vodafone",
  "ericsson",
  "nokia",
  "qualcomm",
  "broadcom",
  "texas instruments",
  "micron",
  "asml",
  "tsmc",
  "foxconn",
  "alibaba",
  "tencent",
  "baidu",
  "huawei",
  "xiaomi",
  "palantir",
  "snowflake",
  "databricks",
  "servicenow",
  "workday",
  "intuit",
  "block",
  "square",
  "coinbase",
  "robinhood",
  "instacart",
  "doordash",
  "epic games",
  "activision",
  "electronic arts",
  "ea",
]);

function isMegaCorpLead(lead: Lead): boolean {
  for (const candidate of companyCandidates(lead)) {
    if (MEGA_CORPS.has(candidate)) return true;
    const words = candidate.split(/\s+/);
    if (words.length === 1) continue;
    // Two-word prefix ("goldman sachs group" → "goldman sachs").
    if (MEGA_CORPS.has(words.slice(0, 2).join(" "))) return true;
    // Single-word prefix only for distinctive names and short candidates, so
    // "Google Cloud" is excluded but a startup called "Target Labs" or
    // "Block Party" is NOT swept up by a generic-word prefix.
    if (words.length === 2 && words[0].length >= 6 && MEGA_CORPS.has(words[0])) return true;
  }
  return false;
}

async function finishSearch(
  all: SourceLead[],
  sourcesPresent: Set<string>,
  sourceCounts: Record<string, number>,
  classified: ClassifiedQuery,
  qx: ExpandedQueries,
  redditSubCounts: Record<string, number>,
): Promise<{ leads: Lead[]; sources: string[]; debug?: SearchDebug }> {
  // Task 1.5 — per-source-per-run health log (best-effort, non-blocking).
  try {
    const { buildSourceHealthRows, logSourceHealth } = await import("./observability.server");
    const runId =
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const names = Object.keys(sourceCounts);
    const fakeSettled = names.map((n) => ({
      status: "fulfilled" as const,
      value: Array.from({ length: sourceCounts[n] || 0 }),
    }));
    const rows = buildSourceHealthRows(runId, classified.raw, names, fakeSettled as any);
    void logSourceHealth(rows);
  } catch {
    /* observability must never break discovery */
  }

  const rawCount = all.length;
  const directoryMode = classified.intentMode === "directory_smb";
  const gateSkill = directoryMode ? null : concreteSkillOf(classified);

  // ── Junk gate: one place, every source ────────────────────────────────────
  //
  // Applied here rather than per-source because the same four shapes came back
  // from every surface we read. Measured on a live "designer" run: of 46
  // "leads", 23 were Fiverr seller gigs ("I will build website front end…") and
  // 20 were Discord directory pages ("Discord servers tagged with logo-design")
  // — 43 of 46 were things nobody can be contacted about.
  //
  // Only the EXPLICIT rejects drop. "no_signal" is kept on purpose: a company
  // signal (an SEC Form D, an ATS job opening) is a legitimate leading
  // indicator even though nobody stated a need in prose. Dropping those would
  // empty the Companies category.
  const junkCounts: Record<string, number> = {};
  const DROP_REASONS = new Set(["self_promotion", "aggregator", "editorial", "seeker"]);
  const deJunked = all.filter((l) => {
    const verdict = classifyDemand({
      title: l.title || "",
      body: l.snippet || "",
      url: l.full_post_url || "",
    });
    if (verdict.isDemand) {
      // Promote the reason into the UI — this is the "why this matched" line.
      if (!l.why_match) l.why_match = verdict.reason;
      l.intentBoost = (l.intentBoost ?? 0) + Math.round(verdict.boost / 2);
      return true;
    }
    if (verdict.rejectedAs && DROP_REASONS.has(verdict.rejectedAs)) {
      junkCounts[verdict.rejectedAs] = (junkCounts[verdict.rejectedAs] ?? 0) + 1;
      return false;
    }
    return true; // no_signal → keep as a company/leading-indicator lead
  });
  if (process.env.NODE_ENV === "development" && Object.keys(junkCounts).length) {
    console.info(
      `[junk-gate] dropped ${all.length - deJunked.length}/${all.length}: ` +
        Object.entries(junkCounts)
          .map(([k, n]) => `${k}=${n}`)
          .join(" "),
    );
  }

  // Skill relevance — for directory mode, Places leads already match ICP/location
  const relevant = deJunked.filter((l) => {
    if (directoryMode && (l.source === "geoapify" || l.source === "foursquare")) return true;
    const text = `${l.title} ${l.snippet}`;
    return isRelevantAtSource(text, classified, qx);
  });

  // Quantity WITH honesty: relatedExtras re-admit weak matches — disabled for
  // clients (bare "web"/"development" was flooding results with wrong roles).
  // Product + tutor personas are sparse; re-admit skill-adjacent demand rows.
  const relatedExtras: SourceLead[] = [];
  const allowRelatedExtras =
    classified.type === "product" ||
    /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${qx.skill}`);
  if (
    gateSkill &&
    !directoryMode &&
    (allowRelatedExtras ||
      (classified.goal !== "clients" && classified.signalMode !== "buying_signal"))
  ) {
    const strongSet = new Set(relevant);
    // deJunked, not `all` — otherwise weak-match re-admission becomes a back
    // door that puts the seller gigs and listicles straight back in.
    for (const l of deJunked) {
      if (relatedExtras.length >= (allowRelatedExtras ? 40 : 15)) break;
      if (strongSet.has(l)) continue;
      if (isRelevantToSkill(`${l.title} ${l.snippet}`, gateSkill)) relatedExtras.push(l);
      else if (
        allowRelatedExtras &&
        (qx.relatedSkills || []).some(
          (s) => s.length > 3 && `${l.title} ${l.snippet}`.toLowerCase().includes(s.toLowerCase()),
        )
      ) {
        relatedExtras.push(l);
      }
    }
  }
  const relatedSet = new Set(relatedExtras);
  const pool = [...relevant, ...relatedExtras];

  const afterRelevance = pool.length;
  const scored = pool
    .map((l) => {
      const { score, reasons } = scoreAndReason(l, qx);
      // Directory SMB boost
      let s = score;
      const reasonsOut = [...reasons];
      if (directoryMode && (l.source === "geoapify" || l.source === "foursquare")) {
        s = Math.min(100, Math.max(s, 55) + 10);
      }
      // Title-level skill gating: a dedicated "<skill> role" outranks a post
      // that only name-drops the skill in its description. Job-board listings
      // whose ROLE TITLE doesn't mention the skill can never be hot.
      if (gateSkill && s > 0) {
        const titleMatch = isStronglyRelevantToSkill(l.title || "", gateSkill);
        if (titleMatch) {
          s = Math.min(100, s + 10);
          reasonsOut.unshift(`Role/title mentions ${gateSkill}`);
        } else if (JOB_BOARD_SOURCES.has(l.source)) {
          s = Math.min(s, WARM_CAP - 4);
          reasonsOut.push(`${gateSkill} appears in the description, not the role title`);
        }
      }
      // Related-tier leads: shown for volume, never above real matches.
      // Product/tutor relatedExtras must stay ≥ warm floor (45) or they vanish.
      if (relatedSet.has(l)) {
        const relatedCap =
          classified.type === "product" ||
          /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${qx.skill}`)
            ? 52
            : 44;
        s = Math.min(s, relatedCap);
        if (relatedCap >= 45) s = Math.max(s, 45);
        reasonsOut.push("Related field — not an exact skill match");
      }
      // Location: boost confirmed place; mild demote when no geo at all so we
      // never rank "unknown place" above an explicit geo match. Hard foreign
      // rejects already happen in passesLocationFilter — no invented locations.
      if (classified.location && s > 0) {
        const locLower = classified.location.toLowerCase();
        const hay = `${l.title} ${l.snippet}`.toLowerCase();
        if (hay.includes(locLower)) {
          s = Math.min(100, s + 10);
          reasonsOut.push(`Mentions ${classified.location}`);
        } else if (
          !/\b(remote|worldwide|global|anywhere|work from home|wfh)\b/i.test(hay) &&
          !/\b(based in|located in|in [A-Z][a-z]+|[A-Z]{2}\b)/.test(`${l.title} ${l.snippet}`)
        ) {
          s = Math.max(45, s - 4);
        }
      }
      // Investor / startup feeds: ensure warm floor so deal-flow volume survives.
      if (
        (l.source === "dealroom" || l.source === "neuronfeed" || l.source === "startupsgallery") &&
        isInvestorHuntQuery(classified, qx)
      ) {
        s = Math.max(s, 52);
        if (!reasonsOut.some((r) => /deal-flow|startup feed/i.test(r))) {
          reasonsOut.push("Startup feed — investor deal-flow");
        }
      }
      const why = reasonsOut.length
        ? `This is a ${s >= 70 ? "hot" : "warm"} buyer signal because ${reasonsOut.slice(0, 3).join("; ").toLowerCase()}.`
        : "";
      return {
        ...l,
        score: s,
        tier: tierFor(s),
        match_reasons: reasonsOut.slice(0, 6),
        why_match: why,
      };
    })
    // Warm floor — drop sub-warm so UI never shows weak/no-signal badges.
    .filter((l) => (l.score ?? 0) >= 45);

  const afterScore = scored.length;

  const urlSeen = new Set<string>();
  const deduped = scored.filter((l) => {
    if (!l.full_post_url || urlSeen.has(l.full_post_url)) return false;
    urlSeen.add(l.full_post_url);
    return true;
  });

  // URL_BLOCKLIST exists to reject junk found on the OPEN WEB — wiki pages,
  // tutorials, and aggregator hosts a SERP dork wanders into. It should not be
  // applied to leads we fetched deliberately from a marketplace's own API.
  //
  // freelancer.com is on that list, so the entire Freelancer integration was
  // being deleted here, one filter BEFORE the isEmploymentShapedLead exemption
  // added for the same reason. Measured on "need a design": 54 projects fetched,
  // 0 reached the ranker. A freelancer.com page stumbled into by a web search is
  // still noise; a project pulled from the API is one client describing one job.
  const blocklisted: Record<string, number> = {};
  let cleaned = deduped.filter((l) => {
    if (FIRST_PARTY_MARKETPLACE_SOURCES.has(l.source)) return true;
    const u = (l.full_post_url || "").toLowerCase();
    if (URL_BLOCKLIST.some((b) => u.includes(b))) {
      blocklisted[l.source] = (blocklisted[l.source] ?? 0) + 1;
      return false;
    }
    return true;
  });
  if (process.env.SCRAPIVO_DEBUG_STAGES && Object.keys(blocklisted).length) {
    const why = Object.entries(blocklisted)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}:${n}`)
      .join(" ");
    console.log(`[url-blocklist] ${deduped.length} → ${cleaned.length}  dropped ${why}`);
  }

  // Hard-exclude mega-corps when hunting companies/agencies that would
  // genuinely need the user's service.
  if (classified.audience === "companies" || classified.audience === "agencies") {
    cleaned = cleaned.filter((l) => !isMegaCorpLead(l));
  }

  // Clients: heavily demote undated SERP/web list-shaped leads; drop them
  // entirely when we already have enough dated social demand.
  if (classified.goal === "clients" || classified.signalMode === "buying_signal") {
    const datedSocial = cleaned.filter((l) => {
      if (!l.posted_at) return false;
      const src = l.source || "";
      return (
        src === "reddit" ||
        src === "twitter" ||
        src === "hn" ||
        src === "bluesky" ||
        src === "mastodon" ||
        src === "linkedin" ||
        src === "instagram" ||
        src === "facebook"
      );
    }).length;
    cleaned = cleaned
      .map((l) => {
        // Fill missing dates from title/snippet before age gates.
        if (!l.posted_at) {
          const extracted = extractDateFromText(`${l.title || ""} ${l.snippet || ""}`);
          if (extracted) l = { ...l, posted_at: extracted };
        }
        if (l.posted_at) return l;
        const src = l.source || "";
        // Company / tender / startup identity rows are undated by nature —
        // never demote them under the warm floor (≥45) or Companies empties.
        const companyish =
          src === "greenhouse" ||
          src === "lever" ||
          src === "ashby" ||
          src === "smartrecruiters" ||
          src === "workable" ||
          src === "recruitee" ||
          src === "jobicy" ||
          src === "arbeitnow" ||
          src === "dealroom" ||
          src === "neuronfeed" ||
          src === "tenders" ||
          src === "samgov" ||
          src === "secedgar" ||
          src === "startupsgallery" ||
          src === "workatastartup" ||
          src === "geoapify" ||
          src === "foursquare" ||
          src === "news";
        if (companyish) return l;

        const engineDay = l.freshness_window === "day" || l.freshness_window === "hour";
        // Undated social: demote but stay ≥ warm floor when engine time-boxed
        // or demand-verified — otherwise warm floor (≥45) silently zeros Posts.
        if (
          src === "reddit" ||
          src === "twitter" ||
          src === "hn" ||
          src === "bluesky" ||
          src === "mastodon" ||
          src === "linkedin" ||
          src === "instagram" ||
          src === "facebook" ||
          src === "serpapi" ||
          src === "tavily" ||
          src === "searxng" ||
          src === "discourse" ||
          src === "quora" ||
          src === "substack"
        ) {
          const cap = engineDay || l.demand_verified ? 48 : 40;
          return {
            ...l,
            score: Math.min(l.score ?? 0, cap),
            match_reasons: [...(l.match_reasons ?? []), "Date unknown (demoted)"].slice(0, 6),
          };
        }
        // Other undated: soft demote but keep warm-eligible.
        return {
          ...l,
          score: Math.min(l.score ?? 0, 48),
          match_reasons: [...(l.match_reasons ?? []), "Date unknown (demoted)"].slice(0, 6),
        };
      })
      .filter((l) => {
        const src = l.source || "";
        const socialish =
          src === "instagram" ||
          src === "facebook" ||
          src === "linkedin" ||
          src === "twitter" ||
          src === "reddit" ||
          src === "hn" ||
          src === "bluesky" ||
          src === "mastodon" ||
          src === "serpapi" ||
          src === "tavily" ||
          src === "searxng";
        if (socialish && l.posted_at) {
          return isRecent(l.posted_at, CLIENTS_SOCIAL_MAX_AGE_DAYS);
        }
        // Undated social: keep engine day/hour window (2d chip trusts that);
        // week + demand_verified kept when dated social is still thin.
        if (socialish && !l.posted_at) {
          const engineDay = l.freshness_window === "day" || l.freshness_window === "hour";
          if (engineDay) return true;
          if (l.freshness_window === "week" && l.demand_verified === true && datedSocial < 6) {
            return true;
          }
          if (datedSocial >= 4) return false;
          if (l.freshness_window === "week") return false;
          return true;
        }
        if (
          datedSocial >= 6 &&
          (src === "serpapi" || src === "tavily" || src === "webboolean" || src === "searxng")
        ) {
          return false;
        }
        return true;
      });
  }

  // Clients goal: drop pure employment aggregators, but KEEP freelance
  // marketplaces (Upwork) and named-company hiring (LinkedIn Jobs @ Co, HN
  // Who-is-hiring with contractor language) — those populate Companies.
  const FREELANCE_DEMAND_RE =
    /\b(need a|need an|looking for a|who can|willing to pay|freelancer needed|budget|contractor|gig|seeking freelancer|need someone to|contract(or)?|part[- ]?time)\b/i;
  const EMPLOYMENT_LISTING_RE =
    /\b(job description|full[- ]?time|apply (now|here|at)|open roles?|years? of experience|salary range|benefits package|job posting|we're hiring for|we are hiring for)\b/i;
  const MARKETPLACE_HOST_RE =
    /toptal\.com|freelancer\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|simplyhired\.com|dice\.com/i;
  const CLIENT_DROP_BOARDS = new Set([
    // jobicy / arbeitnow REMOVED — they name a company in every row
    // ("Designer @ Acme") and are free APIs. Dropping them emptied the
    // Companies tab on the clients path while ATS alone couldn't hit
    // double-digit volume. Still drop pure aggregators with no firm identity.
    "remotive",
    "remoteok",
    "githubjobs",
    // githubhiring kept — public "who is hiring" issue threads are opportunity
    // posts, not Indeed-style aggregators.
    "themuse",
    "weworkremotely",
    "usajobs",
  ]);

  /** Never treat these as "employment aggregator noise" — they ARE the mix. */
  const NEVER_EMPLOYMENT_DROP = new Set([
    "hn",
    "reddit",
    "redditrss",
    "linkedin",
    "twitter",
    "instagram",
    "facebook",
    "threads",
    "quora",
    "serpapi",
    "tavily",
    "discourse",
    "lemmy",
    "mastodon",
    "bluesky",
    "github",
    "githubhiring",
    "githubintent",
    "secedgar",
    "tenders",
    "samgov",
    "news",
    "startupsgallery",
    "dealroom",
    "workatastartup",
    "indiehackers",
    "devto",
    "lobsters",
    "producthunt",
  ]);

  function isEmploymentShapedLead(l: (typeof cleaned)[number]): boolean {
    // Businesses posting freelance gigs → keep for clients. See
    // FIRST_PARTY_MARKETPLACE_SOURCES for why the host match is wrong here.
    if (FIRST_PARTY_MARKETPLACE_SOURCES.has(l.source)) return false;
    if (NEVER_EMPLOYMENT_DROP.has(l.source)) return false;
    if (CLIENT_DROP_BOARDS.has(l.source)) return true;
    if (l.source === "githubjobs") return true;
    const url = (l.full_post_url || "").toLowerCase();
    if (MARKETPLACE_HOST_RE.test(url)) return true;
    const text = `${l.title} ${l.snippet}`;
    const plat = `${l.platform || ""}`.toLowerCase();
    // LinkedIn Jobs with "Role @ Company" is a named company lead — keep.
    if (/linkedin jobs/i.test(plat) || (l.source === "linkedin" && /\/jobs?[\/?#]/.test(url))) {
      if (/@\s*\S+/.test(l.title || "") || cleanishAuthor(l.author)) return false;
      return true;
    }
    if (/\/jobs?[\/?#]/.test(url) && !/linkedin\.com\/posts\//.test(url)) {
      // ATS pages with a firm author → company signal; bare aggregator → drop.
      if (cleanishAuthor(l.author) || /@\s*\S+/.test(l.title || "")) return false;
      return true;
    }
    if (plat.includes("who is hiring") || plat.includes("who's hiring")) {
      // Keep contractor / freelance asks inside HN threads.
      if (FREELANCE_DEMAND_RE.test(text)) return false;
      return true;
    }
    if (/web:\s*hiring\/job/i.test(l.platform || "")) return true;
    if (FREELANCE_DEMAND_RE.test(text) && !MARKETPLACE_HOST_RE.test(url)) return false;
    if (l.source === "news" && EMPLOYMENT_LISTING_RE.test(text)) return true;
    if (
      EMPLOYMENT_LISTING_RE.test(text) &&
      !/\b(need a|looking for|who can|freelancer|contractor)\b/i.test(text)
    ) {
      return true;
    }
    // Remaining classic job boards (Ashby etc.) keep when they name a company.
    if (JOB_BOARD_SOURCES.has(l.source)) {
      return !(cleanishAuthor(l.author) || /@\s*\S+/.test(l.title || ""));
    }
    return false;
  }

  function cleanishAuthor(author?: string | null): boolean {
    const a = (author || "").trim();
    if (!a || a.length < 2) return false;
    return !/^(anon|unknown|deleted|\[deleted\]|upwork client|client)$/i.test(a);
  }

  if (
    classified.goal === "clients" ||
    (classified.goal !== "jobs" && classified.signalMode === "buying_signal")
  ) {
    // `afterLlm` in the debug payload counts everything from here to the LLM, so
    // a wholesale drop at this filter reads as "the LLM ate them". Attribute it.
    const beforeEmployment = cleaned.length;
    const employmentDropped: Record<string, number> = {};
    cleaned = cleaned.filter((l) => {
      if (!isEmploymentShapedLead(l)) return true;
      employmentDropped[l.source] = (employmentDropped[l.source] ?? 0) + 1;
      return false;
    });
    if (process.env.SCRAPIVO_DEBUG_STAGES && beforeEmployment) {
      const why = Object.entries(employmentDropped)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}:${n}`)
        .join(" ");
      console.log(
        `[employment-shaped] ${beforeEmployment} → ${cleaned.length}${why ? `  dropped ${why}` : ""}`,
      );
    }
    // Soft-demote remaining news / company-hiring narratives without demand phrasing.
    cleaned = cleaned.map((l) => {
      const text = `${l.title} ${l.snippet}`;
      const plat = `${l.platform || ""}`.toLowerCase();
      if (
        (l.source === "news" || plat.includes("who is hiring")) &&
        !FREELANCE_DEMAND_RE.test(text)
      ) {
        return {
          ...l,
          score: Math.min(l.score ?? 0, 42),
          match_reasons: [
            ...(l.match_reasons ?? []),
            "Company hiring signal (demoted for clients)",
          ].slice(0, 6),
        };
      }
      return l;
    });
  }

  cleaned.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // Skip LLM classify for directory SMB (Places listings aren't buyer posts)
  // Prefer social demand posts for verification (not leftover job pages).
  const SOCIAL_VERIFY_SOURCES = new Set([
    "reddit",
    "hn",
    "twitter",
    "bluesky",
    "mastodon",
    "lemmy",
    "linkedin",
    "devto",
    "hashnode",
    "lobsters",
    "indiehackers",
    "youtube",
    "instagram",
  ]);
  const llmPool = directoryMode
    ? []
    : [
        ...cleaned.filter((l) => SOCIAL_VERIFY_SOURCES.has(l.source)),
        ...cleaned.filter((l) => !SOCIAL_VERIFY_SOURCES.has(l.source)),
      ].slice(0, 40);
  let verified = cleaned;
  const skipLlm = process.env.SKIP_LLM_CLASSIFY === "true" || directoryMode;
  try {
    if (!skipLlm && llmPool.length) {
      const labels = await classifyIntents(
        qx.role || qx.skill || classified.raw,
        llmPool.map((l, idx) => ({
          id: String(idx),
          title: l.title,
          snippet: l.snippet,
          platform: l.platform,
        })),
      );
      if (Object.keys(labels).length > 0) {
        const boostedByUrl = new Map<string, (typeof cleaned)[number]>();
        const dropUrls = new Set<string>();
        for (let idx = 0; idx < llmPool.length; idx++) {
          const label = labels[String(idx)];
          const l = llmPool[idx];
          if (!label) continue;
          // Soft path: only hard-drop clear seekers / high-confidence junk.
          if (shouldHardDropByLlm(label)) {
            dropUrls.add(l.full_post_url);
            continue;
          }
          const buyerish =
            label.intent === "hiring" ||
            label.intent === "buying" ||
            label.intent === "researching";
          // Non-buyer LLM labels: demote silently — never "AI soft-kept" in UI.
          if (!buyerish || label.role_in_post === "observer") {
            boostedByUrl.set(l.full_post_url, {
              ...l,
              score: Math.min(l.score ?? 0, 32),
              ai_intent: label.intent,
              ai_confidence: label.confidence,
              ai_evidence: label.evidence,
              ai_role_in_post: label.role_in_post,
            });
            continue;
          }
          const bonus = label.intent === "hiring" ? 20 : label.intent === "buying" ? 12 : 6;
          boostedByUrl.set(l.full_post_url, {
            ...l,
            score: Math.min(100, (l.score ?? 0) + Math.round(bonus * label.confidence)),
            ai_intent: label.intent,
            ai_confidence: label.confidence,
            ai_evidence: label.evidence,
            ai_role_in_post: label.role_in_post,
            match_reasons: [
              ...(l.match_reasons ?? []),
              `AI-verified ${label.intent} (${Math.round(label.confidence * 100)}%)`,
            ].slice(0, 6),
          });
        }
        verified = cleaned
          .filter((l) => !dropUrls.has(l.full_post_url))
          .map((l) => boostedByUrl.get(l.full_post_url) ?? l);
        // Do not restore non-buyer rows just to fill volume — that re-admitted POV.
        verified.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }
    }
  } catch (err) {
    console.warn("[searchAllSources] LLM verification skipped:", (err as Error)?.message);
  }

  const afterLlm = verified.length;
  verified.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const { scoreUrgency } = await import("./intent-lexicon");
  const { enrichLeadWhy } = await import("../scoring");
  const { scoreLegitimacy } = await import("./legitimacy");
  const enriched: Lead[] = verified.map(({ intentBoost, ...rest }) => {
    let lead = cleanLead(rest as any) as Lead;
    const text = `${lead.title} ${lead.snippet}`;
    const has_budget =
      /\$[\d,]+k?|\d+k\s*\/\s*(?:yr|year|month|mo|hr|hour)|budget|salary|compensation|rate:|paid/i.test(
        text,
      );
    const urg = scoreUrgency(text);
    lead.platform_label = lead.platform;
    lead.signal_type = lead.signal_type ?? "direct_intent";
    lead.intent_score = lead.score;
    lead.intent_tier = lead.tier;
    lead.has_budget = has_budget;
    lead.has_urgency = urg.hasUrgency;
    lead.source_confidence = platformBase(lead.platform || "") * 4;
    // "Someone's Post - LinkedIn" SERP titles say nothing — use the actual
    // post text as the title instead.
    if (
      /linkedin post/i.test(lead.platform || "") &&
      /('s|s')\s+post\s*$|-\s*linkedin\s*$|on linkedin\s*$/i.test(lead.title) &&
      (lead.snippet || "").length > 40
    ) {
      lead.title = lead.snippet.slice(0, 110);
    }
    lead.posted_at_relative = relativeTime(lead.posted_at);
    lead.ai_summary = summarize(lead.title, lead.snippet);
    lead = enrichLeadWhy(lead);
    const legit = scoreLegitimacy(lead);
    lead.verification_level = legit.level;
    lead.legitimacy_flags = legit.flags;
    lead.legitimacy_proofs = legit.proofs;
    return lead;
  });

  // Scam gate: flagged posts never reach the user.
  const legitimate = enriched.filter((l) => l.verification_level !== "scam");

  const fused = fuseCompanySignals(legitimate);

  const debug: SearchDebug = {
    rawCount,
    afterRelevance,
    afterScore,
    afterLlm,
    redditBySub: Object.keys(redditSubCounts).length ? redditSubCounts : undefined,
    sourceCounts: Object.keys(sourceCounts).length ? sourceCounts : undefined,
  };
  return { leads: fused, sources: Array.from(sourcesPresent), debug };
}

function relativeTime(iso?: string): string {
  if (!iso) return "Recently (undated)";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return "Recently (undated)";
  const m = Math.floor(diff / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

function summarize(title: string, body: string): string {
  const text = `${title}. ${body}`.replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  return (sentences[0] || title || "").slice(0, 220);
}
