/**
 * M12 — Person qualification gates on top of the canonical theorem.
 *
 * Does not bypass M4 identity resolution. Does not invent employment from
 * co-mention. Need/signal claims stay separate from role identity.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { Evidence } from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import { evidenceClaimType } from "@/lib/search/claim-binding";
import {
  needClaimBoundToPerson,
  requireEmploymentForPersonSpec,
  type EmploymentRelationship,
} from "@/lib/search/person-employment";
import {
  personImpliesCurrentRole,
  personRoleFromSpec,
  personSpecRequiresEmployment,
  resolvePersonIdentity,
  type PersonIdentitySeed,
} from "@/lib/search/person";
import { evaluateRoleCurrentness } from "@/lib/search/verification";

export type PersonGateResult =
  | { ok: true; employment: EmploymentRelationship | null }
  | { ok: false; reject_code: QualificationRejectCode; reason: string };

/**
 * After the generic theorem passes (or in parallel for person Specs), enforce
 * people-specific invariants.
 */
export function evaluatePersonGates(args: {
  row: SpecRow;
  spec: SearchSpec;
  evidence: Evidence[];
  /** Optional competing identity seeds for collision checks. */
  identitySeeds?: PersonIdentitySeed[];
}): PersonGateResult {
  const { row, spec, evidence } = args;
  if (spec.entity !== "person") {
    return { ok: true, employment: null };
  }

  // Query entity type must not inherit onto a resolved org page.
  if (row.kind && row.kind !== "person") {
    return {
      ok: false,
      reject_code: "ENTITY_TYPE_MISMATCH",
      reason: `resolved kind ${row.kind} cannot satisfy person Spec (e.g. Founder Institute / company LinkedIn)`,
    };
  }
  if (row.page_type === "institute" || row.page_type === "company_page") {
    // company_page as person is only ok when upstream resolved entity_type person;
    // institute is never a person.
    if (row.page_type === "institute" || row.kind === "company" || row.kind === "business") {
      return {
        ok: false,
        reject_code: "ENTITY_TYPE_MISMATCH",
        reason: `page_type/kind ${row.page_type}/${row.kind} is not a person`,
      };
    }
  }

  const personId = row.entity_id?.trim() ?? "";
  if (!personId) {
    return {
      ok: false,
      reject_code: "MISSING_IDENTITY",
      reason: "person entity_id required",
    };
  }

  if (args.identitySeeds && args.identitySeeds.length > 0) {
    const decision = resolvePersonIdentity(args.identitySeeds);
    if (decision.status !== "resolved") {
      return {
        ok: false,
        reject_code: decision.reject_code,
        reason: decision.reason,
      };
    }
    if (decision.entity_id !== personId) {
      return {
        ok: false,
        reject_code: "CLAIM_NOT_SUBJECT_BOUND",
        reason: "person evidence bound to another same-name person",
      };
    }
  }

  const role = personRoleFromSpec(spec);
  let employment: EmploymentRelationship | null = null;

  // Currentness: former/historical stamps cannot satisfy current person+role Specs.
  if (personImpliesCurrentRole(spec)) {
    const currentSpec: SearchSpec = {
      ...spec,
      criteria: [
        ...spec.criteria.filter((c) => c.field !== "role_currentness"),
        {
          field: "role_currentness",
          value: "current_role",
          stated: true,
          confidence: 1,
        },
      ],
    };
    const stamped = evidence.filter((e) => {
      const p =
        ("claim_parameters" in e && e.claim_parameters) ||
        ({} as Record<string, unknown>);
      return typeof p.role_currentness === "string";
    });
    if (stamped.length > 0) {
      const anyCurrent = stamped.some((e) => evaluateRoleCurrentness(e, currentSpec).ok);
      if (!anyCurrent) {
        const fail = evaluateRoleCurrentness(stamped[0]!, currentSpec);
        return {
          ok: false,
          reject_code: "CURRENTNESS_MISMATCH",
          reason: fail.reason,
        };
      }
    }
  }

  // Role/company hunts that imply an organization require evidence-backed
  // employment — co-mention alone is EMPLOYMENT_UNPROVEN.
  if (personSpecRequiresEmployment(spec)) {
    const emp = requireEmploymentForPersonSpec({
      spec,
      person_entity_id: personId,
      evidence,
      organization_name: row.detail ?? null,
    });
    if (!emp.ok) return emp;
    employment = emp.employment;
  } else if (role.normalized) {
    // Still reject any claim that names a company without binding an org id
    // (guards the co-mention failure mode even when employment is optional).
    for (const ev of evidence) {
      const params =
        ("claim_parameters" in ev && ev.claim_parameters) ||
        ({} as Record<string, unknown>);
      const named =
        (typeof params.company === "string" && params.company.trim()) ||
        (typeof params.organization_name === "string" &&
          params.organization_name.trim());
      const orgId =
        (typeof params.organization_entity_id === "string" &&
          params.organization_entity_id.trim()) ||
        (typeof params.company_entity_id === "string" &&
          params.company_entity_id.trim()) ||
        null;
      if (named && !orgId) {
        return {
          ok: false,
          reject_code: "EMPLOYMENT_UNPROVEN",
          reason:
            "person and company co-mentioned without organization_entity_id — not an employment relationship",
        };
      }
    }
  }

  // Need/signal: must bind to the same person — founder evidence + unrelated
  // developer job about someone else still fails.
  if (spec.signal_required) {
    const needTypes = new Set(
      (spec.signal_types ?? []).map((t) => t.toLowerCase()),
    );
    const needEv = evidence.filter((e) => {
      const t = evidenceClaimType(e);
      if (needTypes.has(t)) return true;
      if (needTypes.has("hiring") && t === "hiring") return true;
      if (needTypes.has("service_request") && t === "service_request") return true;
      if (needTypes.has("social_ask") && t === "social_ask") return true;
      return false;
    });
    const bound = needClaimBoundToPerson({
      person_entity_id: personId,
      needEvidence: needEv.length ? needEv : evidence,
    });
    if (!bound.ok) return bound;
  }

  // Email/phone: required_when_available — only block when Spec promotes them.
  // (theorem already covers queryRequiredFields for email/phone.)

  // Resolved person but provisional associated company when company is required.
  if (employment && fieldHas(spec, "associated_company")) {
    if (!employment.organization_entity_id) {
      return {
        ok: false,
        reject_code: "ASSOCIATED_COMPANY_UNRESOLVED",
        reason: "query-required company unresolved for person lead",
      };
    }
  }

  return { ok: true, employment };
}

function fieldHas(spec: SearchSpec, f: string): boolean {
  return spec.criteria.some((c) => c.field === f && c.value.trim());
}
