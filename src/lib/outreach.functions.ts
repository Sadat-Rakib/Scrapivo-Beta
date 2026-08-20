import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import { runLeadResearch, rowToResearch } from "@/lib/research/run-research.server";
import type { VerifiedHook } from "@/lib/research/company-dossier.server";
import { draftEntityOutreachEmail, type OutreachDomain } from "@/lib/outreach/entity-draft.server";

const EntityDraftInput = z.object({
  domain: z.enum(["investor", "business", "job"]),
  entity: z.object({
    name: z.string().max(200).optional(),
    subtitle: z.string().max(300).optional(),
    category: z.string().max(120).optional(),
    location: z.string().max(200).optional(),
    description: z.string().max(4000).optional(),
    website: z.string().max(500).optional(),
    email: z.string().max(200).optional(),
    phone: z.string().max(60).optional(),
    tags: z.array(z.string().max(100)).max(30).optional(),
    sectors: z.array(z.string().max(100)).max(30).optional(),
    firm: z.string().max(200).optional(),
    investor_type: z.string().max(60).optional(),
    stage: z.string().max(200).optional(),
    check_size: z.string().max(80).optional(),
    thesis: z.string().max(2000).optional(),
    role_title: z.string().max(200).optional(),
    company_name: z.string().max(200).optional(),
    seniority: z.string().max(60).optional(),
    salary: z.string().max(80).optional(),
    source: z.string().max(80).optional(),
    job_url: z.string().max(500).optional(),
    remote: z.boolean().optional(),
    opportunity_tags: z.array(z.string().max(60)).max(20).optional(),
  }),
});

/**
 * Draft outreach from the directory detail drawer (Company360View).
 * One entry point for investor / business / job; the prompt is assembled
 * per entity type from the fields that actually exist on the entity.
 */
export const draftEntityOutreach = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => EntityDraftInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, job_title, skills")
      .eq("id", context.userId)
      .maybeSingle();

    try {
      const draft = await draftEntityOutreachEmail(data.domain as OutreachDomain, data.entity, {
        name: profile?.full_name,
        jobTitle: profile?.job_title,
        skills: Array.isArray(profile?.skills) ? profile.skills : null,
      });
      return { error: null as string | null, ...draft };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Outreach generation failed";
      return { error: message, subject: "", body: "" };
    }
  });

const Input = z.object({
  leadUrl: z.string().url(),
  leadTitle: z.string(),
  leadSnippet: z.string(),
  leadPlatform: z.string(),
  leadAuthor: z.string().optional(),
  /** When false, do not auto-run research — return needs_research instead. */
  autoResearch: z.boolean().optional(),
});

type OutreachOut = {
  dm: string;
  email_subject: string;
  email_body: string;
  call: string;
  used_hook?: VerifiedHook | null;
  needs_research?: boolean;
  message?: string;
};

export const generateOutreach = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<OutreachOut> => {
    let brief = null as ReturnType<typeof rowToResearch> | null;

    const { data: researchRow } = await context.supabase
      .from("lead_research")
      .select("overview, pain_points, why_now, recommended_angle, citations, raw")
      .eq("user_id", context.userId)
      .eq("lead_url", data.leadUrl)
      .maybeSingle();

    if (researchRow?.overview) {
      brief = rowToResearch(researchRow, data.leadUrl);
    }

    if ((!brief || !brief.verified_hooks.length) && data.autoResearch !== false) {
      brief = await runLeadResearch(context.supabase, context.userId, {
        leadUrl: data.leadUrl,
        leadTitle: data.leadTitle,
        leadSnippet: data.leadSnippet,
        leadPlatform: data.leadPlatform,
        leadAuthor: data.leadAuthor,
      });
    }

    if (!brief?.verified_hooks?.length) {
      return {
        dm: "",
        email_subject: "",
        email_body: "",
        call: "",
        used_hook: null,
        needs_research: true,
        message: "Run AI research first so outreach can cite a verified finding.",
      };
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, job_title, skills")
      .eq("id", context.userId)
      .maybeSingle();

    const me = `${profile?.full_name ?? "I"}, ${profile?.job_title ?? "freelancer"}${
      profile?.skills?.length ? ` (skills: ${profile.skills.join(", ")})` : ""
    }`;

    const primaryHook = brief.verified_hooks[0];
    const researchBlock = {
      overview: brief.overview,
      pain_points: brief.pain_points,
      why_now: brief.why_now,
      recommended_angle: brief.recommended_angle,
      status_quo: brief.status_quo,
      urgency: brief.urgency,
      verified_hooks: brief.verified_hooks,
    };

    const system =
      "You are an outreach copywriter for research-driven cold outreach. " +
      "Return only valid minified JSON. No markdown fences. " +
      "CRITICAL: The DM, email body, and call opener MUST open by referencing the primary verified hook " +
      "(paraphrase the claim — do not invent new facts). No generic icebreakers like 'Hope you're well' " +
      "or 'I came across your profile'. Be warm, brief, specific, no fluff.";

    const user = `Write outreach for ${me}.

Lead:
- Platform: ${data.leadPlatform}
- Author: ${data.leadAuthor ?? "unknown"}
- Title: ${data.leadTitle}
- Snippet: ${data.leadSnippet.slice(0, 500)}

Research brief:
${JSON.stringify(researchBlock)}

PRIMARY HOOK (must open every channel with this):
${JSON.stringify(primaryHook)}

Return JSON exactly:
{"dm":"<short DM <=400 chars, opens with hook>","email_subject":"<<=70 chars, specific>","email_body":"<email <=900 chars, greeting + hook opener + value + soft CTA + signoff>","call":"<cold-call opener <=300 chars, opens with hook>"}`;

    const content = await aiComplete({
      task: "extract",
      system,
      user,
      json: true,
      temperature: 0.6,
      maxTokens: 1200,
    });
    const parsed = safeJsonParse<Partial<OutreachOut>>(content) ?? {};
    return {
      dm: parsed.dm ?? "",
      email_subject: parsed.email_subject ?? "",
      email_body: parsed.email_body ?? "",
      call: parsed.call ?? "",
      used_hook: primaryHook,
      needs_research: false,
    };
  });

/** Evidence-backed personalization (shared intelligence layer). */
export const personalizeFromEvidence = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        entityName: z.string().min(1).max(200),
        entityUrl: z.string().max(500).optional(),
        offer: z.string().max(200).optional(),
        playbook: z.string().max(40).optional(),
        platform: z.string().max(80).optional(),
        snippet: z.string().max(1000).optional(),
        evidence: z
          .array(
            z.object({
              claim: z.string(),
              confidence: z.enum(["high", "medium", "low"]),
              evidence: z.array(
                z.object({
                  source: z.string(),
                  data: z.string(),
                  url: z.string().optional(),
                }),
              ),
              observedAt: z.string().optional(),
            }),
          )
          .max(12),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { personalizeOutreach } = await import("./intelligence/personalize.server");
    return personalizeOutreach({
      entityName: data.entityName,
      entityUrl: data.entityUrl,
      offer: data.offer,
      playbook: data.playbook,
      platform: data.platform,
      snippet: data.snippet,
      evidence: data.evidence.map((e) => ({
        claim: e.claim,
        confidence: e.confidence,
        evidence: e.evidence,
        observedAt: e.observedAt || new Date().toISOString(),
      })),
    });
  });
