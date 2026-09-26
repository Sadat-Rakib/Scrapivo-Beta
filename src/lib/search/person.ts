/**
 * M12 — Person contract (generalized people).
 *
 * entity_type = person; role is open (normalizeRole), not a finite occupation enum.
 * Contacts stay required_when_available unless Spec promotes them.
 * Social author resolution belongs to M14 — not here.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import { normalizeRole } from "@/lib/search/search-spec-extract";
import type { RoleCurrentness } from "@/lib/search/claim-binding";
import type { ClaimEvidence } from "@/lib/search/claim-binding";
import type { FieldProvenance } from "@/lib/search/enrichment-merge";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import type { EmploymentRelationship } from "@/lib/search/person-employment";

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

/**
 * Frozen Person fields for a QualifiedLead&lt;Person&gt;.
 * Presence of contacts is Spec-gated; identity/role/currentness are structural.
 */
export type PersonLeadFields = {
  entity_id: string;
  entity_type: "person";
  name: string;
  role_raw: string | null;
  role_normalized: string | null;
  role_currentness: RoleCurrentness;
  associated_company: string | null;
  associated_company_entity_id: string | null;
  location: string | null;
  identity_confidence: number;
  email: string | null;
  phone: string | null;
  profile_urls: string[];
  employment: EmploymentRelationship | null;
  identity_evidence: ClaimEvidence[];
  claim_evidence: ClaimEvidence[];
  field_provenance: Record<string, FieldProvenance>;
};

/**
 * Person Specs that ask for a role imply *current* holders unless the query
 * explicitly asks for former/ex/past/historical.
 */
export function personImpliesCurrentRole(spec: SearchSpec): boolean {
  if (spec.entity !== "person") return false;
  const role = fieldOf(spec, "role");
  if (!role) return false;

  const stamped = fieldOf(spec, "role_currentness");
  if (stamped === "current_role") return true;
  if (stamped === "former_role" || stamped === "historical_role") return false;
  if (stamped === "unknown") return false;

  const q = spec.raw_query ?? "";
  if (
    /\b(former|ex-|ex\s+|past|previous|retired|historical)\b/i.test(q) ||
    /\bused\s+to\s+be\b/i.test(q) ||
    /\bno\s+longer\b/i.test(q)
  ) {
    return false;
  }
  // Bare role hunt ("founders of …", "CTOs at …") implies current holders.
  return true;
}

/** Normalize Spec role through the open ontology. */
export function personRoleFromSpec(spec: SearchSpec): {
  raw: string | null;
  normalized: string | null;
} {
  const raw = fieldOf(spec, "role");
  if (!raw) return { raw: null, normalized: null };
  return { raw, normalized: normalizeRole(raw) };
}

/**
 * When true, a person lead must carry an evidence-backed employment/
 * founder relationship (not page co-mention).
 */
