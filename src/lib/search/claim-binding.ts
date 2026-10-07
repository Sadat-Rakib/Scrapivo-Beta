/**
 * Claim-binding helpers shared by the theorem and M9 verification.
 * Kept separate so canonical-contract ↔ verification never form a cycle.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { Evidence, EvidenceType } from "@/lib/search/evidence";

export type RoleCurrentness =
  | "current_role"
  | "former_role"
  | "historical_role"
  | "unknown";

export interface ClaimEvidence {
  subject: string;
  claim: string;
  claim_type: EvidenceType;
  claim_parameters?: Record<string, string | number | boolean | null>;
  evidence_source?: string;
  evidence_url: string;
  evidence_text: string | null;
  observed_at: string;
  event_at?: string | null;
  freshness?: "fresh" | "stale" | "unknown";
  confidence: number;
}

/** Signal types that can qualify under signal_required (claim vocabulary). */
export const QUALIFYING_CLAIM_TYPES: EvidenceType[] = [
  "hiring",
  "service_request",
  "no_website",
  "funding",
  "investment",
  "social_ask",
];

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

/**
 * Claims the Spec actually requests — not “any qualifying evidence type.”
 */
export function requestedClaimTypes(spec: SearchSpec): EvidenceType[] {
  const out = new Set<EvidenceType>();
  for (const t of spec.signal_types ?? []) {
    const n = t.toLowerCase().trim();
    if (n === "investment") out.add("investment");
    if (n === "hiring" || n === "job") out.add("hiring");
    if (n === "funding" || n === "funded") out.add("funding");
    if (n === "social_ask" || n === "social") out.add("social_ask");
    if (n === "service_request" || n === "need") out.add("service_request");
    if (n === "no_website") out.add("no_website");
  }
  if (fieldOf(spec, "opportunity") === "no_website") out.add("no_website");
  if (fieldOf(spec, "funding_status")) out.add("funding");
  if (fieldOf(spec, "requested_role")) {
    if (spec.entity === "person") out.add("social_ask");
    else out.add("hiring");
  }
  if (fieldOf(spec, "requested_service") || fieldOf(spec, "requested_product")) {
    out.add("service_request");
  }
  return [...out];
}

export function evidenceClaimType(e: Evidence | ClaimEvidence): EvidenceType {
  if ("claim_type" in e && e.claim_type) return e.claim_type;
  return (e as Evidence).evidence_type;
}

export function evidenceSubject(e: Evidence | ClaimEvidence): string | null {
  if ("subject" in e && typeof e.subject === "string" && e.subject.trim()) {
    return e.subject.trim();
  }
  return null;
}

export function asClaimEvidence(
  e: Evidence | ClaimEvidence,
  fallbackSubject?: string | null,
): ClaimEvidence | null {
  const subject = evidenceSubject(e) ?? fallbackSubject?.trim() ?? null;
  if (!subject) return null;
  if ("claim_type" in e && "evidence_url" in e && e.claim_type) {
    return e as ClaimEvidence;
  }
  const ev = e as Evidence & {
    claim_parameters?: ClaimEvidence["claim_parameters"];
    event_at?: string | null;
  };
  return {
    subject,
    claim: ev.excerpt ?? ev.evidence_type,
    claim_type: ev.evidence_type,
    evidence_url: ev.source_url,
    evidence_text: ev.excerpt,
    observed_at: ev.observed_at,
    event_at: ev.event_at ?? null,
    confidence: ev.confidence,
    evidence_source: ev.source_type,
    claim_parameters: ev.claim_parameters,
  };
}

/** Claim alignment: evidence.claim_type must be one of the Spec-requested claims. */
export function isClaimAligned(
  e: Evidence | ClaimEvidence,
  requested: EvidenceType[],
): boolean {
  if (!requested.length) return false;
  return requested.includes(evidenceClaimType(e));
}

/** Subject binding: evidence must be about this exact entity_id. */
export function isSubjectBound(e: Evidence | ClaimEvidence, entityId: string): boolean {
  const sub = evidenceSubject(e);
  if (!sub) return false;
  return sub === entityId;
}
