// =====================================================================
// Fediverse — real social platforms, public API, no login, no ToS click
//
// Why this exists: every social/gov/community source in the app routed through
// SearXNG dorks, so when the local SearXNG container is down (or its engines
// are suspended) the whole social class silently returns nothing and Discover
// collapses to Reddit + ATS. These two platforms need no key, no account and
// no scraping — they publish a documented read API to anonymous callers.
//
// Probed live 2026-08-02:
//   ✓ Lemmy    /api/v3/search?sort=New   — 80 posts/instance, 4 of 5 instances
//   ✓ Mastodon /api/v1/timelines/tag/:t  — 44 posts/instance, 5 of 5 instances
//   ✗ Bluesky  public.api.bsky.app       — 403, still auth-walled
//
// Both are opportunity-shaped rather than job-shaped: people posting in the
// first person about what they need, which is exactly the ratio Discover was
// missing.
// =====================================================================
import type { Lead } from "../scoring";
import { isRecent, type ExpandedQueries } from "./query-expander";
import { classifyDemand, craftVariants, matchesCraft, personNoun } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

const UA = "Scrapivo/1.0 (+opportunity discovery; contact via site)";
const TIMEOUT_MS = 9000;
const CACHE_MS = 3 * 60_000;

const cache = new Map<string, { at: number; body: unknown }>();

async function getJson<T>(url: string): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body as T;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as T;
    cache.set(url, { at: Date.now(), body });
    return body;
  } catch {
    return null;
  }
}

function relativeAge(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Accounts that syndicate listings wholesale. These are the "full list of jobs"
// the user explicitly rejected, and on Mastodon they dominate #hiring.
const BOT_ACCOUNT_RE =
  /\b(bot|jobs?|hiring|vacancy|vacancies|careers?|feed|rss|listings?|board)\b/i;

// -------------------------------------------------------------- Lemmy

const LEMMY_INSTANCES = [
  "lemmy.world",
  "lemmy.ml",
  "sh.itjust.works",
  "programming.dev",
  "beehaw.org",
];

interface LemmyPost {
  post: {
    name?: string;
    body?: string;
    published?: string;
    ap_id?: string;
    url?: string;
    removed?: boolean;
    deleted?: boolean;
    nsfw?: boolean;
  };
  creator?: { name?: string; bot_account?: boolean; actor_id?: string };
  community?: { name?: string; title?: string };
}

export async function searchLemmy(qx: ExpandedQueries): Promise<SourceLead[]> {
  const terms = craftVariants(qx.skill || qx.role || "");
  // "need a design" is not how anyone asks — see personNoun.
  const craft = personNoun(qx.skill, qx.role);
  const queries = [
    `need a ${craft}`,
    `looking for a ${craft}`,
    `${craft} recommendation`,
    craft,
  ].filter((q) => q && q.trim().length > 2);

  const jobs: Array<Promise<LemmyPost[]>> = [];
  for (const host of LEMMY_INSTANCES) {
    for (const q of queries.slice(0, 3)) {
      const url =
        `https://${host}/api/v3/search?q=${encodeURIComponent(q)}` +
        `&type_=Posts&sort=New&limit=30`;
      jobs.push(
        getJson<{ posts?: LemmyPost[] }>(url).then((d) => d?.posts ?? []),
      );
    }
  }

  const batches = await Promise.all(jobs);
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const posts of batches) {
    for (const p of posts) {
      const post = p.post ?? {};
      // Moderator-removed posts were a live complaint — never surface them.
      if (post.removed || post.deleted || post.nsfw) continue;
      if (p.creator?.bot_account) continue;

      const title = (post.name || "").trim();
      const body = stripHtml(post.body || "");
      const link = post.ap_id || post.url || "";
      if (!title || !link || seen.has(link)) continue;

      const iso = post.published ? new Date(post.published).toISOString() : "";
      if (iso && !isRecent(iso, 7)) continue;

      // TITLE ONLY. Matching the body is the trap that has bitten four times.
      if (terms.length && !matchesCraft(title, terms)) continue;

      const verdict = classifyDemand({ title, body });
      if (verdict.rejectedAs) continue;

      seen.add(link);
      out.push({
        source: "lemmy",
        platform: p.community?.title || p.community?.name || "Lemmy",
        platform_label: "Lemmy post",
        title: title.slice(0, 200),
        snippet: (body || title).slice(0, 400),
        full_post_url: link,
        author: p.creator?.name || undefined,
        posted_at: iso || undefined,
        posted_at_relative: iso ? relativeAge(iso) : undefined,
        source_confidence: 70,
        signal_type: "direct_intent",
        intentBoost: 16,
      } as SourceLead);
    }
  }
  return out;
}

