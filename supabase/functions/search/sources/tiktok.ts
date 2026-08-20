import type { Lead, SearchQuery } from "../types.ts";
import {
  isWithin14Days,
  relativeTime,
  hasBuyerIntent,
  detectDecisionMaker,
  scoreIntent,
  generateSummary,
  generateWhyShown,
} from "../intent-filter.ts";

export async function searchTikTok(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();
  const scKey = Deno.env.get("SCRAPECREATORS_KEY");

  if (scKey) {
    const ttQuery = `hiring ${query.skill} OR "looking for ${query.skill}" OR "need a ${query.skill}"`;
    try {
      const res = await fetch(
        `https://api.scrapecreators.com/v1/tiktok/search?query=${encodeURIComponent(ttQuery)}&type=videos`,
        { headers: { "x-api-key": scKey } },
      );
      if (res.ok) {
        const data = await res.json();
        for (const video of data?.videos || data?.data || []) {
          const videoId = video.id || video.aweme_id;
          if (!videoId || seen.has(String(videoId))) continue;

          const text = video.desc || video.description || "";
          const postedAt = video.create_time
            ? new Date(video.create_time * 1000).toISOString()
            : null;
          if (!postedAt || !isWithin14Days(postedAt)) continue;
          if (!hasBuyerIntent(text, query.negativePhrases)) continue;
          seen.add(String(videoId));

          const username = video.author?.unique_id || video.author_info?.unique_id || "";
          const isDecisionMaker = detectDecisionMaker(text + " " + (video.author?.signature || ""));
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text,
            platform: "tiktok",
            postedAt,
            isDecisionMaker,
            platformSourceConfidence: 55,
          });
          if (score === 0) continue;

          leads.push({
            id: `tt-${videoId}`,
            platform: "tiktok",
            platform_label: "TikTok",
            post_url: `https://www.tiktok.com/@${username}/video/${videoId}`,
            post_title: text.slice(0, 100),
            post_body_snippet: text.slice(0, 600),
            ai_summary: generateSummary("", text, query.skill),
            why_shown: generateWhyShown(
              "TikTok",
              query.skill,
              hasBudget,
              isDecisionMaker,
              tier,
              postedAt,
            ),
            author_handle: `@${username}`,
            author_url: `https://www.tiktok.com/@${username}`,
            author_name: video.author?.nickname || username,
            author_followers: video.author?.follower_count || 0,
            posted_at: postedAt,
            posted_at_relative: relativeTime(postedAt),
            engagement: {
              likes: video.statistics?.digg_count || 0,
              comments: video.statistics?.comment_count || 0,
              views: video.statistics?.play_count || 0,
            },
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: isDecisionMaker,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 55,
          });
        }
      }
    } catch {
      /* silent */
    }
  }

  return leads;
}
