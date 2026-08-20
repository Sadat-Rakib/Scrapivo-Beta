import type { Lead, SearchQuery } from "../types.ts";
import { hasBuyerIntent, isWithin14Days } from "../intent-filter.ts";
import { buildLead, safe, ok } from "../utils.ts";

export async function searchBluesky(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
  const terms = [
    `hiring ${query.skill}`,
    `looking for ${query.skill}`,
    `need a ${query.skill}`,
    `${query.role} wanted`,
  ];
  for (const t of terms.slice(0, 3)) {
    try {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(t)}&limit=20&sort=latest`;
      const data = await safe(
        fetch(url).then((r) => ok<Record<string, unknown>>(r)),
        null,
      );
      for (const p of (data?.posts as Array<Record<string, unknown>>) ?? []) {
        const record = p.record as Record<string, unknown> | undefined;
        const text = String(record?.text || "");
        const date = String(record?.createdAt || p.indexedAt || "");
        if (!isWithin14Days(date)) continue;
        if (!hasBuyerIntent(text, query.negativePhrases)) continue;
        const author = p.author as Record<string, unknown> | undefined;
        const handle = String(author?.handle || "");
        const rkey =
          String(p.uri || "")
            .split("/")
            .pop() || "";

        const lead = buildLead({
          id: `bluesky-${rkey}`,
          platform: "bluesky",
          platform_label: "Bluesky",
          post_url: `https://bsky.app/profile/${handle}/post/${rkey}`,
          post_title: text.slice(0, 120),
          post_body_snippet: text,
          query,
          posted_at: date,
          author_handle: `@${handle}`,
          author_url: `https://bsky.app/profile/${handle}`,
          author_name: String(author?.displayName || handle),
          engagement: {
            likes: (p.likeCount as number) ?? 0,
            reposts: (p.repostCount as number) ?? 0,
            comments: (p.replyCount as number) ?? 0,
          },
          source_confidence: 70,
        });
        if (lead) out.push(lead);
      }
    } catch {
      /* silent */
    }
  }
  return out;
}
