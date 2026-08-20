// =====================================================================
// Reddit — real-time, and deliberately OUTSIDE Reddit's contract
//
// Three transports, tried in this order. The ordering is a legal decision as
// much as a technical one:
//
//   1. ARCTIC SHIFT (default) — a third-party public archive. Real-time
//      (measured 0.1h lag), ~120k req/hr, 100 posts/page, and critically: we
//      never authenticate to Reddit, never register an app, and therefore never
//      accept Reddit's Developer Terms. That matters because Reddit's
//      Responsible Builder Policy forbids commercialising Reddit data without
//      written approval — a restriction that binds you *through those terms*.
//   2. OAUTH (opt-in, REDDIT_CLIENT_ID/SECRET) — 100 queries/minute, but
//      registering the app accepts the Developer Terms. Fine for development;
//      think before shipping it commercially.
//   3. PUBLIC RSS (fallback) — no terms accepted either, but Reddit 429s after
//      roughly 8 requests, so a run covers about one subreddit.
//
// What this replaced, and why: the original path was PullPush + reddit.com
// JSON. PullPush's archive runs ~14 MONTHS behind (measured 2026-07-29: newest
// r/forhire post was 10,470h old), so every result failed the freshness gate
// and Reddit silently contributed ZERO leads while costing ~26s per run.
// reddit.com/*.json and old.reddit.com/*.json both 403 server-side regardless
// of User-Agent.
// =====================================================================
import type { Lead } from "../scoring";
import { isRecent, type ExpandedQueries } from "./query-expander";
// One shared demand gate for every source — see demand-classifier.ts for why
// rejects (self-promo, listicles, editorial, seekers) run before accepts.
import { classifyDemand, matchesCraft } from "./demand-classifier";
import {
  extractImageText,
  looksLikeImageUrl,
  MAX_VISION_CALLS_PER_SEARCH,
} from "../vision/image-text.server";

