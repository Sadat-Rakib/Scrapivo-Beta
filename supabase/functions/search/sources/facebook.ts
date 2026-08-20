import type { Lead, SearchQuery } from "../types.ts";
import {
  hasBuyerIntent,
  detectDecisionMaker,
  scoreIntent,
  generateSummary,
  generateWhyShown,
} from "../intent-filter.ts";
import { idFromUrl } from "../utils.ts";

export async function searchFacebook(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();
  const serpKey = Deno.env.get("SERPAPI_KEY");
  if (!serpKey) return leads;

  const fbQueries = [
    `site:facebook.com "looking for ${query.skill}"`,
    `site:facebook.com/groups "hiring ${query.skill}" OR "need a ${query.skill}"`,
    `site:facebook.com "need ${query.role}" OR "seeking ${query.role}"`,
  ];

  for (const q of fbQueries.slice(0, 2)) {
    try {
      const params = new URLSearchParams({
        q,
        api_key: serpKey,
        num: "10",
        engine: "google",
        tbs: "qdr:w",
      });
      const res = await fetch(`https://serpapi.com/search.json?${params}`);
      if (!res.ok) continue;
      const data = await res.json();

      for (const result of data?.organic_results || []) {
        const url = result.link || "";
        if (!url || seen.has(url) || !url.includes("facebook.com")) continue;
        const text = (result.title || "") + " " + (result.snippet || "");
        if (!hasBuyerIntent(text, query.negativePhrases)) continue;
        seen.add(url);

        const now = new Date().toISOString();
        const isDecisionMaker = detectDecisionMaker(text);
        const { score, tier, hasBudget, hasUrgency } = scoreIntent({
          text,
          platform: "facebook",
          postedAt: now,
          isDecisionMaker,
          platformSourceConfidence: 55,
        });
        if (score < 30) continue;

        leads.push({
          id: `fb-${idFromUrl(url)}`,
          platform: "facebook",
          platform_label: "Facebook",
          post_url: url,
          post_title: result.title || "",
          post_body_snippet: (result.snippet || "").slice(0, 600),
          ai_summary: generateSummary(result.title || "", result.snippet || "", query.skill),
          why_shown: generateWhyShown(
            "Facebook",
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
    } catch {
      /* silent */
    }
  }
  return leads;
}
