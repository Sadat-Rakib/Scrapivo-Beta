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
    const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");
    const results = await searchSearxng(queries, 2, "day", "fiverr");
    const leads = searxngResultsToLeads(results, 8) as SourceLead[];
    return leads
      .filter((l) => /fiverr\.com/i.test(l.full_post_url))
      .filter((l) => !/fiverr\.com\/categories\//i.test(l.full_post_url))
      .filter((l) => {
        // Seller gig URLs look like /username/gig-slug — drop unless buyer phrasing.
        const url = l.full_post_url || "";
        const isGig = /fiverr\.com\/[^/]+\/[^/?#]+/i.test(url) && !/\/request/i.test(url);
        const text = `${l.title} ${l.snippet}`;
        if (isGig && !BUYER_RE.test(text)) return false;
        return BUYER_RE.test(text);
      })
      .map((l) => ({
        ...l,
        source: "fiverr",
        platform: "Fiverr (buyer request)",
        intentBoost: (l.intentBoost ?? 0) + 8,
        match_reasons: [...(l.match_reasons ?? []), "Fiverr public buyer-request dork"],
      }));
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
    const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");
    const results = await searchSearxng(queries, 2, "day", "discord");
    const leads = searxngResultsToLeads(results, 10) as SourceLead[];
    return leads
      .filter((l) => /disboard\.org|top\.gg|discord\.gg|discord\.com\/invite/i.test(l.full_post_url))
      .filter((l) => BUYER_RE.test(`${l.title} ${l.snippet}`))
      .map((l) => ({
        ...l,
        source: "discord_public",
        platform: "Discord (public listing)",
        intentBoost: (l.intentBoost ?? 0) + 6,
        match_reasons: [...(l.match_reasons ?? []), "Public Discord server listing"],
      }));
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
      const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");
      const results = await searchSearxng(queries, 3, "day", "instagram");
      for (const l of searxngResultsToLeads(results, 8) as SourceLead[]) {
        const url = l.full_post_url || "";
        if (!/instagram\.com\/(p|reel)\//i.test(url)) continue;
        if (seen.has(url)) continue;
        const text = `${l.title} ${l.snippet}`;
        if (!BUYER_RE.test(text)) continue;
        // SearXNG rarely has IG dates — refuse undated so 2023 reels cannot leak.
        if (!l.posted_at || !isRecent(l.posted_at, CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;
        seen.add(url);
        const handle =
          l.author ||
          text.match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ||
          text.match(/\b([a-z0-9_.]{3,30}\.design)\b/i)?.[1];
        out.push({
          ...l,
          source: "instagram",
          platform: "Instagram Post",
          author: handle || l.author,
          author_url: handle
            ? `https://www.instagram.com/${String(handle).replace(/^@/, "")}/`
            : l.author_url,
          intentBoost: (l.intentBoost ?? 0) + 8,
          match_reasons: [...(l.match_reasons ?? []), "Instagram public buyer dork"],
        });
      }
    } catch { /* continue */ }
  }

  return out.slice(0, 20);
}

/**
 * Public Facebook group / post discovery via SearXNG site: dorks only.
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
    const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");
    const results = await searchSearxng(queries, 3, "day", "facebook");
    const leads = searxngResultsToLeads(results, 9) as SourceLead[];
    return leads
      .filter((l) => /facebook\.com\//i.test(l.full_post_url || ""))
      .filter((l) => !/facebook\.com\/(login|sharer|share|marketplace)\b/i.test(l.full_post_url || ""))
      .filter((l) => BUYER_RE.test(`${l.title} ${l.snippet}`))
      // Undated Facebook SERP hits are usually stale — refuse without a fresh date.
      .filter((l) => !!l.posted_at && isRecent(l.posted_at, CLIENTS_SOCIAL_MAX_AGE_DAYS))
      .map((l) => ({
        ...l,
        source: "facebook",
        platform: "Facebook (public)",
        intentBoost: (l.intentBoost ?? 0) + 7,
        match_reasons: [...(l.match_reasons ?? []), "Public Facebook buyer dork"],
      }))
      .slice(0, 12);
  } catch {
    return [];
  }
}

function isBuyerish(text: string): boolean {
  return /\b(looking for|need a|hiring|who can|budget|freelancer)\b/i.test(text || "");
}
