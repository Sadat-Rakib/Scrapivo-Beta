import type { Lead, SearchQuery } from "../types.ts";
import {
  hasBuyerIntent,
  isWithin14Days,
  isRelevantToSkill,
  detectDecisionMaker,
} from "../intent-filter.ts";
import { buildLead, safe, ok } from "../utils.ts";

export async function searchHackerNews(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
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
      fetch(threadSearch).then((r) => ok<Record<string, unknown>>(r)),
      null,
    );
    const hits = (threads?.hits as Array<Record<string, unknown>>) ?? [];
    const thread =
      hits.find(
        (h) =>
          String(h.title || "")
            .toLowerCase()
            .includes("who is hiring") && String(h.title || "").includes(String(currentYear)),
      ) || hits[0];

    if (thread?.objectID) {
      const commentsUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query.skill)}&tags=comment,story_${thread.objectID}&hitsPerPage=30`;
      const data = await safe(
        fetch(commentsUrl).then((r) => ok<Record<string, unknown>>(r)),
        null,
      );
      for (const c of (data?.hits as Array<Record<string, unknown>>) ?? []) {
        const text = String(c.comment_text || "")
          .replace(/<[^>]+>/g, " ")
          .trim();
        if (text.length < 50) continue;
        const date = c.created_at
          ? String(c.created_at)
          : c.created_at_i
            ? new Date((c.created_at_i as number) * 1000).toISOString()
            : null;
        if (!date || !isWithin14Days(date)) continue;
        const lower = text.toLowerCase();
        if (
          lower.includes("seeking work") ||
          lower.includes("seeking position") ||
          lower.startsWith("seeking")
        )
          continue;
        if (!isRelevantToSkill(text, query.skill)) continue;

        const lead = buildLead({
          id: `hn-${c.objectID}`,
          platform: "hn",
          platform_label: `HN: Ask HN Who Is Hiring (${currentMonth} ${currentYear})`,
          post_url: `https://news.ycombinator.com/item?id=${c.objectID}`,
          post_title: text.slice(0, 120),
          post_body_snippet: text.slice(0, 500),
          query,
          posted_at: date,
          author_handle: String(c.author || ""),
          author_url: `https://news.ycombinator.com/user?id=${c.author}`,
          author_name: String(c.author || ""),
          engagement: { points: (c.points as number) ?? 0 },
          source_confidence: 95,
          is_decision_maker: true,
        });
        if (lead) out.push(lead);
      }
    }
  } catch {
    /* silent */
  }

  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`freelancer ${query.skill}`)}&tags=comment&hitsPerPage=20`;
    const data = await safe(
      fetch(url).then((r) => ok<Record<string, unknown>>(r)),
      null,
    );
    for (const h of (data?.hits as Array<Record<string, unknown>>) ?? []) {
      const text = String(h.comment_text || "").replace(/<[^>]+>/g, " ");
      const date = h.created_at
        ? String(h.created_at)
        : h.created_at_i
          ? new Date((h.created_at_i as number) * 1000).toISOString()
          : null;
      if (!date || !isWithin14Days(date)) continue;
      if (!hasBuyerIntent(text, query.negativePhrases)) continue;

      const lead = buildLead({
        id: `hn-freelance-${h.objectID}`,
        platform: "hn",
        platform_label: "HN: Seeking Freelancer",
        post_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        post_title: text.slice(0, 120),
        post_body_snippet: text.slice(0, 500),
        query,
        posted_at: date,
        author_handle: String(h.author || ""),
        author_url: `https://news.ycombinator.com/user?id=${h.author}`,
        author_name: String(h.author || ""),
        engagement: { points: (h.points as number) ?? 0 },
        source_confidence: 85,
        is_decision_maker: detectDecisionMaker(text),
      });
      if (lead) out.push(lead);
    }
  } catch {
    /* silent */
  }

  return out;
}
