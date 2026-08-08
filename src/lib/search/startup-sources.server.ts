// YC Work at a Startup + startups.gallery + GitHub hiring — early-stage signals.
// All HTML pages go through the fetch gate so soft-404 / login walls never become leads.
import type { ExpandedQueries } from "./query-expander";
import { isRecent, JOB_BOARD_MAX_AGE_DAYS, CLIENTS_SOCIAL_MAX_AGE_DAYS } from "./query-expander";
import type { Lead } from "../scoring";
import { validateFetchedPage, condensePageText } from "./fetch-gate.server";

export type SourceLead = Lead & { intentBoost?: number };

const JUNIOR_RE =
  /\b(junior|jr\.?|intern|internship|entry|new grad|associate|0[-–]1|early career)\b/i;
const SENIOR_RE =
  /\b(senior|sr\.?|staff|principal|lead|director|head of|10\+?\s*years|5\+?\s*years)\b/i;

function terms(qx: ExpandedQueries): string[] {
  return [qx.role, qx.skill, ...(qx.jobBoardTerms || [])].filter(Boolean).map((t) => t.toLowerCase());
}

function matches(text: string, t: string[]): boolean {
  if (!t.length) return true;
  const l = text.toLowerCase();
  return t.some((x) => l.includes(x));
}

async function fetchHtmlGated(
  url: string,
  relevanceTokens: string[],
): Promise<{ html: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; Scrapivo/1.0; +https://scrapivo.app)",
      },
    });
    const html = await res.text().catch(() => "");
    const title = (html.match(/<title[^>]*>([^<]+)/i)?.[1] || "").trim();
    const text = condensePageText(html, 12_000);
    const gate = validateFetchedPage({
      url,
      status: res.status,
      title,
      text,
      relevanceTokens: relevanceTokens.length ? relevanceTokens : undefined,
      minTextLength: 80,
    });
    if (!gate.ok) return null;
    return { html, text };
  } catch {
    return null;
  }
}

/**
 * Work at a Startup (YC) — scrape public jobs listing HTML lightly.
 * Prefer remote + non-senior roles. Falls back empty on block/fail.
 */
export async function searchWorkAtAStartup(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const t = terms(qx);
  const roleHint = (qx.role || qx.skill || "engineer").toLowerCase().replace(/\s+/g, "+");
  const urls = [
    `https://www.workatastartup.com/jobs?query=${encodeURIComponent(qx.skill || qx.role || "")}&remote=only`,
    `https://www.workatastartup.com/jobs?role=${encodeURIComponent(roleHint)}&remote=only`,
  ];

  for (const url of urls) {
    const page = await fetchHtmlGated(url, ["work at a startup", "yc", ...t.slice(0, 3)]);
    if (!page) continue;
    const linkRe = /href="(\/jobs\/\d+)"[^>]*>([^<]{3,120})</gi;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = linkRe.exec(page.html)) && out.length < 15) {
      const path = m[1];
      const title = m[2].replace(/\s+/g, " ").trim();
      if (!title || seen.has(path)) continue;
      if (SENIOR_RE.test(title) && !JUNIOR_RE.test(title)) continue;
      if (!matches(title, t) && !JUNIOR_RE.test(title)) continue;
      seen.add(path);
      out.push({
        source: "workatastartup",
        platform: "Work at a Startup",
        title: `YC startup: ${title}`,
        snippet: `Remote YC hiring: ${title}. Source: workatastartup.com`,
        full_post_url: `https://www.workatastartup.com${path}`,
        posted_at: undefined,
        engagement: 40,
        is_decision_maker: true,
        intentBoost: 16,
        match_reasons: ["YC Work at a Startup listing", "Remote filter"],
      });
    }
    if (out.length) break;
  }
  return out;
}

