/**
 * M14 — Social qualification gates on top of the QualifiedLead theorem.
 *
 * POST ≠ AUTHOR ≠ COMPANY. Platform identity ≠ real-world person.
 * Subreddit/group ≠ author location. Need must be an ask, not topic relevance.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { Evidence } from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import { isProvisionalEntityId } from "@/lib/search/canonical-contract";
import { evidenceClaimType, evidenceSubject } from "@/lib/search/claim-binding";
import { locationSatisfies } from "@/lib/search/location-resolver";

export type SocialGateResult =
  | { ok: true }
  | { ok: false; reject_code: QualificationRejectCode; reason: string };

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

function isSocialEvidence(e: Evidence): boolean {
  return e.source_type === "social";
}

function isNeedClaim(e: Evidence): boolean {
  const t = evidenceClaimType(e);
  return t === "social_ask" || t === "service_request" || t === "hiring";
}

/** True when this row/evidence path is a social discovery candidate. */
export function isSocialQualificationPath(
  row: SpecRow,
  evidence: Evidence[],
): boolean {
  if (row.page_type === "social_post") return true;
  return evidence.some((e) => isSocialEvidence(e) && isNeedClaim(e));
}

/**
 * After the generic theorem passes, enforce social-specific invariants.
 */
export function evaluateSocialGates(args: {
  row: SpecRow;
  spec: SearchSpec;
  evidence: Evidence[];
}): SocialGateResult {
  const { row, spec, evidence } = args;
  if (!isSocialQualificationPath(row, evidence)) {
    return { ok: true };
  }

  // Group/page/community container is never the person lead.
  if (
    row.page_type === "list" ||
    row.page_type === "directory" ||
    row.page_type === "aggregator" ||
    (row as SpecRow & { is_community_container?: boolean }).is_community_container
  ) {
    return {
      ok: false,
      reject_code: "SOURCE_IS_LEAD",
      reason: "social group/page/community is not a person lead",
    };
  }

  // Spec entity must not inherit onto a social post as company/business by default.
  if (
    (spec.entity === "company" || spec.entity === "business") &&
    row.kind === "person" &&
    !evidence.some((e) => {
      const p =
        ("claim_parameters" in e && e.claim_parameters) ||
        ({} as Record<string, unknown>);
      return p.company_behalf === "true" || p.company_behalf === true;
    })
  ) {
    // Person author rows cannot satisfy company Spec without company-behalf claim.
    return {
      ok: false,
      reject_code: "ENTITY_TYPE_MISMATCH",
      reason: "social author person cannot satisfy company Spec without company-behalf claim",
    };
  }

  if (row.kind === "company" || row.kind === "business") {
    const behalf = evidence.some((e) => {
      const p =
        ("claim_parameters" in e && e.claim_parameters) ||
        ({} as Record<string, unknown>);
      return p.company_behalf === "true" || p.company_behalf === true;
    });
    if (!behalf) {
      return {
        ok: false,
        reject_code: "CLAIM_NOT_SUBJECT_BOUND",
        reason:
          "company lead from social requires first-person org ask + proven employment — post mentioning a company is not authorship",
      };
    }
  }

  const entityId = row.entity_id?.trim() ?? "";
  if (!entityId) {
    return {
      ok: false,
      reject_code: "MISSING_IDENTITY",
      reason: "social lead requires author entity_id",
    };
  }

  // Anonymous / platform-only: fail closed when Spec wants a real person.
  if (spec.entity === "person") {
    if (isProvisionalEntityId(entityId) || row.entity_resolved === false) {
      return {
        ok: false,
        reject_code: isProvisionalEntityId(entityId)
          ? "PROVISIONAL_ENTITY"
          : "ENTITY_UNRESOLVED",
        reason:
          "platform identity established but real-world person unresolved — refuse silent weaken of M4",
      };
    }
  }

  // Need claims must bind to the row subject (author or proven company).
  const needEv = evidence.filter(
    (e) => isSocialEvidence(e) && isNeedClaim(e),
  );
  if (spec.signal_required && needEv.length === 0) {
    // Funding/hiring mention that is not a matching ask must not satisfy unrelated Spec.
    const otherSocial = evidence.filter(isSocialEvidence);
    if (otherSocial.length > 0) {
      return {
        ok: false,
        reject_code: "CLAIM_TYPE_MISMATCH",
        reason: "social evidence present but no matching ask claim for Spec signal",
      };
    }
  }

  for (const ev of needEv) {
    const sub = evidenceSubject(ev);
    if (!sub || sub !== entityId) {
      return {
        ok: false,
        reject_code: "CLAIM_NOT_SUBJECT_BOUND",
        reason: `social ask subject ${sub ?? "∅"} ≠ lead entity ${entityId}`,
      };
    }
    const params =
      ("claim_parameters" in ev && ev.claim_parameters) ||
      ({} as Record<string, unknown>);
    if (params.is_ask === false || params.is_ask === "false") {
      return {
        ok: false,
        reject_code: "CLAIM_TYPE_MISMATCH",
        reason: "social text is not an ask (identity/statement/third-party)",
      };
    }
    if (params.intent === "third_party_observation") {
      return {
        ok: false,
        reject_code: "CLAIM_NOT_SUBJECT_BOUND",
        reason: "third-party observation is not an org/person request",
      };
    }
  }

  // Location: community/subreddit is NOT author location. M6 remains authority.
  const wantLoc = fieldOf(spec, "location");
  if (wantLoc) {
    const have = row.location?.trim() || null;
    if (!have) {
      return {
        ok: false,
        reject_code: "MISSING_QUERY_REQUIRED",
        reason:
          "query-required location cannot be inferred from subreddit/group — author location missing",
      };
    }
    // Reject community-as-location smuggling: detail like "r/toronto" alone.
    if (
      /^r\//i.test(have) ||
      (/^r\//i.test(row.detail ?? "") &&
        have.toLowerCase() === (row.detail ?? "").replace(/^r\//i, "").toLowerCase())
    ) {
      return {
        ok: false,
        reject_code: "LOCATION_MISMATCH",
        reason: "subreddit/community name is not proof of author location",
      };
    }
    if (!locationSatisfies(have, wantLoc)) {
      return {
        ok: false,
        reject_code: "LOCATION_MISMATCH",
        reason: `author location ${have} does not satisfy ${wantLoc}`,
      };
    }
  }

  return { ok: true };
}
