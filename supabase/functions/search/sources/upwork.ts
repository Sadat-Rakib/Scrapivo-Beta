import type { Lead, SearchQuery } from "../types.ts";
import { isWithin14Days } from "../intent-filter.ts";
import { buildLead, safe } from "../utils.ts";

export async function searchUpwork(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
  const queries = [query.role, `${query.skill} developer`, `${query.skill} freelancer`];

  for (const q of queries) {
    try {
      const url =
        `https://www.upwork.com/ab/feed/jobs/rss?q=${encodeURIComponent(q)}&sort=recency&paging=0%3B10`;
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
        if (!link || !title) continue;
        const date = pub ? new Date(pub).toISOString() : new Date().toISOString();
        if (!isWithin14Days(date)) continue;

        const lead = buildLead({
          id: `upwork-${link.slice(-20)}`,
          platform: "upwork",
          platform_label: "Upwork Job Posting",
          post_url: link,
          post_title: `JOB: ${title}`,
          post_body_snippet: desc,
          query,
          posted_at: date,
          author_handle: "Upwork Client",
          author_name: "Upwork Client",
          engagement: { applicants: 0 },
          source_confidence: 95,
          is_decision_maker: true,
        });
        if (lead) out.push(lead);
      }
    } catch {
      /* silent */
    }
  }
  return out;
}
