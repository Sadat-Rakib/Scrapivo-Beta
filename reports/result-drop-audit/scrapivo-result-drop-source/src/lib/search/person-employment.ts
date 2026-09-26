/**
 * M12 — Evidence-backed person↔organization relationships.
 *
 * Co-mention on a page is NOT employment:
 *   Person A on page + Company B on page ≠ A works at B
 *
 * Both sides should carry stable entity IDs when available:
 *   person:…  →  organization:… / org:… / company:…
 */
import type { Evidence } from "@/lib/search/evidence";
import {
  asClaimEvidence,
  type ClaimEvidence,
  type RoleCurrentness,
} from "@/lib/search/claim-binding";
import { normalizeRole } from "@/lib/search/search-spec-extract";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import { isProvisionalEntityId, isStableEntityId } from "@/lib/search/canonical-contract";
import { personImpliesCurrentRole, personRoleFromSpec } from "@/lib/search/person";
import { evaluateRoleCurrentness } from "@/lib/search/verification";

export type EmploymentRelationKind =
  | "employment"
  | "founder"
  | "partner"
  | "advisor"
  | "board";

export type EmploymentRelationship = {
  person_entity_id: string;
  organization_entity_id: string;
  organization_name: string | null;
  relationship: EmploymentRelationKind;
  role_raw: string;
  role_normalized: string;
  role_currentness: RoleCurrentness;
  role_observed_at: string;
  evidence: ClaimEvidence;
  confidence: number;
};

export type EmploymentDecision =
  | { ok: true; employment: EmploymentRelationship }
  | {
      ok: false;
      reject_code: QualificationRejectCode;
      reason: string;
    };

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

const ORG_ID_RE = /^(org|organization|company|business|investor):/i;

export function isOrganizationEntityId(id: string | null | undefined): boolean {
  return !!id && ORG_ID_RE.test(id.trim());
}

export function isPersonEntityId(id: string | null | undefined): boolean {
  return !!id && /^person:/i.test(id.trim());
}

/**
 * Build an employment relationship only from explicit binding evidence.
 * Requires:
 *   - evidence.subject === person_entity_id
 *   - claim_parameters.organization_entity_id (stable org id)
 *   - role / relationship markers
 *
 * Mere co-occurrence of names yields EMPLOYMENT_UNPROVEN.
 */
export function employmentFromEvidence(args: {
  person_entity_id: string;
  evidence: Evidence | ClaimEvidence;
  organization_name?: string | null;
}): EmploymentDecision {
  const { person_entity_id, evidence } = args;
  const claim = asClaimEvidence(evidence, person_entity_id);
  if (!claim) {
    return {
      ok: false,
      reject_code: "CLAIM_NOT_SUBJECT_BOUND",
      reason: "employment evidence not subject-bound to person",
    };
  }
  if (claim.subject !== person_entity_id.trim()) {
    return {
      ok: false,
      reject_code: "CLAIM_NOT_SUBJECT_BOUND",
      reason: "employment evidence subject ≠ person entity_id",
    };
  }

  const params = claim.claim_parameters ?? {};
  const orgId =
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
        "person and organization co-mention is not an employment relationship — missing organization_entity_id on claim",
    };
  }
  if (isProvisionalEntityId(orgId) || !isStableEntityId(orgId)) {
    return {
      ok: false,
      reject_code: "ASSOCIATED_COMPANY_UNRESOLVED",
      reason: "associated organization entity_id is provisional/unresolved",
    };
  }
  if (!isOrganizationEntityId(orgId) && !orgId.startsWith("company:")) {
    // Allow org:/organization:/company:/business:/investor:
    if (!ORG_ID_RE.test(orgId)) {
      return {
        ok: false,
        reject_code: "EMPLOYMENT_UNPROVEN",
        reason: `organization_entity_id ${orgId} is not an organization identity`,
      };
    }
  }

  const roleRaw =
    (typeof params.role === "string" && params.role.trim()) ||
    (typeof params.title === "string" && params.title.trim()) ||
    claim.claim ||
    "";
  if (!roleRaw.trim()) {
    return {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason: "employment evidence missing role/title",
    };
  }

  const relRaw = String(params.relationship ?? params.relation ?? "").toLowerCase();
  let relationship: EmploymentRelationKind = "employment";
  if (relRaw === "founder" || /\bfounder\b/i.test(roleRaw)) relationship = "founder";
  else if (relRaw === "partner" || /\bpartner\b/i.test(roleRaw)) relationship = "partner";
  else if (relRaw === "advisor") relationship = "advisor";
  else if (relRaw === "board") relationship = "board";

  const stamped = params.role_currentness;
  const role_currentness: RoleCurrentness =
    stamped === "current_role" ||
    stamped === "former_role" ||
    stamped === "historical_role" ||
    stamped === "unknown"
      ? stamped
      : "unknown";

  const orgName =
    args.organization_name?.trim() ||
    (typeof params.organization_name === "string"
      ? params.organization_name
      : null) ||
    (typeof params.company === "string" ? params.company : null);

  return {
    ok: true,
    employment: {
      person_entity_id: person_entity_id.trim(),
      organization_entity_id: orgId,
      organization_name: orgName,
      relationship,
      role_raw: roleRaw.trim(),
      role_normalized: normalizeRole(roleRaw),
      role_currentness,
      role_observed_at: claim.observed_at,
      evidence: claim,
      confidence: claim.confidence,
    },
  };
}