/** startups.gallery — directory of startups; require skill/niche token when possible. */
export async function searchStartupsGallery(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const t = terms(qx);
  const page = await fetchHtmlGated("https://www.startups.gallery/", ["startup", "gallery", ...t.slice(0, 2)]);
  if (!page) return [];

  const re = /href="(https?:\/\/(?!www\.startups\.gallery)[^"]+)"[^>]*>([^<]{2,80})</gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
    while ((m = re.exec(page.html)) && out.length < 36) {
    const url = m[1].split("?")[0];
    const name = m[2].replace(/\s+/g, " ").trim();
    if (!name || name.length < 2 || seen.has(url)) continue;
    if (/twitter|linkedin|instagram|facebook|github\.com|mailto:/i.test(url)) continue;
    // Prefer skill/niche match; allow a few generic early-stage listings.
    const hay = `${name} ${url} ${page.text.slice(0, 2000)}`;
    if (t.length && !matches(hay, t) && out.length >= 6) continue;
    seen.add(url);
    out.push({
      source: "startupsgallery",
      platform: "startups.gallery",
      title: `${name} (startup directory)`,
      snippet: `Company: ${name}\nEarly-stage startup listed on startups.gallery. Website: ${url}`,
      full_post_url: url,
      author: name,
      // Directory crawl time is not a real listing date — leave undated.
      posted_at: undefined,
      engagement: 15,
      is_decision_maker: true,
      intentBoost: t.length && matches(hay, t) ? 8 : 4,
      signal_type: "leading_indicator",
      match_reasons: [
        "Startup directory listing",
        ...(t.length && matches(hay, t) ? ["Matches skill/niche tokens"] : []),
      ],
    });
  }
  return out;
}

