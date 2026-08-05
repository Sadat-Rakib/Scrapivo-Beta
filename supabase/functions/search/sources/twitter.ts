import type { Lead, SearchQuery } from "../types.ts";
import {
  hasBuyerIntent,
  isWithin14Days,
  detectDecisionMaker,
  scoreIntent,
  generateSummary,
  generateWhyShown,
  relativeTime,
} from "../intent-filter.ts";
import { idFromUrl, jinaRead, safe, ok, BROWSER_UA } from "../utils.ts";

const TWITTER_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7ssbmtoTGPLhAAK%2FWFwqGFDFmkLzQ5ZXBOp0pMnbad6whJUE1NtGgA";

async function getGuestToken(): Promise<string | null> {
  try {
    const res = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.guest_token || null;
  } catch {
    return null;
  }
}

export async function searchTwitter(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();

  const twitterQueries = [
    `"looking for" "${query.skill}" lang:en`,
    `"need a" "${query.role}" lang:en`,
    `"hiring" "${query.skill}" lang:en -is:retweet`,
    `"${query.skill} needed" OR "${query.skill} wanted" lang:en`,
    `"we need" "${query.skill}" lang:en -is:retweet`,
  ];

  const guestToken = await getGuestToken();

  if (guestToken) {
    for (const q of twitterQueries.slice(0, 2)) {
      try {
        const params = new URLSearchParams({
          q,
          count: "20",
          tweet_mode: "extended",
          result_type: "recent",
        });
        const res = await fetch(
          `https://api.twitter.com/1.1/search/tweets.json?${params}`,
          {
            headers: {
              Authorization: `Bearer ${TWITTER_BEARER}`,
              "x-guest-token": guestToken,
            },
          },
        );
        if (!res.ok) continue;
        const data = await res.json();

        for (const tweet of data?.statuses || []) {
          const tweetId = tweet.id_str;
          if (!tweetId || seen.has(tweetId)) continue;

          const text = tweet.full_text || tweet.text || "";
          const postedAt = tweet.created_at
            ? new Date(tweet.created_at).toISOString()
            : null;
          if (!postedAt || !isWithin14Days(postedAt)) continue;
          if (!hasBuyerIntent(text, query.negativePhrases)) continue;

          seen.add(tweetId);
          const author = tweet.user;
          const isDecisionMaker = detectDecisionMaker(
            text + " " + (author?.description || ""),
          );
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text,
            platform: "twitter",
            postedAt,
            isDecisionMaker,
            platformSourceConfidence: 70,
          });
          if (score === 0) continue;

          leads.push({
            id: `twitter-${tweetId}`,
            platform: "twitter",
            platform_label: "Twitter/X",
            post_url: `https://twitter.com/${author?.screen_name}/status/${tweetId}`,
            post_title: text.slice(0, 100),
            post_body_snippet: text.slice(0, 600),
            ai_summary: generateSummary("", text, query.skill),
            why_shown: generateWhyShown(
              "Twitter/X",
              query.skill,
              hasBudget,
              isDecisionMaker,
              tier,
              postedAt,
            ),
            author_handle: `@${author?.screen_name || ""}`,
            author_url: `https://twitter.com/${author?.screen_name}`,
            author_name: author?.name || "",
            author_bio: author?.description || "",
            author_followers: author?.followers_count || 0,
            posted_at: postedAt,
            posted_at_relative: relativeTime(postedAt),
            engagement: {
              likes: tweet.favorite_count || 0,
              reposts: tweet.retweet_count || 0,
            },
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: isDecisionMaker,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 70,
          });
        }
      } catch {
        /* silent */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const serpKey = Deno.env.get("SERPAPI_KEY");
  if (serpKey && leads.length < 5) {
    for (const buyerPhrase of query.buyerPhrases.slice(0, 2)) {
      try {
        const googleQuery = `site:twitter.com OR site:x.com "${buyerPhrase}" -filter:retweets`;
        const params = new URLSearchParams({
          q: googleQuery,
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
          if (!url || seen.has(url)) continue;
          if (!url.includes("twitter.com") && !url.includes("x.com")) continue;

          const text = (result.title || "") + " " + (result.snippet || "");
          if (!hasBuyerIntent(text, query.negativePhrases)) continue;
          seen.add(url);

          const now = new Date().toISOString();
          const isDecisionMaker = detectDecisionMaker(text);
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text,
            platform: "twitter",
            postedAt: now,
            isDecisionMaker,
            platformSourceConfidence: 65,
          });
          if (score < 30) continue;

          leads.push({
            id: `twitter-serp-${idFromUrl(url)}`,
            platform: "twitter",
            platform_label: "Twitter/X",
            post_url: url,
            post_title: result.title || "",
            post_body_snippet: (result.snippet || "").slice(0, 600),
            ai_summary: generateSummary(
              result.title || "",
              result.snippet || "",
              query.skill,
            ),
            why_shown: generateWhyShown(
              "Twitter/X",
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
            source_confidence: 65,
          });
        }
      } catch {
        /* silent */
      }
    }
  }

  const nitterInstances = ["nitter.net", "nitter.privacydev.net", "nitter.poast.org"];
  if (leads.length < 3) {
    for (const instance of nitterInstances.slice(0, 1)) {
      try {
        const q = `${query.skill} looking for OR hiring OR "need a"`;
        const res = await fetch(
          `https://${instance}/search?f=tweets&q=${encodeURIComponent(q)}&since=&until=&near=`,
          { headers: { "User-Agent": BROWSER_UA } },
        );
        if (!res.ok) continue;
        const html = await res.text();
        const tweetMatches =
          html.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/g) || [];
        const dateMatches = html.match(/datetime="([^"]+)"/g) || [];
        const linkMatches = html.match(/href="\/[^/]+\/status\/(\d+)"/g) || [];
        const userMatches = html.match(/class="username"[^>]*>@?([^<]+)<\/a>/g) || [];

        for (let i = 0; i < Math.min(tweetMatches.length, 10); i++) {
          const text = (tweetMatches[i] || "").replace(/<[^>]+>/g, "").trim();
          const dateStr = (dateMatches[i] || "")
            .replace('datetime="', "")
            .replace('"', "");
          const postedAt = dateStr ? new Date(dateStr).toISOString() : null;
          const linkMatch = linkMatches[i]?.match(/\/status\/(\d+)/);
          const tweetId = linkMatch?.[1];
          const userMatch = userMatches[i]
            ?.replace(/<[^>]+>/g, "")
            .replace("@", "")
            .trim();

          if (!text || !postedAt || !tweetId || seen.has(tweetId)) continue;
          if (!isWithin14Days(postedAt)) continue;
          if (!hasBuyerIntent(text, query.negativePhrases)) continue;
          seen.add(tweetId);

          const isDecisionMaker = detectDecisionMaker(text);
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text,
            platform: "twitter",
            postedAt,
            isDecisionMaker,
            platformSourceConfidence: 65,
          });
          if (score === 0) continue;

          leads.push({
            id: `twitter-nitter-${tweetId}`,
            platform: "twitter",
            platform_label: "Twitter/X",
            post_url: `https://twitter.com/${userMatch}/status/${tweetId}`,
            post_title: text.slice(0, 100),
            post_body_snippet: text.slice(0, 600),
            ai_summary: generateSummary("", text, query.skill),
            why_shown: generateWhyShown(
              "Twitter/X",
              query.skill,
              hasBudget,
              isDecisionMaker,
              tier,
              postedAt,
            ),
            author_handle: `@${userMatch || ""}`,
            author_url: `https://twitter.com/${userMatch}`,
            author_name: userMatch || "",
            posted_at: postedAt,
            posted_at_relative: relativeTime(postedAt),
            engagement: {},
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: isDecisionMaker,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 65,
          });
        }
        break;
      } catch {
        /* silent */
      }
    }
  }

  if (leads.length < 2) {
    try {
      const searchUrl =
        `https://twitter.com/search?q=${encodeURIComponent(`hiring ${query.skill}`)}&f=live`;
      const jinaText = await safe(jinaRead(searchUrl), "");
      if (jinaText && hasBuyerIntent(jinaText, query.negativePhrases)) {
        const now = new Date().toISOString();
        const isDecisionMaker = detectDecisionMaker(jinaText);
        const { score, tier, hasBudget, hasUrgency } = scoreIntent({
          text: jinaText,
          platform: "twitter",
          postedAt: now,
          isDecisionMaker,
          platformSourceConfidence: 55,
        });
        if (score >= 30) {
          leads.push({
            id: `twitter-jina-${idFromUrl(searchUrl)}`,
            platform: "twitter",
            platform_label: "Twitter/X",
            post_url: searchUrl,
            post_title: jinaText.slice(0, 100),
            post_body_snippet: jinaText.slice(0, 600),
            ai_summary: generateSummary("", jinaText, query.skill),
            why_shown: generateWhyShown(
              "Twitter/X",
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
