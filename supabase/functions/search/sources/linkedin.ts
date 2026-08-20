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
import { idFromUrl, jinaRead, safe, BROWSER_UA } from "../utils.ts";

export async function searchLinkedIn(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();
  const serpKey = Deno.env.get("SERPAPI_KEY");

  try {
    const jobsUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query.role)}&location=Worldwide&start=0&count=25`;
    const res = await fetch(jobsUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json, text/html",
      },
    });
    if (res.ok) {
      const html = await res.text();
      const jobIds = [...html.matchAll(/data-entity-urn="urn:li:jobPosting:(\d+)"/g)].map(
        (m) => m[1],
      );
      const titles = [
        ...html.matchAll(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/g),
      ].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      const companies = [
        ...html.matchAll(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/g),
      ].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      const dates = [...html.matchAll(/datetime="([^"]+)"/g)].map((m) => m[1]);

      for (let i = 0; i < Math.min(jobIds.length, 20); i++) {
        const jobId = jobIds[i];
        if (!jobId || seen.has(jobId)) continue;

        const title = titles[i] || `${query.role} Position`;
        const company = companies[i] || "Company";
        const postedAt = dates[i] ? new Date(dates[i]).toISOString() : null;
        if (!postedAt || !isWithin14Days(postedAt)) continue;

        seen.add(jobId);
        const fullText = `${title} at ${company} - ${query.role} position`;
        const { score, tier, hasBudget, hasUrgency } = scoreIntent({
          text: fullText,
          platform: "linkedin",
          postedAt,
          isDecisionMaker: true,
          platformSourceConfidence: 85,
        });
        if (score === 0) continue;

        leads.push({
          id: `linkedin-job-${jobId}`,
          platform: "linkedin",
          platform_label: "LinkedIn Jobs",
          post_url: `https://www.linkedin.com/jobs/view/${jobId}`,
          post_title: `${title} at ${company}`,
          post_body_snippet: `Job posting: ${title} at ${company}. Active LinkedIn job listing for ${query.role}.`,
          ai_summary: `${company} is hiring a ${title}`,
          why_shown: `Active LinkedIn job posting for ${query.role} at ${company} · ${relativeTime(postedAt)}`,
          author_handle: company,
          author_url: "",
          author_name: company,
          posted_at: postedAt,
          posted_at_relative: relativeTime(postedAt),
          engagement: { applicants: 0 },
          intent_score: score,
          intent_tier: tier,
          is_decision_maker: true,
          has_budget: hasBudget,
          has_urgency: hasUrgency,
          source_confidence: 85,
        });
      }
    }
  } catch {
    /* silent */
  }

  if (serpKey) {
    const liQueries = [
      `site:linkedin.com/posts "looking for" "${query.skill}"`,
      `site:linkedin.com/posts "hiring" "${query.role}"`,
      `site:linkedin.com "we need a" "${query.skill}"`,
    ];

    for (const q of liQueries.slice(0, 2)) {
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
          if (!url || seen.has(url)) continue;
          if (!url.includes("linkedin.com")) continue;

          const text = (result.title || "") + " " + (result.snippet || "");
          if (!hasBuyerIntent(text, query.negativePhrases)) continue;
          seen.add(url);

          const now = new Date().toISOString();
          const isDecisionMaker = detectDecisionMaker(text);
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text,
            platform: "linkedin",
            postedAt: now,
            isDecisionMaker,
            platformSourceConfidence: 80,
          });
          if (score < 35) continue;

          leads.push({
            id: `li-${idFromUrl(url)}`,
            platform: "linkedin",
            platform_label: "LinkedIn Post",
            post_url: url,
            post_title: result.title || "",
            post_body_snippet: (result.snippet || "").slice(0, 600),
            ai_summary: generateSummary(result.title || "", result.snippet || "", query.skill),
            why_shown: generateWhyShown(
              "LinkedIn",
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
            source_confidence: 80,
          });
        }
      } catch {
        /* silent */
      }
    }
  }

  if (leads.length < 3) {
    try {
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query.role)}`;
      const jinaText = await safe(jinaRead(searchUrl), "");
      if (jinaText && jinaText.length > 100) {
        const now = new Date().toISOString();
        const { score, tier, hasBudget, hasUrgency } = scoreIntent({
          text: jinaText,
          platform: "linkedin",
          postedAt: now,
          isDecisionMaker: true,
          platformSourceConfidence: 70,
        });
        if (score >= 35) {
          leads.push({
            id: `li-jina-${idFromUrl(searchUrl)}`,
            platform: "linkedin",
            platform_label: "LinkedIn Jobs",
            post_url: searchUrl,
            post_title: `LinkedIn jobs for ${query.role}`,
            post_body_snippet: jinaText.slice(0, 600),
            ai_summary: `LinkedIn job listings for ${query.role}`,
            why_shown: generateWhyShown("LinkedIn", query.skill, hasBudget, true, tier, now),
            author_handle: "",
            author_url: "",
            author_name: "",
            posted_at: now,
            posted_at_relative: "Recently",
            engagement: {},
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: true,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 70,
          });
        }
      }
    } catch {
      /* silent */
    }
  }

  return leads;
}
