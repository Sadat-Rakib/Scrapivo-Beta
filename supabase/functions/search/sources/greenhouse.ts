import type { Lead, SearchQuery } from "../types.ts";
import { isWithin14Days, relativeTime, scoreIntent } from "../intent-filter.ts";

const GREENHOUSE_BOARDS = [
  "airbnb",
  "stripe",
  "figma",
  "notion",
  "linear",
  "vercel",
  "supabase",
  "openai",
  "anthropic",
  "replicate",
  "huggingface",
  "databricks",
  "github",
  "shopify",
  "square",
  "twilio",
  "datadog",
  "segment",
  "amplitude",
  "mixpanel",
  "intercom",
  "zendesk",
  "freshworks",
  "atlassian",
  "typeform",
  "webflow",
  "framer",
  "retool",
  "airtable",
  "clickup",
  "asana",
  "monday",
  "coda",
  "miro",
  "pitch",
  "loom",
  "calendly",
  "descript",
  "riverside",
  "beehiiv",
  "ghost",
];

const LEVER_COMPANIES = [
  "netflix",
  "uber",
  "lyft",
  "airbnb",
  "pinterest",
  "reddit",
  "discord",
  "slack",
  "zoom",
  "dropbox",
  "box",
  "hubspot",
  "salesforce",
  "workday",
  "servicenow",
  "okta",
  "crowdstrike",
  "elastic",
  "hashicorp",
  "confluent",
  "dbt-labs",
  "fivetran",
];

export async function searchGreenhouse(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();
  const shuffled = [...GREENHOUSE_BOARDS].sort(() => Math.random() - 0.5).slice(0, 15);

  await Promise.allSettled(
    shuffled.map(async (board) => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
          { headers: { "User-Agent": "Scrapivo Job Aggregator" } },
        );
        if (!res.ok) return;
        const data = await res.json();

        for (const job of data?.jobs || []) {
          const title = (job.title || "").toLowerCase();
          const content = (job.content || "").toLowerCase();
          const skillLower = query.skill.toLowerCase();
          if (!title.includes(skillLower) && !content.includes(skillLower)) continue;

          const jobId = String(job.id);
          if (seen.has(jobId)) return;
          seen.add(jobId);

          const postedAt =
            job.updated_at || job.first_published
              ? new Date(job.updated_at || job.first_published).toISOString()
              : null;
          if (!postedAt || !isWithin14Days(postedAt)) return;

          const fullText =
            job.title +
            " at " +
            board +
            ". " +
            (job.content || "").replace(/<[^>]+>/g, "").slice(0, 300);
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text: fullText,
            platform: "greenhouse",
            postedAt,
            isDecisionMaker: true,
            platformSourceConfidence: 95,
          });
          if (score === 0) return;

          leads.push({
            id: `gh-board-${jobId}`,
            platform: "greenhouse",
            platform_label: `Greenhouse: ${board}`,
            post_url: job.absolute_url || `https://boards.greenhouse.io/${board}/jobs/${jobId}`,
            post_title: job.title,
            post_body_snippet: (job.content || "").replace(/<[^>]+>/g, "").slice(0, 600),
            ai_summary: `${board} (via Greenhouse) is hiring a ${job.title}`,
            why_shown: `Active Greenhouse job board listing · ${board} · ${relativeTime(postedAt)}`,
            author_handle: board,
            author_url: `https://boards.greenhouse.io/${board}`,
            author_name: board,
            posted_at: postedAt,
            posted_at_relative: relativeTime(postedAt),
            engagement: {},
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: true,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 95,
          });
        }
      } catch {
        /* silent */
      }
    }),
  );

  return leads;
}

export async function searchLever(query: SearchQuery): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seen = new Set<string>();
  const shuffled = [...LEVER_COMPANIES].sort(() => Math.random() - 0.5).slice(0, 10);

  await Promise.allSettled(
    shuffled.map(async (company) => {
      try {
        const res = await fetch(
          `https://api.lever.co/v0/postings/${company}?mode=json&skip=0&limit=50`,
          { headers: { "User-Agent": "Scrapivo Job Aggregator" } },
        );
        if (!res.ok) return;
        const jobs = await res.json();

        for (const job of Array.isArray(jobs) ? jobs : []) {
          const title = (job.text || "").toLowerCase();
          const desc = String(
            job.descriptionBody?.descriptionBody || job.description || "",
          ).toLowerCase();
          const skillLower = query.skill.toLowerCase();
          if (!title.includes(skillLower) && !desc.includes(skillLower)) continue;

          const jobId = job.id;
          if (!jobId || seen.has(jobId)) return;
          seen.add(jobId);

          const createdAt = job.createdAt ? new Date(job.createdAt).toISOString() : null;
          if (!createdAt || !isWithin14Days(createdAt)) return;

          const fullText =
            job.text + " at " + company + ". " + (job.descriptionPlain || desc).slice(0, 300);
          const { score, tier, hasBudget, hasUrgency } = scoreIntent({
            text: fullText,
            platform: "lever",
            postedAt: createdAt,
            isDecisionMaker: true,
            platformSourceConfidence: 95,
          });
          if (score === 0) return;

          leads.push({
            id: `lever-${jobId}`,
            platform: "lever",
            platform_label: `Lever: ${company}`,
            post_url: job.hostedUrl || `https://jobs.lever.co/${company}/${jobId}`,
            post_title: job.text,
            post_body_snippet: (job.descriptionPlain || "").slice(0, 600),
            ai_summary: `${company} (via Lever) is hiring a ${job.text}`,
            why_shown: `Active Lever job posting · ${company} · ${relativeTime(createdAt)}`,
            author_handle: company,
            author_url: `https://jobs.lever.co/${company}`,
            author_name: company,
            posted_at: createdAt,
            posted_at_relative: relativeTime(createdAt),
            engagement: {},
            intent_score: score,
            intent_tier: tier,
            is_decision_maker: true,
            has_budget: hasBudget,
            has_urgency: hasUrgency,
            source_confidence: 95,
          });
        }
      } catch {
        /* silent */
      }
    }),
  );

  return leads;
}