// ----------------------------------------------------------- Mastodon

const MASTODON_INSTANCES = [
  "mastodon.social",
  "mstdn.social",
  "fosstodon.org",
  "mas.to",
  "techhub.social",
];

// Tags people actually post demand under. #hiring skews corporate; #forhire and
// #needhelp skew to individuals asking, which is the ratio we want.
const MASTODON_TAGS = ["forhire", "hiring", "freelance", "needhelp", "commissions"];

/**
 * The craft's own tags, added because the demand tags are craft-agnostic.
 *
 * Measured 2026-08-02 for skill "design": the five tags above returned 200 live
 * posts, 6 of which mentioned design at all and 0 of which survived the demand
 * gate. That is a SUPPLY problem, not a strict-filter one — #forhire is a small
 * and mostly seller-side firehose, and nothing in it narrows to the craft.
 * Pulling #design puts on-topic posts into the pool in the first place;
 * classifyDemand still decides which of them are actually asks.
 */
function craftTags(skill: string, role: string): string[] {
  const clean = (s: string) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const base = clean(skill || role);
  if (base.length < 3) return [];
  return [...new Set([base, clean(personNoun(skill, role)), `${base}commission`])].filter(
    (t) => t.length >= 3,
  );
}

interface MastoStatus {
  url?: string;
  uri?: string;
  content?: string;
  created_at?: string;
  reblog?: unknown;
  account?: { acct?: string; display_name?: string; bot?: boolean; note?: string };
}

export async function searchMastodon(qx: ExpandedQueries): Promise<SourceLead[]> {
  const terms = craftVariants(qx.skill || qx.role || "");

  const tags = [...new Set([...MASTODON_TAGS, ...craftTags(qx.skill, qx.role)])];
  const jobs: Array<Promise<MastoStatus[]>> = [];
  for (const host of MASTODON_INSTANCES) {
    for (const tag of tags) {
      const url = `https://${host}/api/v1/timelines/tag/${tag}?limit=40`;
      jobs.push(getJson<MastoStatus[]>(url).then((d) => d ?? []));
    }
  }

  const batches = await Promise.all(jobs);
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const statuses of batches) {
    for (const s of statuses) {
      if (s.reblog) continue; // boosts are not original posts
      const acct = s.account?.acct || "";
      const display = s.account?.display_name || "";
      if (s.account?.bot || BOT_ACCOUNT_RE.test(acct) || BOT_ACCOUNT_RE.test(display)) continue;

      const link = s.url || s.uri || "";
      const text = stripHtml(s.content || "");
      if (!link || !text || seen.has(link)) continue;

      const iso = s.created_at ? new Date(s.created_at).toISOString() : "";
      if (iso && !isRecent(iso, 7)) continue;

      // A toot has no title, so the whole (short) post is the title surface —
      // the title-only rule still holds because there is no long body to drift.
      if (terms.length && !matchesCraft(text, terms)) continue;

      const verdict = classifyDemand({ title: text, body: "" });
      if (verdict.rejectedAs) continue;

      seen.add(link);
      out.push({
        source: "mastodon",
        platform: "Mastodon",
        platform_label: "Mastodon post",
        title: text.slice(0, 160),
        snippet: text.slice(0, 400),
        full_post_url: link,
        author: display || acct || undefined,
        posted_at: iso || undefined,
        posted_at_relative: iso ? relativeAge(iso) : undefined,
        source_confidence: 68,
        signal_type: "direct_intent",
        intentBoost: 18,
      } as SourceLead);
    }
  }
  return out;
}
