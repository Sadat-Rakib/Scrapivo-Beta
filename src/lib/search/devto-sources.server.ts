import type { Lead } from "../scoring";
import { isBuyerContent, detectDecisionMaker, type ExpandedQueries } from "./query-expander";

type SourceLead = Lead & { intentBoost?: number };

/**
 * Dev.to has a public API that does not require an API key for basic article searching.
 * Useful for finding tech-related hiring/collaboration posts.
 */
export async function searchDevTo(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  const query = qx.skill || qx.role;
  if (!query) return out;

  // Search using relevant tags for hiring/collaboration
  const tags = ["hiring", "freelance", "collab", "helpwanted"];

  const fetchTag = async (tag: string) => {
    try {
      const url = `https://dev.to/api/articles?tag=${tag}&per_page=15`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Scrapivo/1.0",
        },
      });
      if (!res.ok) return [];

      const data = await res.json();
      const leads: SourceLead[] = [];

      for (const item of data as any[]) {
        const link = item.url;
        if (!link || seen.has(link)) continue;

        const title = item.title || "";
        const description = item.description || "";
        const text = `${title} ${description}`;

        // Must match the user's skill/query
        if (!text.toLowerCase().includes(query.toLowerCase())) continue;

        if (!isBuyerContent(text, qx.negativePhrases)) continue;
        if (/\b(hire me|my portfolio|available for hire|open to work)\b/i.test(text)) continue;

        seen.add(link);

        const author = item.user?.name || item.user?.username || "Dev.to User";
        const author_url = item.user?.username ? `https://dev.to/${item.user.username}` : undefined;

        leads.push({
          source: "devto",
          platform: "Dev.to",
          platform_label: "Dev.to Post",
          title: title.slice(0, 150),
          snippet: description.slice(0, 400),
          full_post_url: link,
          author,
          author_url,
          posted_at: item.published_at
            ? new Date(item.published_at).toISOString()
            : new Date().toISOString(),
          engagement: (item.public_reactions_count || 0) + (item.comments_count || 0),
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 12,
          match_reasons: ["Dev.to tech hiring post"],
          demand_verified: true,
        });
      }
      return leads;
    } catch (e) {
      return [];
    }
  };

  const results = await Promise.all(tags.map(fetchTag));
  for (const tagLeads of results) {
    out.push(...tagLeads);
  }

  // Deduplicate and return top 15
  return out.slice(0, 15);
}
