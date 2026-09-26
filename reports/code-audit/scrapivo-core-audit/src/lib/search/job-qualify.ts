/**
 * M13 — Job qualification gates on top of the canonical theorem.
 *
 * Does not bypass M4. Job boards / list pages are never employers.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { Evidence } from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import {
  requireEmployerForJobSpec,
  evaluateJobCurrentness,
} from "@/lib/search/job-employer";
import {
  jobImpliesActivePosting,
  resolveJobIdentity,
  type EmployerBinding,
  type JobIdentitySeed,
} from "@/lib/search/job";

export type JobGateResult =
  | { ok: true; employer: EmployerBinding | null }
  | { ok: false; reject_code: QualificationRejectCode; reason: string };

export function evaluateJobGates(args: {
  row: SpecRow;
  spec: SearchSpec;
  evidence: Evidence[];
  identitySeeds?: JobIdentitySeed[];
}): JobGateResult {
  const { row, spec, evidence } = args;
  if (spec.entity !== "job") {
    return { ok: true, employer: null };
  }

  if (row.kind && row.kind !== "job") {
    return {
      ok: false,
      reject_code: "ENTITY_TYPE_MISMATCH",
      reason: `resolved kind ${row.kind} cannot satisfy job Spec (job board ≠ posting)`,
    };
  }
  if (
    row.page_type === "job_board" ||
    row.page_type === "list" ||
    row.page_type === "directory" ||
    row.page_type === "aggregator"
  ) {
    return {
      ok: false,
      reject_code: "LIST_PAGE_AS_ENTITY",
      reason: `page_type ${row.page_type} is a source, not a job posting lead`,
    };
  }

  const jobId = row.entity_id?.trim() ?? "";
  if (!jobId) {
    return {
      ok: false,
      reject_code: "MISSING_IDENTITY",
      reason: "job entity_id required",
    };
  }

  if (args.identitySeeds && args.identitySeeds.length > 0) {
    const decision = resolveJobIdentity(args.identitySeeds);
    if (decision.status !== "resolved") {
      return {
        ok: false,
        reject_code: decision.reject_code,
        reason: decision.reason,
      };
    }
    if (decision.entity_id !== jobId) {
      return {
        ok: false,
        reject_code: "CLAIM_NOT_SUBJECT_BOUND",
        reason: "job evidence bound to another same-title posting",
      };
    }
  }

  if (jobImpliesActivePosting(spec)) {
    const stamped = evidence.filter((e) => {
      const p =
        ("claim_parameters" in e && e.claim_parameters) ||
        ({} as Record<string, unknown>);
      return typeof p.job_currentness === "string";
    });
    if (stamped.length > 0) {
      const anyActive = stamped.some(
        (e) => evaluateJobCurrentness(e, spec).ok,
      );
      if (!anyActive) {
        const fail = evaluateJobCurrentness(stamped[0]!, spec);
        return {
          ok: false,
          reject_code: "CURRENTNESS_MISMATCH",
          reason: fail.reason,
        };
      }
    }
  }

  // When claim evidence names a company, require a stable org id (co-mention ≠
  // employer). Structured job artifacts that only carry row.employer are
  // already gated by the theorem's employer field.
  const employerRelated = evidence.filter((e) => {
    const p =
      ("claim_parameters" in e && e.claim_parameters) ||
      ({} as Record<string, unknown>);
    return (
      (typeof p.employer === "string" && !!p.employer.trim()) ||
      (typeof p.company === "string" && !!p.company.trim()) ||
      (typeof p.organization_name === "string" && !!p.organization_name.trim()) ||
      (typeof p.employer_entity_id === "string" && !!p.employer_entity_id.trim()) ||
      (typeof p.organization_entity_id === "string" &&
        !!p.organization_entity_id.trim()) ||
      (typeof p.company_entity_id === "string" && !!p.company_entity_id.trim())
    );
  });

  if (employerRelated.length > 0) {
    const emp = requireEmployerForJobSpec({
      spec,
      job_entity_id: jobId,
      evidence: employerRelated,
      employer_name:
        (row as SpecRow & { employer?: string | null }).employer ??
        row.detail ??
        null,
    });
    if (!emp.ok) return emp;
    return { ok: true, employer: emp.binding };
  }

  const employerName = (
    (row as SpecRow & { employer?: string | null }).employer ??
    row.detail ??
    ""
  ).trim();
  if (!employerName) {
    return {
      ok: false,
      reject_code: "MISSING_QUERY_REQUIRED",
      reason: "job lead missing employer",
    };
  }

  return { ok: true, employer: null };
}