/** GitHub: recent issues labeled hiring / who-is-hiring style search via API. */
export async function searchGitHubHiringLists(qx: ExpandedQueries): Promise<SourceLead[]> {
  const token = process.env.GITHUB_TOKEN;
  const skill = qx.skill || qx.role || "hiring";
  const q = [
    `"${skill}"`,
    "label:hiring OR \"who is hiring\" OR \"we are hiring\" OR \"looking for\"",
    "is:issue",
    "is:open",
    `created:>${new Date(Date.now() - JOB_BOARD_MAX_AGE_DAYS * 86400_000).toISOString().slice(0, 10)}`,
  ].join(" ");
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=15`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Scrapivo",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<Record<string, any>> };
    const out: SourceLead[] = [];
    const t = terms(qx);
    for (const it of data?.items ?? []) {
      const created = it.created_at as string | undefined;
      if (created && !isRecent(created, JOB_BOARD_MAX_AGE_DAYS)) continue;
      const title = (it.title as string) || "";
      const body = ((it.body as string) || "").slice(0, 400);
      if (SENIOR_RE.test(title) && !JUNIOR_RE.test(title)) continue;
      // Relevance filter: skill/role tokens should appear in title or body
      if (t.length && !matches(`${title} ${body}`, t)) continue;
      out.push({
        source: "github",
        platform: "GitHub Hiring",
        title,
        snippet: body,
        full_post_url: it.html_url as string,
        author: it.user?.login,
        author_url: it.user?.html_url,
        posted_at: created,
        engagement: (it.comments as number) ?? 10,
        is_decision_maker: true,
        intentBoost: 14,
        match_reasons: ["GitHub hiring issue", "Relevance-filtered"],
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Public Fiverr — buyer-request pages only (never seller gigs / categories).
 * Uses SearXNG locally; on Vercel falls through to hosted Google SERP.
 */
export async function searchFiverrPublic(qx: ExpandedQueries): Promise<SourceLead[]> {
  const skill = qx.skill || qx.role || "";
  if (!skill) return [];
  const queries = [
    `site:fiverr.com "${skill}" ("looking for" OR "need a" OR "hiring" OR "buyer request" OR "request")`,
    `site:fiverr.com "${skill}" ("willing to pay" OR budget OR "need someone")`,
  ];
  const BUYER_RE =
    /\b(looking for|need a|need an|hiring|buyer request|willing to pay|budget|need someone|who can)\b/i;
  try {
    const { searchSiteDorks } = await import("./serp-providers.server");
    const results = await searchSiteDorks(queries, {
      maxPerQuery: 8,
      searxngSource: "fiverr",
      tbs: "qdr:w",
    });
    return results
      .filter((r) => /fiverr\.com/i.test(r.url))
      .filter((r) => !/fiverr\.com\/categories\//i.test(r.url))
      .filter((r) => {
        const isGig = /fiverr\.com\/[^/]+\/[^/?#]+/i.test(r.url) && !/\/request/i.test(r.url);
        const text = `${r.title} ${r.content}`;
        if (isGig && !BUYER_RE.test(text)) return false;
        return BUYER_RE.test(text);
      })
      .slice(0, 8)
      .map((r) => ({
        source: "fiverr",
        platform: "Fiverr (buyer request)",
        title: r.title || "Fiverr buyer request",
        snippet: (r.content || "").slice(0, 400),
        full_post_url: r.url,
        posted_at: r.publishedDate || undefined,
        engagement: 20,
        is_decision_maker: true,
        intentBoost: 8,
        match_reasons: ["Fiverr public buyer-request dork"],
      })) as SourceLead[];
  } catch {
    return [];
  }
}

/**
 * Public Discord server listings only (Disboard / top.gg / invite landing pages).
 * Never scrapes private Discord channels.
 */
export async function searchDiscordPublic(qx: ExpandedQueries): Promise<SourceLead[]> {
  const skill = qx.skill || qx.role || "";
  if (!skill) return [];
  const queries = [
    `site:disboard.org "${skill}" (hiring OR jobs OR freelance OR developers OR "looking for")`,
    `site:disboard.org/server "${skill}"`,
    `site:top.gg/servers "${skill}" (jobs OR hiring OR freelance)`,
    `site:discord.gg "${skill}" (hiring OR "looking for" OR freelance OR developers)`,
    `"${skill}" ("discord server" OR disboard) (hiring OR "looking for developers")`,
  ];
  const BUYER_RE =
    /\b(hiring|looking for|need|freelance|developers?|jobs?|recruit|talent)\b/i;
  try {
    const { searchSiteDorks } = await import("./serp-providers.server");
    const results = await searchSiteDorks(queries, {
      maxPerQuery: 8,
      searxngSource: "discord",
      tbs: "qdr:w",
    });
    return results
      .filter((r) => /disboard\.org|top\.gg|discord\.gg|discord\.com\/invite/i.test(r.url))
      .filter((r) => BUYER_RE.test(`${r.title} ${r.content}`))
      .slice(0, 10)
      .map((r) => ({
        source: "discord_public",
        platform: "Discord (public listing)",
        title: r.title || "Discord hiring listing",
        snippet: (r.content || "").slice(0, 400),
        full_post_url: r.url,
        posted_at: r.publishedDate || undefined,
        engagement: 15,
        is_decision_maker: true,
        intentBoost: 6,
        match_reasons: ["Public Discord server listing"],
      })) as SourceLead[];
  } catch {
    return [];
  }
}

/**
 * Public Instagram posts with buyer intent (ScrapeCreators + SearXNG/Tavily dorks).
 * Profile-only URLs are rejected. Undated / stale posts never enter the pool —
 * that was letting 2023 reels surface as "Recently (undated)".
 */
export async function searchInstagramPublic(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const skill = qx.skill || qx.role || "";
  if (!skill) return out;
  const seen = new Set<string>();
  const BUYER_RE =
    /\b(looking for|need a|need an|hiring|who can|willing to pay|budget|freelancer needed|help wanted|we're hiring|we are hiring)\b/i;

  const scKey = process.env.SCRAPECREATORS_KEY;
  if (scKey) {
    for (const q of [
      `hiring ${skill}`,
      `looking for ${skill}`,
      `need a ${skill}`,
      `"we're hiring" ${skill}`,
    ].slice(0, 3)) {
      try {
        const res = await fetch(
          `https://api.scrapecreators.com/v1/instagram/search?query=${encodeURIComponent(q)}&type=posts`,
          { headers: { "x-api-key": scKey } },
        );
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        for (const post of data?.posts || data?.data || []) {
          const postId = String(post.id || post.pk || "");
          if (!postId || seen.has(postId)) continue;
          const caption = post.caption?.text || post.caption || "";
          if (!BUYER_RE.test(caption) && !isBuyerish(caption)) continue;
          const postedAt = post.taken_at
            ? new Date(post.taken_at * 1000).toISOString()
            : post.timestamp
              ? new Date(post.timestamp).toISOString()
              : null;
          // Clients want hours/day freshness — never accept undated or week-old IG.
          if (!postedAt || !isRecent(postedAt, CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;
          const username = post.user?.username || post.owner?.username || "";
          const code = post.code || post.shortcode;
          const link =
            post.permalink ||
            (code ? `https://www.instagram.com/p/${code}/` : post.url || "");
          if (!link || !/instagram\.com\/(p|reel)\//i.test(link)) continue;
          seen.add(postId);
          out.push({
            source: "instagram",
            platform: "Instagram Post",
            title: caption.slice(0, 110) || `Instagram @${username}`,
            snippet: caption.slice(0, 400),
            full_post_url: link,
            author: username || undefined,
            author_url: username ? `https://www.instagram.com/${username}/` : undefined,
            posted_at: postedAt,
            engagement: (post.like_count ?? 0) + (post.comment_count ?? 0),
            is_decision_maker: /\b(founder|ceo|owner|hiring)\b/i.test(caption),
            intentBoost: 12,
          });
        }
      } catch { /* continue */ }
    }
  }

  if (out.length < 8) {
    const queries = [
      `site:instagram.com/p/ "${skill}" ("looking for" OR "need a" OR hiring OR "who can" OR "we're hiring")`,
      `site:instagram.com/reel/ "${skill}" (hiring OR "looking for" OR "need a" OR "we're hiring")`,
      `site:instagram.com ("hiring" OR "looking for a designer" OR "need a designer") "${skill}"`,
    ];
    try {
      const { searchSiteDorks } = await import("./serp-providers.server");
      const results = await searchSiteDorks(queries, {
        maxPerQuery: 8,
        searxngSource: "instagram",
        tbs: "qdr:w",
      });
      for (const r of results) {
        const url = r.url || "";
        if (!/instagram\.com\/(p|reel)\//i.test(url)) continue;
        if (seen.has(url)) continue;
        const text = `${r.title} ${r.content}`;
        if (!BUYER_RE.test(text)) continue;
        // Prefer dated; on SERP-only path accept undated with lower boost.
        const postedAt = r.publishedDate || undefined;
        if (postedAt && !isRecent(postedAt, CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;
        seen.add(url);
        const handle =
          text.match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ||
          text.match(/\b([a-z0-9_.]{3,30}\.design)\b/i)?.[1];
        out.push({
          source: "instagram",
          platform: "Instagram Post",
          title: r.title || `Instagram @${handle || "post"}`,
          snippet: (r.content || "").slice(0, 400),
          full_post_url: url,
          author: handle,
          author_url: handle
            ? `https://www.instagram.com/${String(handle).replace(/^@/, "")}/`
            : undefined,
          posted_at: postedAt,
          engagement: 10,
          is_decision_maker: /\b(founder|ceo|owner|hiring)\b/i.test(text),
          intentBoost: postedAt ? 8 : 4,
          match_reasons: ["Instagram public buyer dork"],
        });
      }
    } catch { /* continue */ }
  }

  return out.slice(0, 20);
}

/**
 * Public Facebook group / post discovery via SearXNG or hosted SERP site: dorks.
 * Never scrapes private Facebook sessions.
 */
export async function searchFacebookPublic(qx: ExpandedQueries): Promise<SourceLead[]> {
  const skill = qx.skill || qx.role || "";
  if (!skill) return [];
  const queries = [
    `site:facebook.com/groups "${skill}" ("looking for" OR "need a" OR hiring OR "who can")`,
    `site:facebook.com/posts "${skill}" (hiring OR "looking for" OR "need a designer" OR "need a developer")`,
    `site:facebook.com "${skill}" ("looking for a" OR "need a freelancer") (designer OR developer OR website)`,
  ];
  const BUYER_RE =
    /\b(looking for|need a|need an|hiring|who can|willing to pay|budget|freelancer needed|help wanted)\b/i;
  try {
    const { searchSiteDorks } = await import("./serp-providers.server");
    const results = await searchSiteDorks(queries, {
      maxPerQuery: 8,
      searxngSource: "facebook",
      tbs: "qdr:w",
    });
    return results
      .filter((r) => /facebook\.com\//i.test(r.url || ""))
      .filter((r) => !/facebook\.com\/(login|sharer|share|marketplace)\b/i.test(r.url || ""))
      .filter((r) => BUYER_RE.test(`${r.title} ${r.content}`))
      .map((r) => {
        const postedAt = r.publishedDate || undefined;
        return {
          source: "facebook",
          platform: "Facebook (public)",
          title: r.title || "Facebook hiring post",
          snippet: (r.content || "").slice(0, 400),
          full_post_url: r.url,
          posted_at: postedAt,
          engagement: 12,
          is_decision_maker: true,
          intentBoost: postedAt ? 7 : 3,
          match_reasons: ["Public Facebook buyer dork"],
        } as SourceLead;
      })
      .filter((l) => !l.posted_at || isRecent(l.posted_at, CLIENTS_SOCIAL_MAX_AGE_DAYS))
      .slice(0, 12);
  } catch {
    return [];
  }
}

function isBuyerish(text: string): boolean {
  return /\b(looking for|need a|hiring|who can|budget|freelancer)\b/i.test(text || "");
}