type SourceLead = Lead & { intentBoost?: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Feeds change fast but not per-second; one fetch per sub per 4 min is plenty. */
const CACHE_MS = 4 * 60_000;
/** Reddit 429s aggressively — stop the whole run rather than push through. */
const STOP_AFTER_429 = 1;
// Arctic Shift allows 120k req/hr and the subs are polled in parallel, so the
// old cap of 10 was leaving most of the demand side of Reddit unread — which
// is where the freelance asks actually concentrate.
// Raised from 30 once the feeds started overlapping: the fetch phase is now
// bounded by concurrency rather than by count, so more subs cost wall-clock
// sub-linearly. Reddit is where the informal "I need help with X" asks live,
// and that is the half of the market the job boards structurally cannot see.
const MAX_SUBS = 45;
/**
 * Reddit's per-IP budget for these feeds is small — measured here, a burst of
 * ~8 requests earns a 429. Spacing at ~1.8s with jitter keeps a normal run
 * under the limit. If you want real headroom, set REDDIT_CLIENT_ID/SECRET:
 * a free OAuth app raises this to 100 requests/minute and makes the source
 * genuinely consistent instead of best-effort.
 */
const INTER_FETCH_MS = 1800;
/**
 * Subreddit feeds pulled at once, but only on Arctic Shift / OAuth. The bare
 * RSS fallback 429s after ~8 requests and a single 429 aborts the run, so that
 * path stays strictly serial.
 */
const FEED_CONCURRENCY = 6;
/** Whole-batch ceiling for image transcription — see the call site. */
const VISION_DEADLINE_MS = 7000;

const cache = new Map<string, { at: number; xml: string }>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── the subreddits where people ASK for work to be done ─────────────────────
//
// Split deliberately: "demand" subs are where buyers post, "marketplace" subs
// carry both buyers and sellers and need tag filtering. A subreddit full of
// portfolios is worse than useless — it's the seller side of our own market.
const DEMAND_SUBS = [
  "forhire",
  "slavelabour",
  "DoneDirtCheap",
  "HireaWriter",
  "hiring",
  "JobFair",
  "freelance_forhire",
  "b2bforhire",
  "DesignJobs",
  "VideoEditingRequests",
  "HireanArtist",
  "artcommissions",
  "commissions",
  "HungryArtists",
  "Jobs4Bitcoins",
  "WorkOnline",
  "RemoteJobHunters",
  "ProofreadingServices",
  "writingopportunities",
  "freelanceWriters",
  "PhotoshopRequest",
  "RequestABot",
  "MusicianRequests",
  "AnimationRequests",
];

/** Where founders/owners describe problems they'd pay to solve. */
const BUSINESS_SUBS = [
  "smallbusiness",
  "Entrepreneur",
  "startups",
  "SaaS",
  "ecommerce",
  "shopify",
  "marketing",
  "AskMarketing",
  "advertising",
  "webdev",
  "web_design",
  "graphic_design",
  "logodesign",
  "videoediting",
  "editors",
  "podcasting",
  "nonprofit",
  "restaurateur",
  "realestateinvesting",
  "copywriting",
  "content_marketing",
  "socialmedia",
  "SEO",
  "PPC",
  "FacebookAds",
  "Emailmarketing",
  "Wordpress",
  "webflow",
  "Etsy",
  "smallbusinessadvice",
  "AskAgency",
  "consulting",
  "explainlikeimfive_biz",
];

/**
 * Choose which subs to poll. Query-derived subs lead (the classifier already
 * maps "designer" → r/graphic_design etc.), then the always-on demand subs,
 * then business subs to fill the budget.
 */
export function selectSubs(qx: ExpandedQueries, limit = MAX_SUBS): string[] {
  const fromQuery = (qx.subreddits ?? []).map((s) => s.replace(/^r\//i, "").trim());
  const merged = [...DEMAND_SUBS, ...fromQuery, ...BUSINESS_SUBS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of merged) {
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Atom parsing ────────────────────────────────────────────────────────────

export type RedditEntry = {
  title: string;
  url: string;
  author: string;
  authorUrl: string;
  updated: string;
  content: string;
  subreddit: string;
  /** Set when the submission IS an image — the post's text lives in the picture. */
  imageUrl?: string;
};

function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#32;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse Reddit's Atom feed. Deliberately regex-based — no XML dep in this app. */
export function parseRedditAtom(xml: string, subreddit: string): RedditEntry[] {
  const out: RedditEntry[] = [];
  for (const block of xml.split("<entry>").slice(1)) {
    const title = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "");
    const url = (/<link[^>]+href="([^"]+)"/.exec(block)?.[1] ?? "").replace(/&amp;/g, "&");
    const updated = /<updated>([\s\S]*?)<\/updated>/.exec(block)?.[1]?.trim() ?? "";
    const authorName = stripHtml(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(block)?.[1] ?? "");
    const authorUri = /<author>[\s\S]*?<uri>([\s\S]*?)<\/uri>/.exec(block)?.[1]?.trim() ?? "";
    const content = stripHtml(/<content[^>]*>([\s\S]*?)<\/content>/.exec(block)?.[1] ?? "");
    if (!title || !url) continue;
    out.push({
      title,
      url,
      author: authorName.replace(/^\/u\//, ""),
      authorUrl: authorUri,
      updated,
      content,
      subreddit,
    });
  }
  return out;
}

// ── Arctic Shift: real-time Reddit WITHOUT Reddit's contract ────────────────
//
// This is the preferred transport, and the reason is legal as much as technical.
//
// Reddit's Responsible Builder Policy forbids commercialising Reddit data
// without written approval — but that policy binds you through the Developer
// Terms, which you accept by registering an app and using OAuth. Reading a
// third-party public archive means we never authenticate to Reddit, never
// register an app, and never accept those terms. That's the same logged-out
// posture the Meta v. Bright Data ruling protects.
//
// Technically it also happens to be the best option available:
//   • measured 2026-07-30: newest r/forhire post was 0.1h old — genuinely real-time
//     (PullPush, by contrast, was 14 MONTHS stale, which is why it produced nothing)
//   • ~120,000 requests/hour unauthenticated, vs ~8 before Reddit RSS 429s
//   • 100 posts per page, vs 50 from RSS
//
// Caveat worth knowing: full-text search across all of Reddit is NOT available
// (`q=` returns 400) — you can only list a subreddit. That's fine here, because
// this module works by polling curated demand subreddits, not by searching.
const ARCTIC_SHIFT_BASE = "https://arctic-shift.photon-reddit.com/api/posts/search";
const ARCTIC_SHIFT_IDS = "https://arctic-shift.photon-reddit.com/api/posts/ids";

/**
 * Second-pass liveness check.
 *
 * The search endpoint returns the archive's snapshot from when it first
 * ingested the post, so a submission removed by a moderator AFTER ingest still
 * looks alive — the user clicks through to "[Removed by moderator]". Arctic
 * Shift re-fetches posts later (each row carries `_meta.retrieved_2nd_on`), so
 * asking for the ids again returns the newer state.
 *
 * Fails open: if the check itself errors we keep the posts rather than
 * returning an empty feed over a flaky lookup.
 */
export async function dropRemovedPosts<T extends { full_post_url?: string }>(
  entries: T[],
): Promise<T[]> {
  const idOf = (u: string) => /\/comments\/([a-z0-9]+)/i.exec(u)?.[1]?.toLowerCase() ?? "";
  const withIds = entries.map((e) => ({ e, id: idOf(e.full_post_url ?? "") })).filter((x) => x.id);
  if (!withIds.length) return entries;

  const dead = new Set<string>();
  const BATCH = 50;
  for (let i = 0; i < withIds.length; i += BATCH) {
    const ids = withIds.slice(i, i + BATCH).map((x) => x.id);
    try {
      const res = await fetch(`${ARCTIC_SHIFT_IDS}?ids=${ids.join(",")}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue; // fail open
      const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
      for (const p of json.data ?? []) {
        const id = String(p.id ?? "").toLowerCase();
        const body = String(p.selftext ?? "");
        const gone =
          body === "[removed]" ||
          body === "[deleted]" ||
          !!p.removed_by_category ||
          !!p.removed_by ||
          !!p.banned_by ||
          String(p.author ?? "") === "[deleted]";
        if (id && gone) dead.add(id);
      }
    } catch {
      /* fail open */
    }
  }
  if (!dead.size) return entries;
  return entries.filter((e) => !dead.has(idOf(e.full_post_url ?? "")));
}

async function fetchViaArcticShift(
  sub: string,
  state: { blocked: number; misses: number },
): Promise<RedditEntry[] | null> {
  if (process.env.REDDIT_ARCTIC_SHIFT === "false") return null;
  try {
    const res = await fetch(
      `${ARCTIC_SHIFT_BASE}?subreddit=${encodeURIComponent(sub)}&limit=100&sort=desc`,
      {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (res.status === 429) {
      state.blocked++;
      return null;
    }
    if (!res.ok) {
      state.misses++;
      return null; // null (not []) so the caller falls through to RSS
    }
    const d = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = d.data;
    if (!Array.isArray(rows)) {
      state.misses++;
      return null;
    }
    return rows
      .filter((p) => {
        // DEAD POSTS. Measured 2026-07-30 on r/HireaWriter: 16 of the 25 newest
        // submissions were already removed by moderators. Emitting those is
        // worse than emitting nothing — the user clicks through to
        // "[Removed by moderator]" and the whole product looks broken.
        //
        // The archive keeps the row after Reddit removes the post, which is
        // exactly why the archive is fresh AND why this filter is mandatory.
        const body = String(p.selftext ?? "");
        if (body === "[removed]" || body === "[deleted]") return false;
        if (p.removed_by_category || p.removed_by || p.banned_by) return false;
        if (String(p.author ?? "") === "[deleted]") return false;
        return true;
      })
      .map((p) => {
        const permalink = String(p.permalink ?? "");
        const author = String(p.author ?? "");
        const body = String(p.selftext ?? "");
        return {
          title: String(p.title ?? ""),
          url: permalink ? `https://www.reddit.com${permalink}` : String(p.url ?? ""),
          author: author === "[deleted]" ? "" : author,
          authorUrl:
            author && author !== "[deleted]" ? `https://www.reddit.com/user/${author}` : "",
          updated: new Date(Number(p.created_utc ?? 0) * 1000).toISOString(),
          // Removed/deleted bodies come back as literal "[removed]" — that's not
          // content, and letting it through would have the demand classifier
          // judge posts on their title alone while thinking it had a body.
          content: body === "[removed]" || body === "[deleted]" ? "" : body,
          subreddit: sub,
          imageUrl: looksLikeImageUrl(String(p.url ?? "")) ? String(p.url) : undefined,
        };
      })
      .filter((e) => e.title && e.url);
  } catch {
    state.misses++;
    return null;
  }
}

// ── OAuth (optional, and a large upgrade when present) ──────────────────────
//
// Without credentials this module reads public RSS and Reddit 429s after ~8
// requests, so a run covers one subreddit. With a free script app it reads
// oauth.reddit.com at 100 queries/minute — the difference between best-effort
// and consistent.
//
// We use the CLIENT_CREDENTIALS grant, not the password grant: it returns an
// app-only token that can read public listings, which is all this source needs.
// The password grant would require storing the user's actual Reddit password in
// .env, and there is no reason to hold a credential we don't need.
//
// Setup: https://www.reddit.com/prefs/apps → "create another app..." → script.
// Verified live 2026-07-30 (prefs/apps 302s to login; the token endpoint below
// answers 401 to bad creds, i.e. it is alive). NOT developers.reddit.com —
// that is Devvit, a different product for apps that run inside Reddit.
let tokenCache: { token: string; expiresAt: number } | null = null;

export function redditOauthConfigured(): boolean {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

async function getRedditToken(): Promise<string | null> {
  if (!redditOauthConfigured()) return null;
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  try {
    const basic = Buffer.from(
      `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Reddit requires a descriptive UA and rate-limits generic ones harder.
        "User-Agent": process.env.REDDIT_USER_AGENT || "Scrapivo/1.0 (lead discovery)",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) return null;
    tokenCache = {
      token: d.access_token,
      // Refresh a minute early rather than racing the expiry.
      expiresAt: Date.now() + Math.max(60, (d.expires_in ?? 3600) - 60) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  }
}

/** Fetch a subreddit's newest posts as JSON via OAuth. Null = not available. */
async function fetchViaOauth(
  sub: string,
  state: { blocked: number; misses: number },
): Promise<RedditEntry[] | null> {
  const token = await getRedditToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/new?limit=100&raw_json=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": process.env.REDDIT_USER_AGENT || "Scrapivo/1.0 (lead discovery)",
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (res.status === 401) {
      tokenCache = null; // token rejected — force a refresh next call
      return null;
    }
    if (res.status === 429) {
      state.blocked++;
      return null;
    }
    if (!res.ok) {
      state.misses++;
      return [];
    }
    type ListingChild = { data?: Record<string, unknown> };
    const d = (await res.json()) as { data?: { children?: ListingChild[] } };
    return (
      (d.data?.children ?? [])
        .map((c) => c.data)
        // Type predicate, not a bare Boolean filter — TS can't narrow the latter.
        .filter((p): p is Record<string, unknown> => !!p)
        .map((p) => ({
          title: String(p.title ?? ""),
          url: `https://www.reddit.com${String(p.permalink ?? "")}`,
          author: String(p.author ?? ""),
          authorUrl: p.author ? `https://www.reddit.com/user/${String(p.author)}` : "",
          updated: new Date(Number(p.created_utc ?? 0) * 1000).toISOString(),
          content: String(p.selftext ?? ""),
          subreddit: sub,
        }))
        .filter((e: RedditEntry) => e.title && e.url)
    );
  } catch {
    state.misses++;
    return [];
  }
}

async function fetchFeed(url: string, state: { blocked: number; misses: number }): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.xml;
  if (state.blocked >= STOP_AFTER_429) return "";

  // Plain fetch on purpose: resilientFetch treats 403/429 as retryable and
  // THROWS once retries are exhausted, so a rate-limit is indistinguishable
  // from a network error there. We need the status code itself to decide
  // between "back off entirely" (429) and "this sub doesn't exist" (404).
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      state.blocked++;
      return "";
    }
    if (!res.ok) {
      // 403 on a single sub = private/quarantined, not a global block.
      state.misses++;
      return "";
    }
    const xml = await res.text();
    if (!xml.includes("<entry>")) {
      state.misses++;
      return "";
    }
    cache.set(url, { at: Date.now(), xml });
    return xml;
  } catch {
    state.misses++;
    return "";
  }
}

