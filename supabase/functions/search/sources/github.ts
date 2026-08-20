import type { Lead, SearchQuery } from "../types.ts";
import { hasBuyerIntent, isWithin14Days } from "../intent-filter.ts";
import { buildLead, safe, ok } from "../utils.ts";

export async function searchGitHub(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "Scrapivo/1.0",
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) headers.authorization = `Bearer ${token}`;

  const fromDate = new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0];
  const queries = [
    `"${query.skill}" label:bounty created:>${fromDate}`,
    `"${query.skill}" "paid" label:"help wanted" created:>${fromDate}`,
    `hiring "${query.skill}" created:>${fromDate}`,
  ];

  for (const q of queries) {
    try {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=10`;
      const data = await safe(
        fetch(url, { headers }).then((r) => ok<Record<string, unknown>>(r)),
        null,
      );
      for (const i of (data?.items as Array<Record<string, unknown>>) ?? []) {
        if (!isWithin14Days(String(i.created_at || ""))) continue;
        const text = `${i.title || ""} ${String(i.body || "").slice(0, 400)}`;
        if (!hasBuyerIntent(text, query.negativePhrases)) continue;
        const user = i.user as Record<string, unknown> | undefined;
        const reactions = i.reactions as Record<string, unknown> | undefined;

        const lead = buildLead({
          id: `github-${i.id}`,
          platform: "github",
          platform_label: "GitHub: Bounty/Hiring",
          post_url: String(i.html_url || ""),
          post_title: `BOUNTY/HIRING: ${i.title}`,
          post_body_snippet: String(i.body || "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 400),
          query,
          posted_at: String(i.created_at || ""),
          author_handle: String(user?.login || ""),
          author_url: String(user?.html_url || ""),
          author_name: String(user?.login || ""),
          engagement: {
            likes: (reactions?.total_count as number) ?? 0,
            comments: (i.comments as number) ?? 0,
          },
          source_confidence: 75,
        });
        if (lead) out.push(lead);
      }
    } catch {
      /* silent */
    }
  }
  return out;
}
