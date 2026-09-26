/**
 * M13 — Job posting contract (first-class entity).
 *
 * entity_type = job. A job board / list page is a SOURCE, never the employer.
 * Salary stays query-aware (required only when Spec demands it).
 * Posting currentness: active | expired | stale | unknown.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { JobCurrentness } from "@/lib/search/verification";
import type { ClaimEvidence } from "@/lib/search/claim-binding";
import type { FieldProvenance } from "@/lib/search/enrichment-merge";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import { normalizeRole } from "@/lib/search/search-spec-extract";

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

/** Frozen Job fields for a QualifiedLead&lt;Job&gt;. */
export type JobLeadFields = {
  entity_id: string;
  entity_type: "job";
  title: string;
  role_raw: string | null;
  role_normalized: string | null;
  seniority: string | null;
  employment_type: string | null;
  employer_name: string | null;
  employer_entity_id: string | null;
  location: string | null;
  remote: boolean;
  apply_url: string | null;
  salary: string | number | null;
  job_currentness: JobCurrentness;
  identity_confidence: number;
  identity_evidence: ClaimEvidence[];
  claim_evidence: ClaimEvidence[];
  field_provenance: Record<string, FieldProvenance>;
};

/**
 * Job Specs imply *active* postings unless the query asks for expired/closed/
 * filled/archived roles.
 */
export function jobImpliesActivePosting(spec: SearchSpec): boolean {
  if (spec.entity !== "job") return false;
  const stamped = fieldOf(spec, "job_currentness");
  if (stamped === "active") return true;
  if (stamped === "expired" || stamped === "stale") return false;
  const q = spec.raw_query ?? "";
  if (
    /\b(expired|closed|filled|archived|inactive|past)\b/i.test(q) ||
    /\bno\s+longer\s+(open|accepting)\b/i.test(q)
  ) {
    return false;
  }
  return true;
}

export function jobRoleFromSpec(spec: SearchSpec): {
  raw: string | null;
  normalized: string | null;
} {
  const raw = fieldOf(spec, "role") ?? fieldOf(spec, "requested_role");
  if (!raw) return { raw: null, normalized: null };
  return { raw, normalized: normalizeRole(raw) };
}

/**
 * Employer must be an evidence-backed org identity — a Monster/Indeed SERP
 * title ("Acme - Marketing Jobs") is not the employer.
 */
export type EmployerBinding = {
  job_entity_id: string;
  employer_entity_id: string;
  employer_name: string | null;
  evidence: ClaimEvidence;
  confidence: number;
};

export type JobIdentitySeed = {
  title: string;
  entity_id?: string | null;
  apply_url?: string | null;
  employer?: string | null;
  employer_entity_id?: string | null;
  location?: string | null;
};

export type JobIdentityDecision =
  | {
      status: "resolved";
      entity_id: string;
      confidence: number;
      method: string;
      seed: JobIdentitySeed;
    }
  | {
      status: "ambiguous" | "unresolved";
      reject_code: Extract<
        QualificationRejectCode,
        "IDENTITY_AMBIGUOUS" | "ENTITY_UNRESOLVED" | "PROVISIONAL_ENTITY"
      >;
      reason: string;
      candidates: JobIdentitySeed[];
    };

/**
 * Fail closed when two postings share a title without apply_url / employer
 * corroboration — "Marketing Manager" alone cannot pick Acme vs Beta.
 */
export function resolveJobIdentity(seeds: JobIdentitySeed[]): JobIdentityDecision {
  const usable = seeds.filter((s) => s.title?.trim());
  if (!usable.length) {
    return {
      status: "unresolved",
      reject_code: "ENTITY_UNRESOLVED",
      reason: "no job identity seeds",
      candidates: [],
    };
  }

  if (usable.length === 1) {
    const s = usable[0]!;
    const id = s.entity_id?.trim();
    if (id && !id.startsWith("provisional:")) {
      return {
        status: "resolved",
        entity_id: id,
        confidence: s.apply_url || s.employer_entity_id ? 0.9 : 0.75,
        method: "single_seed",
        seed: s,
      };
    }
    if (id?.startsWith("provisional:")) {
      return {
        status: "unresolved",
        reject_code: "PROVISIONAL_ENTITY",
        reason: "provisional job id cannot qualify",
        candidates: usable,
      };
    }
    return {
      status: "unresolved",
      reject_code: "ENTITY_UNRESOLVED",
      reason: "job title without stable entity_id",
      candidates: usable,
    };
  }

  const withApply = usable.filter((s) => s.apply_url?.trim());
  const uniqueApply = new Set(
    withApply.map((s) => s.apply_url!.trim().toLowerCase()),
  );
  if (uniqueApply.size === 1 && withApply[0]?.entity_id) {
    const s = withApply[0]!;
    if (!s.entity_id!.startsWith("provisional:")) {
      return {
        status: "resolved",
        entity_id: s.entity_id!,
        confidence: 0.92,
        method: "shared_apply_url",
        seed: s,
      };
    }
  }

  const employerKeys = new Set(
    usable.map(
      (s) =>
        (s.employer_entity_id ?? "").trim().toLowerCase() ||
        (s.employer ?? "").trim().toLowerCase(),
    ),
  );
  if (employerKeys.size > 1) {
    return {
      status: "ambiguous",
      reject_code: "IDENTITY_AMBIGUOUS",
      reason:
        "same job title at different employers without apply_url corroboration",
      candidates: usable,
    };
  }

  return {
    status: "ambiguous",
    reject_code: "IDENTITY_AMBIGUOUS",
    reason: "same job title — insufficient corroborating attributes",
    candidates: usable,
  };
}