export function personSpecRequiresEmployment(spec: SearchSpec): boolean {
  if (spec.entity !== "person") return false;
  if (fieldOf(spec, "associated_company")) return true;
  const role = personRoleFromSpec(spec).normalized;
  if (role && /^(founder|ceo|cto|cfo|owner|partner|co-founder)$/.test(role)) {
    return true;
  }
  const q = spec.raw_query ?? "";
  if (
    /\b(?:at|of|@)\s+/i.test(q) &&
    /\b(compan(?:y|ies)|startups?|firms?|agenc(?:y|ies)|org(?:anization|anisation)?s?)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Corroborating attributes for people identity — name alone is never enough
 * when multiple candidates share it.
 */
export type PersonIdentitySeed = {
  name: string;
  entity_id?: string | null;
  profile_url?: string | null;
  company?: string | null;
  company_entity_id?: string | null;
  location?: string | null;
  role?: string | null;
  domain?: string | null;
};

export type PersonIdentityDecision =
  | {
      status: "resolved";
      entity_id: string;
      confidence: number;
      method: string;
      seed: PersonIdentitySeed;
    }
  | {
      status: "ambiguous" | "unresolved";
      reject_code: Extract<
        QualificationRejectCode,
        "IDENTITY_AMBIGUOUS" | "ENTITY_UNRESOLVED" | "PROVISIONAL_ENTITY"
      >;
      reason: string;
      candidates: PersonIdentitySeed[];
    };

function normName(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Fail closed when two people share a name without corroborating attributes.
 * A result that only says "John Smith — Founder" cannot pick Acme vs Beta.
 */
export function resolvePersonIdentity(
  seeds: PersonIdentitySeed[],
): PersonIdentityDecision {
  const usable = seeds.filter((s) => s.name?.trim());
  if (!usable.length) {
    return {
      status: "unresolved",
      reject_code: "ENTITY_UNRESOLVED",
      reason: "no person identity seeds",
      candidates: [],
    };
  }

  // Group by normalized name
  const byName = new Map<string, PersonIdentitySeed[]>();
  for (const s of usable) {
    const k = normName(s.name);
    const list = byName.get(k) ?? [];
    list.push(s);
    byName.set(k, list);
  }

  if (byName.size > 1 && usable.length > 1) {
    // Multiple distinct names — caller should resolve one subject; fail closed.
    return {
      status: "ambiguous",
      reject_code: "IDENTITY_AMBIGUOUS",
      reason: "multiple distinct person names without a single subject selection",
      candidates: usable,
    };
  }

  const group = [...byName.values()][0]!;
  if (group.length === 1) {
    const s = group[0]!;
    const id = s.entity_id?.trim();
    if (id && !id.startsWith("provisional:")) {
      return {
        status: "resolved",
        entity_id: id,
        confidence: s.profile_url || s.company_entity_id ? 0.9 : 0.75,
        method: "single_seed",
        seed: s,
      };
    }
    // Single unnamed seed still needs a stable id from upstream resolution.
    if (id?.startsWith("provisional:")) {
      return {
        status: "unresolved",
        reject_code: "PROVISIONAL_ENTITY",
        reason: "provisional person id cannot qualify",
        candidates: group,
      };
    }
    return {
      status: "unresolved",
      reject_code: "ENTITY_UNRESOLVED",
      reason: "person name without stable entity_id",
      candidates: group,
    };
  }

  // Same display name, multiple seeds — require corroboration that collapses to one.
  const withProfile = group.filter((s) => s.profile_url?.trim());
  const uniqueProfiles = new Set(
    withProfile.map((s) => s.profile_url!.trim().toLowerCase()),
  );
  if (uniqueProfiles.size === 1 && withProfile[0]?.entity_id) {
    const s = withProfile[0]!;
    if (!s.entity_id!.startsWith("provisional:")) {
      return {
        status: "resolved",
        entity_id: s.entity_id!,
        confidence: 0.92,
        method: "shared_profile_url",
        seed: s,
      };
    }
  }

  const withCompany = group.filter(
    (s) => s.company_entity_id?.trim() || s.company?.trim(),
  );
  const companyKeys = new Set(
    withCompany.map(
      (s) =>
        (s.company_entity_id ?? "").trim().toLowerCase() ||
        (s.company ?? "").trim().toLowerCase(),
    ),
  );
  if (companyKeys.size === 1 && withCompany.length === group.length) {
    // All agree on the same company — still need a stable person id.
    const ids = new Set(
      withCompany
        .map((s) => s.entity_id?.trim())
        .filter((id): id is string => !!id && !id.startsWith("provisional:")),
    );
    if (ids.size === 1) {
      const s = withCompany.find((x) => x.entity_id && ids.has(x.entity_id))!;
      return {
        status: "resolved",
        entity_id: s.entity_id!,
        confidence: 0.85,
        method: "name_plus_company_agreement",
        seed: s,
      };
    }
  }

  if (companyKeys.size > 1) {
    return {
      status: "ambiguous",
      reject_code: "IDENTITY_AMBIGUOUS",
      reason:
        "same display name at different companies without profile corroboration",
      candidates: group,
    };
  }

  return {
    status: "ambiguous",
    reject_code: "IDENTITY_AMBIGUOUS",
    reason: "same display name — insufficient corroborating attributes",
    candidates: group,
  };
}
