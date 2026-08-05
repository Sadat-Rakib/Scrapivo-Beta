import type { Lead, SearchQuery } from "../types.ts";
import {
  isWithin14Days,
  relativeTime,
  detectDecisionMaker,
  scoreIntent,
} from "../intent-filter.ts";
import { idFromUrl } from "../utils.ts";

function parseRelativeDate(str: string): string {
  const now = Date.now();
  const match = str.match(/(\d+)\s+(hour|day|week|month)s?\s+ago/i);
  if (!match) return new Date().toISOString();
  const [, num, unit] = match;
  const n = parseInt(num);
  const ms: Record<string, number> = {
    hour: 3600000,
    day: 86400000,
    week: 604800000,
    month: 2592000000,
  };
  return new Date(now - n * (ms[unit.toLowerCase()] || 86400000)).toISOString();
}

export async function searchGoogleJobs(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const serpKey = Deno.env.get("SERPAPI_KEY");
  if (!serpKey) return leads;
  const seen = new Set<string>();

  try {
    const params = new URLSearchParams({
      engine: "google_jobs",
      q: `${query.role} remote`,
      api_key: serpKey,
      chips: "date_posted:week",
      ltype: "1",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) return leads;
    const data = await res.json();

    for (const job of data?.jobs_results || []) {
      const jobId =
        job.job_id || idFromUrl(String(job.title) + String(job.company_name));
      if (seen.has(jobId)) continue;
      seen.add(jobId);

      const postedAt = job.detected_extensions?.posted_at
        ? parseRelativeDate(job.detected_extensions.posted_at)
        : new Date().toISOString();

      if (!isWithin14Days(postedAt)) continue;

      const fullText =
        `${job.title} at ${job.company_name}. ${job.description || ""}`.slice(0, 600);
      const isDecisionMaker = detectDecisionMaker(fullText);
      const { score, tier, hasBudget, hasUrgency } = scoreIntent({
        text: fullText,
        platform: "google_jobs",
        postedAt,
        isDecisionMaker,
        platformSourceConfidence: 90,
      });
      if (score === 0) continue;

      const sourceLabel = job.via ? `Google Jobs via ${job.via}` : "Google Jobs";

      leads.push({
        id: `gjob-${jobId}`,
        platform: "google_jobs",
        platform_label: sourceLabel,
        post_url: job.share_link || job.apply_options?.[0]?.link || "",
        post_title: `${job.title} at ${job.company_name}`,
        post_body_snippet: (job.description || "").slice(0, 600),
        ai_summary: `${job.company_name} is hiring a ${job.title}`,
        why_shown:
          `Active job listing on ${sourceLabel} · ${job.location || "Remote"} · ${relativeTime(postedAt)}`,
        author_handle: job.company_name,
        author_url: "",
        author_name: job.company_name,
        posted_at: postedAt,
        posted_at_relative: relativeTime(postedAt),
        engagement: {},
        intent_score: score,
        intent_tier: tier,
        is_decision_maker: true,
        has_budget: hasBudget,
        has_urgency: hasUrgency,
        source_confidence: 90,
      });
    }
  } catch {
    /* silent */
  }

  return leads;
}

export async function searchWellfound(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const serpKey = Deno.env.get("SERPAPI_KEY");
  if (!serpKey) return leads;
  const seen = new Set<string>();

  try {
    const params = new URLSearchParams({
      q: `site:wellfound.com "${query.skill}" OR "${query.role}"`,
      api_key: serpKey,
      num: "10",
      engine: "google",
      tbs: "qdr:m",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) return leads;
    const data = await res.json();

    for (const result of data?.organic_results || []) {
      const url = result.link || "";
      if (!url || seen.has(url) || !url.includes("wellfound.com")) continue;
      seen.add(url);

      const now = new Date().toISOString();
      const text = (result.title || "") + " " + (result.snippet || "");
      const isDecisionMaker = detectDecisionMaker(text);
      const { score, tier, hasBudget, hasUrgency } = scoreIntent({
        text,
        platform: "wellfound",
        postedAt: now,
        isDecisionMaker,
        platformSourceConfidence: 90,
      });
      if (score < 30) continue;

      leads.push({
        id: `wf-${idFromUrl(url)}`,
        platform: "wellfound",
        platform_label: "Wellfound (AngelList)",
        post_url: url,
        post_title: result.title || "",
        post_body_snippet: (result.snippet || "").slice(0, 600),
        ai_summary: `Startup job listing for ${query.role} on Wellfound`,
        why_shown: `Active Wellfound startup job listing for ${query.role}`,
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
        source_confidence: 90,
      });
    }
  } catch {
    /* silent */
  }
  return leads;
}