/**
 * Person Spec gate: role hunts require an evidence-backed employment/
 * founder relationship — not page co-mention.
 */
export function requireEmploymentForPersonSpec(args: {
  spec: SearchSpec;
  person_entity_id: string;
  evidence: Array<Evidence | ClaimEvidence>;
  organization_name?: string | null;
}): EmploymentDecision {
  const { spec, person_entity_id, evidence } = args;
  if (spec.entity !== "person") {
    return {
      ok: false,
      reject_code: "ENTITY_TYPE_MISMATCH",
      reason: "employment gate only applies to person Specs",
    };
  }

  const role = personRoleFromSpec(spec);
  // Role-less person browse (rare) — still no invented employment.
  if (!role.normalized && !spec.signal_required) {
    return {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason: "person Spec without role still needs explicit employment evidence to associate a company",
    };
  }

  let lastFail: EmploymentDecision | null = null;
  for (const ev of evidence) {
    const built = employmentFromEvidence({
      person_entity_id,
      evidence: ev,
      organization_name: args.organization_name,
    });
    if (!built.ok) {
      lastFail = built;
      continue;
    }

    // Role alignment when Spec states a role (open ontology).
    if (role.normalized) {
      const empRole = built.employment.role_normalized;
      const ok =
        empRole === role.normalized ||
        empRole.includes(role.normalized) ||
        role.normalized.includes(empRole) ||
        // founder Spec satisfied by founder relationship kind
        (role.normalized === "founder" &&
          built.employment.relationship === "founder");
      if (!ok) {
        lastFail = {
          ok: false,
          reject_code: "CLAIM_PARAMETER_MISMATCH",
          reason: `employment role "${empRole}" does not match Spec role "${role.normalized}"`,
        };
        continue;
      }
    }

    // Currentness when implied by the person Spec.
    if (personImpliesCurrentRole(spec)) {
      const stamped = {
        ...built.employment.evidence,
        claim_parameters: {
          ...(built.employment.evidence.claim_parameters ?? {}),
          role_currentness: built.employment.role_currentness,
        },
      };
      const cur = evaluateRoleCurrentness(stamped, {
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
      });
      if (!cur.ok) {
        return {
          ok: false,
          reject_code: "CURRENTNESS_MISMATCH",
          reason: cur.reason,
        };
      }
    }

    // When Spec binds location via company context, org must be resolved
    // (already enforced in employmentFromEvidence). Extra: if Spec names a
    // company explicitly, ids must agree when present.
    const specCompany = fieldOf(spec, "associated_company");
    if (
      specCompany &&
      built.employment.organization_name &&
      !built.employment.organization_name
        .toLowerCase()
        .includes(specCompany.toLowerCase()) &&
      !specCompany
        .toLowerCase()
        .includes(built.employment.organization_name.toLowerCase())
    ) {
      lastFail = {
        ok: false,
        reject_code: "CLAIM_PARAMETER_MISMATCH",
        reason: "employment organization does not match Spec associated_company",
      };
      continue;
    }

    return built;
  }

  return (
    lastFail ?? {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason: "no evidence-backed person↔organization relationship",
    }
  );
}

/**
 * Need/signal claims must bind to the same person as identity — never to
 * unrelated hiring/funding evidence about another subject or org-only page.
 */
export function needClaimBoundToPerson(args: {
  person_entity_id: string;
  needEvidence: Array<Evidence | ClaimEvidence>;
}): { ok: true } | { ok: false; reject_code: QualificationRejectCode; reason: string } {
  if (!args.needEvidence.length) {
    return {
      ok: false,
      reject_code: "NO_CLAIM_EVIDENCE",
      reason: "need/signal Spec has no claim evidence",
    };
  }
  for (const ev of args.needEvidence) {
    const claim = asClaimEvidence(ev, args.person_entity_id);
    if (!claim || claim.subject !== args.person_entity_id.trim()) {
      return {
        ok: false,
        reject_code: "CLAIM_NOT_SUBJECT_BOUND",
        reason:
          "need/signal evidence is not subject-bound to the resolved person (founder evidence ≠ unrelated developer claim)",
      };
    }
  }
  return { ok: true };
}
