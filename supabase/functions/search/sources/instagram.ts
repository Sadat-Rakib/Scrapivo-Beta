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
import { idFromUrl } from "../utils.ts";

export async function searchInstagram(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();
  const serpKey = Deno.env.get("SERPAPI_KEY");
  const scKey = Deno.env.get("SCRAPECREATORS_KEY");

  if (scKey) {
    const igQueries = [
      `hiring ${query.skill}`,
      `looking for ${query.skill}`,
      `need ${query.skill}`,
    ];

    for (const q of igQueries.slice(0, 2)) {
      try {
        const res = await fetch(
          `https://api.scrapecreators.com/v1/instagram/search?query=${encodeURIComponent(q)}&type=posts`,
          { headers: { "x-api-key": scKey } },
        );
        if (!res.ok) continue;
        const data = await res.json();

        for (const post of data?.posts || data?.data || []) {
          const postId = post.id || post.pk;
          if (!postId || seen.has(String(postId))) continue;

          const caption = post.caption?.text || post.caption || "";
          const postedAt = post.taken_at
            ? new Date(post.taken_at * 1000).toISOString()
            : post.timestamp || null;

          if (!postedAt || !isWithin14Days(postedAt)) continue;
          if (!hasBuyerIntent(caption, query.negativePhrases)) continue;
          seen.add(String(postId));

          const username = post.user?.username || post.owner?.username || "";
          const isDecisionMaker = detectDecisionMaker(
            caption + " " + (post.user?.biography || ""),
          );
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text: caption,
            platform: "instagram",
            postedAt,
            isDecisionMaker,
            platformSourceConfidence: 60,
          });
          if (score === 0) continue;

          leads.push({
            id: `ig-${postId}`,
            platform: "instagram",
            platform_label: "Instagram",
            post_url: `https://www.instagram.com/p/${post.shortcode || post.code}/`,
            post_title: caption.slice(0, 100),
            post_body_snippet: caption.slice(0, 600),
            ai_summary: generateSummary("", caption, query.skill),
            why_shown: generateWhyShown(
              "Instagram",
              query.skill,
              hasBudget,
              isDecisionMaker,
              tier,
              postedAt,
            ),
            author_handle: `@${username}`,
            author_url: `https://www.instagram.com/${username}`,
            author_name: post.user?.full_name || username,
            author_followers: post.user?.follower_count || 0,
            posted_at: postedAt,
            posted_at_relative: relativeTime(postedAt),
            engagement: {
              likes: post.like_count || 0,
              comments: post.comment_count || 0,
            },
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: isDecisionMaker,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 60,
          });
        }
      } catch {
        /* silent */
      }
    }
  }

  if (serpKey && leads.length < 3) {
    try {
      const q =
        `site:instagram.com "looking for ${query.skill}" OR "hiring ${query.skill}" OR "need a ${query.skill}"`;
      const params = new URLSearchParams({
        q,
        api_key: serpKey,
        num: "10",
        engine: "google",
        tbs: "qdr:w",
      });
      const res = await fetch(`https://serpapi.com/search.json?${params}`);
      if (res.ok) {
        const data = await res.json();
        for (const result of data?.organic_results || []) {
          const url = result.link || "";
          if (!url || seen.has(url) || !url.includes("instagram.com")) continue;
          const text = (result.title || "") + " " + (result.snippet || "");
          if (!hasBuyerIntent(text, query.negativePhrases)) continue;
          seen.add(url);
          const now = new Date().toISOString();
          const isDecisionMaker = detectDecisionMaker(text);
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text,
            platform: "instagram",
            postedAt: now,
            isDecisionMaker,
            platformSourceConfidence: 55,
          });
          if (score < 30) continue;
          leads.push({
            id: `ig-serp-${idFromUrl(url)}`,
            platform: "instagram",
            platform_label: "Instagram",
            post_url: url,
            post_title: result.title || "",
            post_body_snippet: (result.snippet || "").slice(0, 600),
            ai_summary: generateSummary(
              result.title || "",
              result.snippet || "",
              query.skill,
            ),
            why_shown: generateWhyShown(
              "Instagram",
              query.skill,
              hasBudget,
              isDecisionMaker,
              tier,
              now,
            ),
            author_handle: "",
            author_url: "",
            author_name: "",
            posted_at: now,
            posted_at_relative: "Recently",
            engagement: {},
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
