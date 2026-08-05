import type { Lead, SearchQuery } from "../types.ts";
import { hasBuyerIntent } from "../intent-filter.ts";
import { buildLead } from "../utils.ts";

export async function searchTavily(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
  const key = Deno.env.get("TAVILY_API_KEY");
  if (!key) return out;

  const q =
    `people looking to hire ${query.role} OR "${query.skill} needed" OR "need a ${query.skill}" freelance ${new Date().getFullYear()}`;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: q,
        search_depth: "advanced",
        max_results: 12,
        include_domains: [
          "reddit.com",
          "news.ycombinator.com",
          "linkedin.com",
          "upwork.com",
          "freelancer.com",
          "toptal.com",
          "twitter.com",
          "x.com",
          "bsky.app",
          "wellfound.com",
          "angel.co",
        ],
        exclude_domains: [
          "wikipedia.org",
          "medium.com",
          "dev.to",
          "stackoverflow.com",
          "github.com",
          "npmjs.com",
        ],
      }),
    });
    const data = res.ok ? await res.json() : null;
    for (const r of data?.results ?? []) {
      const text = `${r.title || ""} ${r.content || ""}`;
      if (!hasBuyerIntent(text, query.negativePhrases)) continue;
      let hostname = "";
      try {
        hostname = new URL(r.url).hostname;
      } catch {
        /* ignore */
      }

      const lead = buildLead({
        id: `tavily-${hostname}-${String(r.title || "").slice(0, 20)}`,
        platform: "tavily",
        platform_label: "Web: Hiring/Job Post",
        post_url: r.url || "",
        post_title: r.title || "",
        post_body_snippet: (r.content || "").slice(0, 400),
        query,
        posted_at: r.published_date || new Date().toISOString(),
        author_handle: hostname,
        author_name: hostname,
        engagement: { views: Math.round((r.score ?? 0.5) * 100) },
        source_confidence: 65,
      });
      if (lead) out.push(lead);
    }
  } catch {
    /* silent */
  }
  return out;
}
