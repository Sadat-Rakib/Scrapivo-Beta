/** Shared research runner (usable from researchLead + generateOutreach). */
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import {
  buildCompanyDossier,
  dossierContextForPrompt,
  type VerifiedHook,
} from "@/lib/research/company-dossier.server";

export type LeadResearch = {
  overview: string;
  pain_points: string[];
  why_now: string;
  recommended_angle: string;
  citations: string[];
  status_quo: string;
  urgency: string;
  verified_hooks: VerifiedHook[];
  company?: string;
  domain?: string | null;
};

export type ResearchInput = {
  leadUrl: string;
  leadTitle: string;
  leadSnippet: string;
  leadPlatform: string;
  leadAuthor?: string;
};

function hooksFromLegacy(citations: string[], leadUrl: string): VerifiedHook[] {
  return citations
    .filter(Boolean)
    .slice(0, 4)
    .map((c) => ({
      claim: c.slice(0, 200),
      citation_url: leadUrl,
      source_type: "lead_post" as const,
    }));
}

export function normalizeHooks(
  raw: unknown,
  allowedUrls: string[],
  leadUrl: string,
): VerifiedHook[] {
  if (!Array.isArray(raw)) return [];
  const allow = new Set(allowedUrls.map((u) => u.toLowerCase()));
  const out: VerifiedHook[] = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const claim = String((h as any).claim || "").trim();
    let citation_url = String((h as any).citation_url || "").trim();
    const source_type = String(
      (h as any).source_type || "lead_post",
    ) as VerifiedHook["source_type"];
    if (!claim) continue;
    if (!citation_url || !allow.has(citation_url.toLowerCase())) {
      citation_url = leadUrl;
    }
    out.push({
      claim: claim.slice(0, 220),
      citation_url,
      source_type: ["lead_post", "website", "careers", "news", "sec", "about"].includes(source_type)
        ? source_type
        : "lead_post",
    });
    if (out.length >= 6) break;
  }
  return out;
}

export function rowToResearch(row: any, leadUrl: string): LeadResearch {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const citations = (row.citations as string[]) ?? [];
  const verified_hooks =
    Array.isArray(raw.verified_hooks) && (raw.verified_hooks as any[]).length
      ? normalizeHooks(
          raw.verified_hooks,
          [leadUrl, ...((raw.allowed_urls as string[]) || [])],
          leadUrl,
        )
      : hooksFromLegacy(citations, leadUrl);
  return {
    overview: row.overview ?? "",
    pain_points: (row.pain_points as string[]) ?? [],
    why_now: row.why_now ?? "",
    recommended_angle: row.recommended_angle ?? "",
    citations,
    status_quo: typeof raw.status_quo === "string" ? raw.status_quo : "",
    urgency: typeof raw.urgency === "string" ? raw.urgency : "",
    verified_hooks,
    company: typeof raw.company === "string" ? raw.company : undefined,
    domain: (raw.domain as string | null | undefined) ?? null,
  };
}

const SYSTEM = `You are a senior B2B sales research analyst.
Given a lead post PLUS multi-source company evidence (website, careers, news, SEC), produce a concise research brief a freelancer/agency can use for personalized outreach.

HARD RULES:
- Only state facts supported by the evidence excerpts.
- Every verified_hook.claim MUST be grounded in evidence and citation_url MUST be one of the Allowed citation URLs.
- Prefer hooks from website/careers/news/SEC when available; always include at least one hook from the lead post if that is the only source.
- No marketing fluff. No invented funding amounts, headcount, or tech stacks.

Return strict JSON only (no markdown):
{
  "overview": "<2-3 sentences: who they are + what they're trying to do>",
  "pain_points": ["<concrete pain>", "..."],
  "why_now": "<1-2 sentences on urgency / timing>",
  "status_quo": "<1-2 sentences: how they seem to operate today>",
  "urgency": "<1 sentence: why outreach timing matters now>",
  "recommended_angle": "<1 paragraph: best first-contact angle, problem-led>",
  "citations": ["<short verbatim quote, max 140 chars>", "..."],
  "verified_hooks": [
    { "claim": "<specific fact usable as email opener>", "citation_url": "<exact allowed URL>", "source_type": "lead_post|website|careers|news|sec|about" }
  ]
}`;

type SupabaseLike = {
  from: (table: string) => any;
};

export async function runLeadResearch(
  supabase: SupabaseLike,
  userId: string,
  data: ResearchInput,
): Promise<LeadResearch> {
  const { data: existing } = await supabase
    .from("lead_research")
    .select("overview, pain_points, why_now, recommended_angle, citations, raw")
    .eq("user_id", userId)
    .eq("lead_url", data.leadUrl)
    .maybeSingle();

  if (existing?.overview) {
    const cached = rowToResearch(existing, data.leadUrl);
    if (cached.verified_hooks.length > 0 || cached.citations.length > 0) {
      return cached;
    }
  }

  const dossier = await buildCompanyDossier({
    leadUrl: data.leadUrl,
    leadTitle: data.leadTitle,
    leadSnippet: data.leadSnippet,
    leadAuthor: data.leadAuthor,
  });

  const user = `Lead meta:
- Platform: ${data.leadPlatform}
- Author: ${data.leadAuthor ?? "unknown"}
- URL: ${data.leadUrl}
- Title: ${data.leadTitle}

${dossierContextForPrompt(dossier)}

Produce the JSON brief with at least 2 verified_hooks when multiple sources exist, else at least 1 from the lead post.`;

  const content = await aiComplete({
    task: "research",
    system: SYSTEM,
    user,
    json: true,
    temperature: 0.3,
    maxTokens: 2000,
  });
  const parsed = safeJsonParse<Partial<LeadResearch> & { verified_hooks?: unknown }>(content) ?? {};

  let verified_hooks = normalizeHooks(parsed.verified_hooks, dossier.allowed_urls, data.leadUrl);
  if (!verified_hooks.length) {
    verified_hooks = hooksFromLegacy(
      Array.isArray(parsed.citations) ? parsed.citations : [data.leadSnippet.slice(0, 140)],
      data.leadUrl,
    );
  }

  const out: LeadResearch = {
    overview: parsed.overview ?? "",
    pain_points: Array.isArray(parsed.pain_points) ? parsed.pain_points.slice(0, 6) : [],
    why_now: parsed.why_now ?? "",
    recommended_angle: parsed.recommended_angle ?? "",
    citations: Array.isArray(parsed.citations) ? parsed.citations.slice(0, 4) : [],
    status_quo: typeof parsed.status_quo === "string" ? parsed.status_quo : "",
    urgency: typeof parsed.urgency === "string" ? parsed.urgency : "",
    verified_hooks,
    company: dossier.company,
    domain: dossier.domain,
  };

  try {
    await supabase.from("lead_research").upsert(
      {
        user_id: userId,
        lead_url: data.leadUrl,
        overview: out.overview,
        pain_points: out.pain_points,
        why_now: out.why_now,
        recommended_angle: out.recommended_angle,
        citations: out.citations,
        raw: {
          ...parsed,
          status_quo: out.status_quo,
          urgency: out.urgency,
          verified_hooks: out.verified_hooks,
          company: out.company,
          domain: out.domain,
          allowed_urls: dossier.allowed_urls,
        },
      },
      { onConflict: "user_id,lead_url" },
    );
  } catch {
    /* non-fatal */
  }
  return out;
}