// ── the source ──────────────────────────────────────────────────────────────

export type RedditRssStats = {
  subsPolled: number;
  entriesSeen: number;
  blocked: number;
  /** Subs that 404'd / were private / returned no entries. */
  missed: number;
  keptDemand: number;
  droppedSupply: number;
  droppedStale: number;
  droppedIrrelevant: number;
  /** Image-only posts rescued by the vision transcription pass. */
  visionExtracted: number;
};

/**
 * Poll the demand subreddits' /new feeds and keep posts that are (a) fresh,
 * (b) demand-shaped, and (c) about the craft being searched.
 *
 * `maxAgeHours` defaults to 48 — these feeds only carry ~25 newest posts per
 * sub, so anything older has already fallen off the feed anyway.
 */
export async function searchRedditRss(
  qx: ExpandedQueries,
  opts: { maxAgeHours?: number; maxSubs?: number } = {},
): Promise<{ leads: SourceLead[]; stats: RedditRssStats }> {
  const maxAgeDays = (opts.maxAgeHours ?? 48) / 24;
  const subs = selectSubs(qx, opts.maxSubs ?? MAX_SUBS);
  const state = { blocked: 0, misses: 0 };
  let visionCalls = 0;
  const stats: RedditRssStats = {
    subsPolled: 0,
    entriesSeen: 0,
    blocked: 0,
    missed: 0,
    keptDemand: 0,
    droppedSupply: 0,
    droppedStale: 0,
    droppedIrrelevant: 0,
    visionExtracted: 0,
  };

  // Craft terms: the searched skill plus its related forms and the role noun.
  const craftTerms = [qx.skill, qx.role, ...(qx.relatedSkills ?? [])]
    .flatMap((t) => (t || "").split(/\s*\/\s*/))
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  let leads: SourceLead[] = [];
  const seen = new Set<string>();

  const oauth = redditOauthConfigured();

  // ── Phase 1: pull the feeds ────────────────────────────────────────────
  //
  // This used to be one loop that fetched a sub, processed it, slept, and moved
  // on. 30 subs one-at-a-time is 30 round trips end to end, and it ran past the
  // 28s source budget — measured 2026-08-02, the run finished with 15 leads
  // AFTER the orchestrator had already given up on it, so all 15 were thrown
  // away and Discover showed none of them.
  //
  // Fetching is IO and the subs are independent, so they overlap. The bare-RSS
  // fallback is the exception: it 429s after ~8 requests, and one 429 aborts
  // the whole run. So probe with a single sub first and only widen the fan-out
  // once we know we're on a transport that can take it.
  const fetchSub = async (
    sub: string,
  ): Promise<{ entries: RedditEntry[]; fastTransport: boolean }> => {
    // Transport preference, best first:
    //   1. Arctic Shift — real-time, 120k req/hr, and NO Reddit contract accepted
    //   2. OAuth — 100 QPM, but registering the app accepts the Developer Terms
    //   3. public RSS — no terms either, but 429s after ~8 requests
    let entries: RedditEntry[] | null = await fetchViaArcticShift(sub, state);
    const fastTransport = entries !== null;
    if (entries === null && oauth) entries = await fetchViaOauth(sub, state);
    if (entries === null) {
      const xml = await fetchFeed(
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss?limit=50`,
        state,
      );
      entries = xml ? parseRedditAtom(xml, sub) : [];
    }
    return { entries: entries ?? [], fastTransport };
  };

  const polled: RedditEntry[][] = [];
  const probe = subs.length ? await fetchSub(subs[0]) : { entries: [], fastTransport: false };
  if (probe.entries.length) polled.push(probe.entries);

  const fast = probe.fastTransport || oauth;
  const remaining = subs.slice(1);
  const workers = Math.min(fast ? FEED_CONCURRENCY : 1, Math.max(1, remaining.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < remaining.length) {
        if (state.blocked >= STOP_AFTER_429) return;
        const sub = remaining[cursor++];
        const { entries } = await fetchSub(sub);
        if (entries.length) polled.push(entries);
        // Jitter so repeated searches don't hit Reddit in a fixed rhythm. On a
        // fast transport this is politeness, not a rate limit; on bare RSS it
        // is the thing keeping us under the 429 threshold.
        if (state.blocked >= STOP_AFTER_429) return;
        await sleep(
          fast
            ? 120 + Math.floor(Math.random() * 80)
            : INTER_FETCH_MS + Math.floor(Math.random() * 600),
        );
      }
    }),
  );

  // ── Phase 1b: transcribe image-only posts, all at once ─────────────────
  //
  // Image posts carry their ask inside the picture ("LOOKING FOR A DESIGNER —
  // DM me, budget $500"), so this has to happen before classifyDemand or they
  // reach the gate with an empty body. It used to run inline in the loop
  // below, one await at a time: 6 calls x up to 25s each is why the source
  // took 62s on a real query and had every lead discarded. The cap is the same,
  // the calls just overlap now, so the cost is one call instead of six.
  const needsVision: RedditEntry[] = [];
  for (const entries of polled) {
    for (const entry of entries) {
      if (needsVision.length >= MAX_VISION_CALLS_PER_SEARCH) break;
      if (!entry.imageUrl) continue;
      if (`${entry.title} ${entry.content}`.trim().length >= 80) continue;
      if (!isRecent(entry.updated, maxAgeDays)) continue;
      needsVision.push(entry);
    }
  }
  if (needsVision.length) {
    // Vision is a top-up, never a dependency: a post whose ask is only in an
    // image is a bonus, and the text posts around it are the bulk of the yield.
    // extractImageText allows itself 25s per call against free, rate-limited
    // providers, which alone can spend the source's whole 28s budget and get
    // every lead — image-only or not — thrown away. Take what has arrived by
    // the deadline and move on.
    const texts = await Promise.race([
      Promise.all(needsVision.map((e) => extractImageText(e.imageUrl!))),
      sleep(VISION_DEADLINE_MS).then(() => null),
    ]);
    if (texts) {
      texts.forEach((seenText, i) => {
        if (!seenText) return;
        const entry = needsVision[i];
        entry.content = `${entry.content ? `${entry.content} ` : ""}${seenText}`;
        stats.visionExtracted++;
        visionCalls++;
      });
    }
  }

  // ── Phase 2: turn entries into leads ───────────────────────────────────
  for (const entries of polled) {
    stats.subsPolled++;

    for (const entry of entries) {
      stats.entriesSeen++;
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);

      if (!isRecent(entry.updated, maxAgeDays)) {
        stats.droppedStale++;
        continue;
      }

      const verdict = classifyDemand({ title: entry.title, body: entry.content, url: entry.url });
      if (!verdict.isDemand) {
        stats.droppedSupply++;
        continue;
      }

      // Match the TITLE, not the body.
      //
      // A hiring post's title names the role being hired; the body mentions
      // everything the role touches. Matching the body made a "marketing"
      // search return "[Hiring] Graphic Designer" — because that post's body
      // said "for our marketing team". Same failure shape as the Greenhouse
      // bug, where matching job descriptions returned "Account Executive" for
      // a designer search.
      //
      // Body is still searched as a fallback, but only when the body states the
      // craft as a NEED rather than mentioning it in passing.
      let matched = matchesCraft(entry.title, craftTerms);
      if (!matched && entry.content) {
        const demandContext =
          /\b(?:need|needs|looking for|hiring|want|require|seeking)\b[^.]{0,60}$/i;
        for (const term of craftTerms) {
          const hit = matchesCraft(entry.content, [term]);
          if (!hit) continue;
          const idx = entry.content.toLowerCase().indexOf(term.toLowerCase());
          if (idx > 0 && demandContext.test(entry.content.slice(Math.max(0, idx - 60), idx))) {
            matched = term;
            break;
          }
        }
      }
      if (!matched) {
        stats.droppedIrrelevant++;
        continue;
      }

      stats.keptDemand++;
      const ageH = (Date.now() - new Date(entry.updated).getTime()) / 3_600_000;
      leads.push({
        source: "reddit",
        platform: "Reddit",
        platform_label: `Reddit r/${entry.subreddit}`,
        title: entry.title.slice(0, 200),
        snippet: (entry.content || entry.title).slice(0, 600),
        // The REAL post URL — not a company homepage. This is the thing the
        // user opens to reply to the opportunity.
        full_post_url: entry.url,
        author: entry.author ? `u/${entry.author}` : undefined,
        author_url: entry.authorUrl || undefined,
        posted_at: entry.updated,
        posted_at_relative:
          ageH < 1
            ? "just now"
            : ageH < 24
              ? `${Math.round(ageH)}h ago`
              : `${Math.round(ageH / 24)}d ago`,
        source_confidence: 82,
        signal_type: "direct_intent",
        intentBoost: verdict.boost,
        match_reasons: [
          verdict.reason,
          `Mentions "${matched}"`,
          `Posted ${Math.round(ageH)}h ago in r/${entry.subreddit}`,
        ],
        why_match: `${verdict.reason} — r/${entry.subreddit}`,
      });
    }
  }

  // Final liveness pass: a post moderators removed after the archive ingested
  // it still looked alive up to here. Only runs on what survived filtering, so
  // it costs one or two batched lookups.
  const beforeLiveness = leads.length;
  leads = await dropRemovedPosts(leads);
  if (process.env.NODE_ENV === "development" && leads.length !== beforeLiveness) {
    console.info(`[reddit-rss] liveness dropped ${beforeLiveness - leads.length} removed post(s)`);
  }

  stats.blocked = state.blocked;
  stats.missed = state.misses;
  if (process.env.NODE_ENV === "development") {
    console.info(
      `[reddit-rss] ${leads.length} leads | subs=${stats.subsPolled}/${subs.length} miss=${stats.missed} entries=${stats.entriesSeen} ` +
        `kept=${stats.keptDemand} supply=${stats.droppedSupply} stale=${stats.droppedStale} offcraft=${stats.droppedIrrelevant}` +
        (stats.blocked ? ` | RATE-LIMITED after ${stats.subsPolled} subs` : ""),
    );
  }
  return { leads, stats };
}
