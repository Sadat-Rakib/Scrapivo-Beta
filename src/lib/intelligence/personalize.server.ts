/**
 * Unified personalization — evidence + offer → hooks/draft via existing AI router.
 * Does not send mail; CASL/approval stays in outreach layer.
 */
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import type { EvidenceClaim } from "./evidence";
import type { PlaybookId } from "@/lib/search/playbook-planner";

export type PersonalizeInput = {
  entityName: string;
  entityUrl?: string;
  offer?: string;
  playbook?: PlaybookId | string;
  evidence: EvidenceClaim[];
  platform?: string;
  snippet?: string;
};

export type PersonalizeResult = {
  opening_observation: string;
  reason_for_relevance: string;
  value_proposition: string;
  cta: string;
  dm: string;
  email_subject: string;
  email_body: string;
  used_claims: string[];
};

/**
 * Produce personalization hooks + draft copy from observed evidence only.
 */
export async function personalizeOutreach(input: PersonalizeInput): Promise<PersonalizeResult> {
  const claims = input.evidence.slice(0, 8);
  const claimLines = claims.map(
    (c) => `- ${c.claim} (${c.confidence}) via ${c.evidence.map((e) => e.source).join(", ")}`,
  );

  if (!claims.length) {
    return {
      opening_observation: "",
      reason_for_relevance: "",
      value_proposition: "",
      cta: "",
      dm: "",
      email_subject: "",
      email_body: "",
      used_claims: [],
    };
  }

  const prompt = `You write concise B2B outreach grounded ONLY in the evidence list.
Never invent facts. If evidence is thin, say so briefly and stay humble.
Playbook: ${input.playbook || "CUSTOM"}
Offer / objective: ${input.offer || "relevant help"}
Entity: ${input.entityName}
URL: ${input.entityUrl || ""}
Platform: ${input.platform || ""}
Snippet: ${(input.snippet || "").slice(0, 400)}

Evidence:
${claimLines.join("\n")}

Return JSON:
{
  "opening_observation": "one sentence citing a real observation",
  "reason_for_relevance": "why this entity fits the offer",
  "value_proposition": "one short value line",
  "cta": "soft ask",
  "dm": "<=400 chars DM",
  "email_subject": "<=8 words",
  "email_body": "short plain-text email with greeting + observation + value + CTA",
  "used_claims": ["claim text copied from evidence"]
}`;

  try {
    const raw = await aiComplete({
      task: "extract",
      system: "You are an outreach copywriter. Cite only provided evidence. Reply with JSON only.",
      user: prompt,
      json: true,
      maxTokens: 700,
    });
    const parsed = safeJsonParse<PersonalizeResult>(raw);
    if (parsed?.email_body || parsed?.dm) {
      return {
        opening_observation: parsed.opening_observation || "",
        reason_for_relevance: parsed.reason_for_relevance || "",
        value_proposition: parsed.value_proposition || "",
        cta: parsed.cta || "",
        dm: parsed.dm || "",
        email_subject: parsed.email_subject || "",
        email_body: parsed.email_body || "",
        used_claims: parsed.used_claims || claims.map((c) => c.claim),
      };
    }
  } catch {
    /* fall through to template */
  }

  const top = claims[0];
  const obs = top.claim;
  const offer = input.offer || "help";
  return {
    opening_observation: `I noticed ${obs}.`,
    reason_for_relevance: `That often pairs with needing ${offer}.`,
    value_proposition: `I help with ${offer} based on what I observed.`,
    cta: "Open to a quick look?",
    dm: `Hi — noticed ${obs}. If ${offer} is useful, happy to share a short idea.`,
    email_subject: `Re: ${obs.slice(0, 40)}`,
    email_body: `Hi ${input.entityName},\n\nI noticed ${obs}.\n\nIf ${offer} would help, I can share a brief idea — no pitch deck.\n\nThanks`,
    used_claims: [obs],
  };
}
