/**
 * M13 — Evidence-backed job ↔ employer relationships.
 *
 * Job board SERP title ≠ employer.
 * Co-mention of a company name on a listings page ≠ employer binding.
 */
import type { Evidence } from "@/lib/search/evidence";
import {
  asClaimEvidence,
  type ClaimEvidence,
} from "@/lib/search/claim-binding";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import {
  isProvisionalEntityId,
  isStableEntityId,
} from "@/lib/search/canonical-contract";
import type { EmployerBinding } from "@/lib/search/job";
import { isOrganizationEntityId } from "@/lib/search/person-employment";
import type { JobCurrentness } from "@/lib/search/verification";
import { jobImpliesActivePosting } from "@/lib/search/job";

export type JobEmployerDecision =
  | { ok: true; binding: EmployerBinding; job_currentness: JobCurrentness }
  | {
      ok: false;
      reject_code: QualificationRejectCode;
      reason: string;
    };

/**
 * Build employer binding only from explicit claim parameters:
 *   organization_entity_id / employer_entity_id + subject = job
 */
export function employerFromEvidence(args: {
  job_entity_id: string;
  evidence: Evidence | ClaimEvidence;
  employer_name?: string | null;
}): JobEmployerDecision {
  const { job_entity_id, evidence } = args;
  const claim = asClaimEvidence(evidence, job_entity_id);
  if (!claim) {
    return {
      ok: false,
      reject_code: "CLAIM_NOT_SUBJECT_BOUND",
      reason: "employer evidence not subject-bound to job",
    };
  }
  if (claim.subject !== job_entity_id.trim()) {
    return {
      ok: false,
      reject_code: "CLAIM_NOT_SUBJECT_BOUND",
      reason: "employer evidence subject ≠ job entity_id",
    };
  }

  const params = claim.claim_parameters ?? {};
  const orgId =
    (typeof params.employer_entity_id === "string" &&
      params.employer_entity_id.trim()) ||
    (typeof params.organization_entity_id === "string" &&
      params.organization_entity_id.trim()) ||
    (typeof params.company_entity_id === "string" &&
      params.company_entity_id.trim()) ||
    null;

  if (!orgId) {
    return {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason:
        "job and company co-mention is not an employer binding — missing employer_entity_id",
    };
  }
  if (isProvisionalEntityId(orgId) || !isStableEntityId(orgId)) {
    return {
      ok: false,
      reject_code: "ASSOCIATED_COMPANY_UNRESOLVED",
      reason: "employer entity_id is provisional/unresolved",
    };
  }
  if (!isOrganizationEntityId(orgId)) {
    return {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason: `employer_entity_id ${orgId} is not an organization identity`,
    };
  }

  const stamped = params.job_currentness;
  const job_currentness: JobCurrentness =
    stamped === "active" ||
    stamped === "expired" ||
    stamped === "stale" ||
    stamped === "unknown"
      ? stamped
      : "unknown";

  const name =
    args.employer_name?.trim() ||
    (typeof params.employer === "string" ? params.employer : null) ||
    (typeof params.organization_name === "string"
      ? params.organization_name
      : null) ||
    (typeof params.company === "string" ? params.company : null);

  return {
    ok: true,
    job_currentness,
    binding: {
      job_entity_id: job_entity_id.trim(),
      employer_entity_id: orgId,
      employer_name: name,
      evidence: claim,
      confidence: claim.confidence,
    },
  };
}

export function requireEmployerForJobSpec(args: {
  spec: SearchSpec;
  job_entity_id: string;
  evidence: Array<Evidence | ClaimEvidence>;
  employer_name?: string | null;
}): JobEmployerDecision {
  const { spec, job_entity_id, evidence } = args;
  if (spec.entity !== "job") {
    return {
      ok: false,
      reject_code: "ENTITY_TYPE_MISMATCH",
      reason: "employer gate only applies to job Specs",
    };
  }

  let lastFail: JobEmployerDecision | null = null;
  for (const ev of evidence) {
    const built = employerFromEvidence({
      job_entity_id,
      evidence: ev,
      employer_name: args.employer_name,
    });
    if (!built.ok) {
      lastFail = built;
      continue;
    }

    if (jobImpliesActivePosting(spec)) {
      if (
        built.job_currentness === "expired" ||
        built.job_currentness === "stale"
      ) {
        return {
          ok: false,
          reject_code: "CURRENTNESS_MISMATCH",
          reason: `job_currentness ${built.job_currentness} cannot satisfy active posting request`,
        };
      }
      if (built.job_currentness === "unknown") {
        return {
          ok: false,
          reject_code: "CURRENTNESS_MISMATCH",
          reason: "job_currentness_unknown_fail_closed",
        };
      }
    }

    return built;
  }

  return (
    lastFail ?? {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason: "no evidence-backed job↔employer relationship",
    }
  );
}

/** Evaluate job posting currentness stamp against Spec. */
export function evaluateJobCurrentness(
  evidence: Evidence | ClaimEvidence,
  spec: SearchSpec,
): { ok: boolean; value: JobCurrentness; reason: string } {
  const wantsActive = jobImpliesActivePosting(spec);
  const params =
    ("claim_parameters" in evidence && evidence.claim_parameters) ||
    ({} as Record<string, unknown>);
  const stamped = (params.job_currentness as string | undefined) ?? null;
  const value: JobCurrentness =
    stamped === "active" ||
    stamped === "expired" ||
    stamped === "stale" ||
    stamped === "unknown"
      ? stamped
      : "unknown";

  if (!wantsActive) {
    return { ok: true, value, reason: "job_currentness_not_required" };
  }
  if (value === "expired" || value === "stale") {
    return {
      ok: false,
      value,
      reason: "expired_or_stale_posting_cannot_satisfy_active_request",
    };
  }
  if (value === "unknown") {
    return {
      ok: false,
      value,
      reason: "job_currentness_unknown_fail_closed",
    };
  }
  return { ok: true, value, reason: "active" };
}
