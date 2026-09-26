/**
 * M14 — Need / intent detection over social post text.
 *
 * Topic relevance ≠ ask. Keep detected_need, intent, claim_parameters,
 * confidence, evidence_text separate. Do not invent service_request from
 * identity statements, past work, or third-party observations.
 */
import type { EvidenceType } from "@/lib/search/evidence";

export type SocialIntent =
  | "service_request"
  | "social_ask"
  | "hiring"
  | "none"
  | "statement"
  | "identity_offer"
  | "third_party_observation";

export interface SocialNeedDetection {
  is_ask: boolean;
  detected_need: string | null;
  intent: SocialIntent;
  claim_type: EvidenceType | null;
  confidence: number;
  evidence_text: string;
  claim_parameters: Record<string, string>;
  reject_reason?: string;
}

const ASK_PATTERNS: Array<{ re: RegExp; needHint?: string; claim: EvidenceType }> = [
  {
    re: /\b(looking for|in search of|need(?:ing)?|seeking)\b.{0,40}\b(web\s*design(?:er)?s?|website|copywriter|developer|marketing|freelancer|help)\b/i,
    claim: "social_ask",
  },
  {
    re: /\b(can anyone|anyone know|does anyone|anybody)\b.{0,60}\b(recommend|suggest|know)\b.{0,40}\b(web\s*design(?:er)?s?|copywriter|developer|freelancer|agency)\b/i,
    claim: "social_ask",
  },
  {
    re: /\b(need|looking for|seeking)\b.{0,40}\b(someone|somebody|a (?:good )?(?:person|pro|professional))\b.{0,40}\b(redesign|design|build|help).{0,20}\b(website|site|web)\b/i,
    claim: "service_request",
  },
  {
    re: /\b(hiring|we're hiring|we are hiring)\b/i,
    claim: "hiring",
  },
  {
    re: /\b(need|looking for|seeking)\b.{0,50}\b(website help|web(?:site)? (?:help|redesign|redesigner|developer|design)|copywrit(?:er|ing)|marketing help)\b/i,
    claim: "service_request",
  },
  {
    re: /\b(recommend|suggestion for)\b.{0,40}\b(a |an )?(web\s*design(?:er)?|copywriter|developer)\b/i,
    claim: "social_ask",
  },
];

const IDENTITY_OFFER =
  /\b(i'?m|i am|we are)\b.{0,30}\b(a |an )?(web\s*design(?:er)?|copywriter|developer|freelancer|marketer)\b/i;

const PAST_STATEMENT =
  /\b(we |i |just )?(redesigned|launched|built|shipped|updated)\b.{0,40}\b(our |my )?(website|site|web)\b/i;

const COST_OPINION =
  /\b(web development|website|marketing)\b.{0,40}\b(is |are )?(expensive|cheap|overpriced)\b/i;

/** Third-party: named org "needs X" without first-person company voice. */
const THIRD_PARTY_ORG_NEED =
  /\b([A-Z][A-Za-z0-9&.-]{1,40})\s+(needs|needs? a|could use|should get)\b.{0,40}\b(marketing|website|web\s*design|developer|copywriter)\b/;

const COMPANY_BEHALF =
  /\b(we at|our (?:team|company) at|here at)\s+([A-Z][A-Za-z0-9&.-]{1,40})\b.{0,80}\b(looking for|need|hiring|seeking)\b/i;

function clip(s: string, n = 180): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trim()}…` : t;
}

function inferNeedLabel(text: string): string | null {
  const lower = text.toLowerCase();
  if (/web\s*design|website|web\s*develop|redesign/.test(lower)) {
    return "website_help";
  }
  if (/copywrit/.test(lower)) return "copywriting";
  if (/market/.test(lower)) return "marketing";
  if (/develop/.test(lower)) return "developer";
  return null;
}

/**
 * Detect whether exact post text establishes a request / ask.
 * Returns is_ask=false for identity, past statements, opinions, third-party notes.
 */
export function detectSocialNeed(text: string): SocialNeedDetection {
  const evidence_text = clip(text || "");
  const empty = (intent: SocialIntent, reason: string): SocialNeedDetection => ({
    is_ask: false,
    detected_need: null,
    intent,
    claim_type: null,
    confidence: 0.85,
    evidence_text,
    claim_parameters: {},
    reject_reason: reason,
  });

  if (!text?.trim()) {
    return empty("none", "empty_text");
  }

  // Company-behalf first-person asks (may later bind to company with employment).
  const behalf = text.match(COMPANY_BEHALF);
  if (behalf) {
    const org = behalf[2]?.trim() ?? "";
    const need = inferNeedLabel(text);
    return {
      is_ask: true,
      detected_need: need,
      intent: "social_ask",
      claim_type: "social_ask",
      confidence: 0.8,
      evidence_text,
      claim_parameters: {
        detected_need: need ?? "",
        company_behalf: "true",
        organization_name: org,
        ask_voice: "first_person_org",
      },
    };
  }

  if (IDENTITY_OFFER.test(text) && !ASK_PATTERNS.some((p) => p.re.test(text))) {
    return empty("identity_offer", "identity_statement_not_a_service_request");
  }
  if (PAST_STATEMENT.test(text) && !ASK_PATTERNS.some((p) => p.re.test(text))) {
    return empty("statement", "past_work_statement_not_an_ask");
  }
  if (COST_OPINION.test(text) && !ASK_PATTERNS.some((p) => p.re.test(text))) {
    return empty("statement", "topic_opinion_not_an_ask");
  }

  // Third-party observation: "Acme needs marketing" without we/our.
  const third = text.match(THIRD_PARTY_ORG_NEED);
  if (third && !/\b(we|our|i|i'm|i am)\b/i.test(text.slice(0, 80))) {
    return {
      is_ask: false,
      detected_need: inferNeedLabel(text),
      intent: "third_party_observation",
      claim_type: null,
      confidence: 0.9,
      evidence_text,
      claim_parameters: {
        mentioned_organization: third[1] ?? "",
      },
      reject_reason: "third_party_observation_not_org_request",
    };
  }

  for (const p of ASK_PATTERNS) {
    if (p.re.test(text)) {
      const need = inferNeedLabel(text);
      const intent: SocialIntent =
        p.claim === "hiring"
          ? "hiring"
          : p.claim === "service_request"
            ? "service_request"
            : "social_ask";
      return {
        is_ask: true,
        detected_need: need,
        intent,
        claim_type: p.claim,
        confidence: 0.78,
        evidence_text,
        claim_parameters: {
          detected_need: need ?? "",
          ask_voice: "first_person",
        },
      };
    }
  }

  return empty("none", "no_ask_detected");
}

/** Whether Spec-requested need fields are compatible with a detection. */
export function socialNeedMatchesSpec(
  detection: SocialNeedDetection,
  requested: {
    requested_service?: string | null;
    requested_product?: string | null;
    requested_role?: string | null;
  },
): boolean {
  if (!detection.is_ask || !detection.claim_type) return false;
  // Match ONLY against the detection — never include Spec requested_* in the
  // blob or a Spec asking for "website" would match every ask that carries
  // the requested_service string into the haystack.
  const blob = [detection.detected_need, detection.evidence_text, detection.intent]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const want = (
    requested.requested_service ||
    requested.requested_product ||
    requested.requested_role ||
    ""
  ).toLowerCase();
  if (!want) return true;
  // Loose compatibility: website↔web, copywriter↔copywrit
  if (/website|web/.test(want) && /website|web|design/.test(blob)) return true;
  if (/copywrit/.test(want) && /copywrit/.test(blob)) return true;
  if (/market/.test(want) && /market/.test(blob)) return true;
  if (/develop/.test(want) && /develop/.test(blob)) return true;
  return blob.includes(want) || want.split(/\s+/).some((w) => w.length > 3 && blob.includes(w));
}
