import type { Lead, SearchQuery } from "../types.ts";
import {
  hasBuyerIntent,
  isWithin14Days,
  isRelevantToSkill,
  detectDecisionMaker,
} from "../intent-filter.ts";
import { buildLead, jinaRead, safe, ok, sleep, BROWSER_UA } from "../utils.ts";

const UA = { "user-agent": "Scrapivo:lead-discovery:v1.0 (contact: hello@scrapivo.com)" };

async function fetchRedditJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
  if (res.ok) return await res.json();
  if (res.status === 403) {
    const oldUrl = url.replace("www.reddit.com", "old.reddit.com");
    const res2 = await fetch(oldUrl, {
      headers: { "user-agent": BROWSER_UA, Accept: "application/json" },
    });
    if (res2.ok) return await res2.json();
  }
  return null;
}

export async function searchReddit(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
  const seen = new Set<string>();

  const pushPost = (
    p: Record<string, unknown>,
    platformLabel: string,
    trusted: boolean,
  ) => {
    const id = String(p.id || "");
    if (!id || seen.has(id)) return;
    const date = new Date(((p.created_utc as number) ?? 0) * 1000).toISOString();
    if (!isWithin14Days(date)) return;
    const title = String(p.title || "");
    const body = String(p.selftext || "").slice(0, 500);
    const text = `${title} ${body}`;
    if (!trusted && !hasBuyerIntent(text, query.negativePhrases)) return;
    if (!isRelevantToSkill(text, query.skill)) return;
    seen.add(id);

    const lead = buildLead({
      id: `reddit-${id}`,
      platform: "reddit",
      platform_label: platformLabel,
      post_url: `https://reddit.com${p.permalink || ""}`,
      post_title: trusted ? `[HIRING] ${title}` : title,
      post_body_snippet: body || title,
      query,
      posted_at: date,
      author_handle: String(p.author || ""),
      author_url: p.author ? `https://reddit.com/user/${p.author}` : "",
      author_name: String(p.author || ""),
      engagement: {
        upvotes: (p.score as number) ?? 0,
        comments: (p.num_comments as number) ?? 0,
      },
      source_confidence: trusted ? 95 : 75,
      is_decision_maker: detectDecisionMaker(text),
    });
    if (lead) out.push(lead);
  };

  try {
    const url =
      `https://www.reddit.com/r/forhire/search.json?q=${encodeURIComponent(`flair:Hiring ${query.skill}`)}&restrict_sr=1&sort=new&t=week&limit=25`;
    const data = (await safe(fetchRedditJson(url), null)) as {
      data?: { children?: Array<{ data?: Record<string, unknown> }> };
    } | null;
    for (const c of data?.data?.children ?? []) {
      const p = c.data;
      if (!p) continue;
      const title = String(p.title || "").toLowerCase();
      const isHiring =
        String(p.link_flair_text || "").toLowerCase().includes("hiring") ||
        title.includes("[hiring]");
      if (!isHiring) continue;
      pushPost(p, "Reddit r/forhire [Hiring]", true);
    }
  } catch {
    /* silent */
  }

  try {
    const url =
      `https://www.reddit.com/r/hiring/search.json?q=${encodeURIComponent(query.skill)}&restrict_sr=1&sort=new&t=week&limit=25`;
    const data = (await safe(fetchRedditJson(url), null)) as {
      data?: { children?: Array<{ data?: Record<string, unknown> }> };
    } | null;
    for (const c of data?.data?.children ?? []) {
      if (c.data) pushPost(c.data, "Reddit r/hiring", true);
    }
  } catch {
    /* silent */
  }

  for (const sub of ["Entrepreneur", "smallbusiness", "startups"]) {
    try {
      const q =
        `${query.skill} (hiring OR "looking for" OR "need a" OR "seeking")`;
      const url =
        `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=week&limit=15`;
      const data = (await safe(fetchRedditJson(url), null)) as {
        data?: { children?: Array<{ data?: Record<string, unknown> }> };
      } | null;
      for (const c of data?.data?.children ?? []) {
        if (c.data) pushPost(c.data, `Reddit r/${sub}`, false);
      }
    } catch {
      /* silent */
    }
    await sleep(300);
  }

  if (out.length < 2) {
    try {
      const searchUrl =
        `https://www.reddit.com/r/forhire/search/?q=${encodeURIComponent(`[Hiring] ${query.skill}`)}&restrict_sr=1&sort=new`;
      const jinaText = await safe(jinaRead(searchUrl), "");
      if (jinaText && hasBuyerIntent(jinaText, query.negativePhrases)) {
        const now = new Date().toISOString();
        const lead = buildLead({
          id: `reddit-jina-${Date.now()}`,
          platform: "reddit",
          platform_label: "Reddit r/forhire [Hiring]",
          post_url: searchUrl,
          post_title: jinaText.slice(0, 100),
          post_body_snippet: jinaText.slice(0, 600),
          query,
          posted_at: now,
          source_confidence: 60,
        });
        if (lead) out.push(lead);
      }
    } catch {
      /* silent */
    }
  }

  return out;
}
