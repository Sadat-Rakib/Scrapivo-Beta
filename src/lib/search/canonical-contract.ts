/**
 * Canonical QualifiedLead constitution — Milestone 1 spine.
 *
 * Source of truth: reports/universal-audit/11-canonical-contract.md
 *
 * Hard law: prefer 0 correct QualifiedLeads over N false/incomplete.
 * Search success ≠ lead success.
 *
 * Do not invent a fifth lead shape here — converge SpecRow toward this.
 */
import type { SearchSpec, SpecEntity } from "@/lib/search/search-spec";
import type { Evidence } from "@/lib/search/evidence";
import { locationSatisfies, resolveCanonicalLocation } from "@/lib/search/location-resolver";
import { verifyCandidateClaims } from "@/lib/search/verification";
import {
  QUALIFYING_CLAIM_TYPES,
  asClaimEvidence,
  evidenceClaimType,
  evidenceSubject,
  isClaimAligned,
  isSubjectBound,
  requestedClaimTypes,
  type ClaimEvidence,
  type RoleCurrentness,
} from "@/lib/search/claim-binding";

export {
  QUALIFYING_CLAIM_TYPES,
  asClaimEvidence,
  evidenceClaimType,
  evidenceSubject,
  isClaimAligned,
  isSubjectBound,
  requestedClaimTypes,
  type ClaimEvidence,
  type RoleCurrentness,
};

/** Field tier semantics (query-aware completeness). */
export type FieldTier = "required_for_qualification" | "required_when_available" | "optional";

export type PageType =
  | "entity_page"
  | "person_page"
  | "company_page"
  | "job_posting"
  | "list"
  | "directory"
  | "aggregator"
  | "job_board"
  | "article"
  | "institute"
  | "social_post"
  | "unknown";

export type EntityResolutionStatus = "provisional" | "resolved" | "unresolved";

/** Typed search outcomes — never collapse to bare “0 results” internally. */
export type SearchOutcomeCode =
  | "QUALIFIED_RESULTS"
  | "NO_QUALIFIED_RESULTS"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_ERROR"
  | "UNSUPPORTED_CAPABILITY"
  | "SEARCH_CANCELLED"
  | "SEARCH_FAILED";

/**
 * Final outcome precedence when multiple routes contribute.
 * Provider failures stay in diagnostics and do not override a completed
 * supported search that established no QualifiedLead.
 * QUALIFIED_RESULTS wins only when no higher failure/cancel code is present
 * (it is the success terminal — not listed in OUTCOME_PRECEDENCE).
 */
export const OUTCOME_PRECEDENCE: SearchOutcomeCode[] = [
  "SEARCH_CANCELLED",
  "SEARCH_FAILED",
  "UNSUPPORTED_CAPABILITY",
  "NO_QUALIFIED_RESULTS",
];

/** Codes that are diagnostics, not overall result when another route completed. */
export const DIAGNOSTIC_OUTCOME_CODES = new Set<SearchOutcomeCode>([
  "SOURCE_UNAVAILABLE",
  "SOURCE_ERROR",
]);

export type QualificationRejectCode =
  | "PROVISIONAL_ENTITY"
  | "ENTITY_UNRESOLVED"
  | "ENTITY_TYPE_MISMATCH"
  | "LIST_PAGE_AS_ENTITY"
  | "MISSING_IDENTITY"
  | "MISSING_QUERY_REQUIRED"
  | "SALARY_BELOW_THRESHOLD"
  | "LOCATION_MISMATCH"
  | "CLAIM_TYPE_MISMATCH"
  | "CLAIM_PARAMETER_MISMATCH"
  | "CLAIM_NOT_SUBJECT_BOUND"
  | "NO_CLAIM_EVIDENCE"
  | "TEMPORAL_STALE"
  | "TEMPORAL_UNKNOWN"
  | "PROVENANCE_INCOMPLETE"
  | "CURRENTNESS_MISMATCH"
  | "EMPLOYMENT_UNPROVEN"
  | "IDENTITY_AMBIGUOUS"
  | "ASSOCIATED_COMPANY_UNRESOLVED"
  | "SOURCE_IS_LEAD";

export interface TheoremCandidate {
  /** Stable canonical id — provisional ids cannot qualify. */
  entity_id: string | null | undefined;
  entity_resolution?: EntityResolutionStatus | null;
  /** True only after hard entity-resolution gate. */
  entity_resolved?: boolean | null;
  entity_type: Exclude<SpecEntity, "unknown"> | string;
  name: string | null | undefined;
  source?: string | null;
  source_url?: string | null;
  identity_confidence?: number | null;
  page_type?: PageType | null;
  /** Optional salary etc. for query-required checks. */
  fields?: Record<string, string | number | boolean | null | undefined>;
  /** Field-level provenance when the caller carries it (verified contact gate).
   *  Loosely typed: producers stamp richer FieldProvenance shapes. */
  field_provenance?: Record<string, unknown> | null;
  evidence?: Evidence[] | ClaimEvidence[] | null;
}

export interface TheoremResult {
  ok: boolean;
  reject_code?: QualificationRejectCode;
  reason?: string;
  missing_query_required?: string[];
}

const PROVISIONAL_PREFIX = "provisional:";

const LIST_LIKE_PAGES = new Set<PageType>([
  "list",
  "directory",
  "aggregator",
  "job_board",
  "article",
  "institute",
]);

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

export function isProvisionalEntityId(id: string | null | undefined): boolean {
  if (!id?.trim()) return true;
  return id.trim().toLowerCase().startsWith(PROVISIONAL_PREFIX);
}

export function isStableEntityId(id: string | null | undefined): boolean {
  return !!id?.trim() && !isProvisionalEntityId(id);
}

/**
 * Query-required field names derived from Spec (not a static bag per entity).
 */
export function queryRequiredFields(spec: SearchSpec): string[] {
  const req: string[] = ["entity_id", "entity_type", "name"];
  const requested = new Set(spec.requested_fields?.map((field) => field.toLowerCase()) ?? []);
  const legacyText = !spec.understanding;
  if (fieldOf(spec, "location")) req.push("location");
  // Spec.role is a retrieval filter, not a QualifiedLead column.
  if (spec.entity === "job") {
    req.push("title", "employer", "apply_or_source_url");
  }
  if (
    fieldOf(spec, "salary_min") ||
    fieldOf(spec, "salary") ||
    (legacyText && /\b(paying|salary|\$\s*\d)/i.test(spec.raw_query))
  ) {
    req.push("salary");
  }
  if (
    (legacyText &&
      /\b(?:(?:with|require(?:s|d)?|must have)\s+(?:(?:emails?|email addresses?)\s+(?:and|or)\s+)?phone(?: numbers?)?|phone(?: numbers?)?\s+required)\b/i.test(
        spec.raw_query,
      )) ||
    fieldOf(spec, "require_phone") === "true" ||
    requested.has("phone")
  ) {
    req.push("phone");
  }
  if (
    (legacyText &&
      /\b(with emails?|email addresses?|emails?\s+required|require(?:s|d)?\s+email)\b/i.test(
        spec.raw_query,
      )) ||
    fieldOf(spec, "require_email") === "true" ||
    requested.has("email")
  ) {
    req.push("email");
  }
  if (requested.has("website") || fieldOf(spec, "require_website") === "true") req.push("website");
  // Any public contact channel (email, phone, or first-party contact page).
  if (requested.has("contact") || fieldOf(spec, "require_contact") === "true") req.push("contact");
  if (
    requested.has("socials") ||
    requested.has("social") ||
    fieldOf(spec, "require_socials") === "true"
  )
    req.push("socials");
  if (spec.signal_required) {
    req.push("claim_evidence");
  }
  return [...new Set(req)];
}

/**
 * Query-aware field tiers for enrichment planning (M8).
 * - required_for_qualification: missing → cannot qualify
 * - required_when_available: attempt enrichment; absence alone does not reject
 * - optional: do not spend budget unless free/already known
 */
export function fieldTiersFor(spec: SearchSpec): Record<string, FieldTier> {
  const blocking = new Set(queryRequiredFields(spec));
  const tiers: Record<string, FieldTier> = {};

  for (const f of blocking) {
    tiers[f] = "required_for_qualification";
  }

  // Contact / site: attempt when configured, never invent, never block unless Spec says so.
  for (const f of ["email", "phone", "url"] as const) {
    if (!tiers[f]) tiers[f] = "required_when_available";
  }

  if (spec.entity === "person") {
    if (!tiers["role"]) tiers["role"] = "required_when_available";
    if (!tiers["associated_company"]) tiers["associated_company"] = "required_when_available";
  }

  if (spec.entity === "job" && !tiers["salary"]) {
    tiers["salary"] = "optional";
  }

  // no_website: do NOT chase a website onto the business — verify absence instead.
  if (fieldOf(spec, "opportunity") === "no_website") {
    tiers["url"] = "optional";
    tiers["website"] = "optional";
    tiers["no_website"] = "required_for_qualification";
  }

  return tiers;
}

/**
 * `required_when_available` becomes blocking only when Spec makes the field
 * necessary (same as query-required). Missing alone never fails.
 */
export function isQualificationBlockingField(spec: SearchSpec, field: string): boolean {
  return queryRequiredFields(spec).includes(field);
}

/** Parse a salary-ish value to a comparable annual number, or null. */
export function parseSalaryAmount(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Heuristic: bare 150 means 150k when Spec stores thousands compactly.
    return raw > 0 && raw < 1000 ? raw * 1000 : raw;
  }
  const s = String(raw).trim().toLowerCase().replace(/,/g, "");
  const withK = /(\d+(?:\.\d+)?)\s*k\b/.exec(s);
  if (withK) {
    const n = Number(withK[1]);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Resolve overall typed outcome from a set of route outcomes. */
export function resolveFinalOutcome(
  outcomes: Array<SearchOutcomeCode | null | undefined>,
): SearchOutcomeCode {
  const present = outcomes.filter((o): o is SearchOutcomeCode => !!o);
  for (const code of OUTCOME_PRECEDENCE) {
    if (present.includes(code)) return code;
  }
  if (present.includes("QUALIFIED_RESULTS")) return "QUALIFIED_RESULTS";
  if (present.includes("SOURCE_UNAVAILABLE")) return "SOURCE_UNAVAILABLE";
  if (present.includes("SOURCE_ERROR")) return "SOURCE_ERROR";
  return "NO_QUALIFIED_RESULTS";
}

/**
 * QualifiedLead theorem evaluator — fail closed.
 *
 * A candidate is not a lead because it was discovered.
 */
export function evaluateQualifiedLeadTheorem(
  candidate: TheoremCandidate,
  spec: SearchSpec,
): TheoremResult {
  const name = candidate.name?.trim();
  if (!name) {
    return { ok: false, reject_code: "MISSING_IDENTITY", reason: "name required" };
  }

  const page = candidate.page_type ?? "unknown";
  if (LIST_LIKE_PAGES.has(page)) {
    return {
      ok: false,
      reject_code: "LIST_PAGE_AS_ENTITY",
      reason: `page_type=${page} is a source, not an entity lead`,
    };
  }

  const id = candidate.entity_id?.trim() ?? null;
  if (!isStableEntityId(id)) {
    return {
      ok: false,
      reject_code: "PROVISIONAL_ENTITY",
      reason: "provisional/unresolved entity_id cannot qualify or be delivered",
    };
  }

  const resolved = candidate.entity_resolved === true || candidate.entity_resolution === "resolved";
  if (!resolved) {
    return {
      ok: false,
      reject_code: "ENTITY_UNRESOLVED",
      reason: "entity_resolved hard gate not passed",
    };
  }

  // Low identity confidence cannot quietly qualify (M4).
  const conf = candidate.identity_confidence;
  if (typeof conf === "number" && conf < 0.7) {
    return {
      ok: false,
      reject_code: "ENTITY_UNRESOLVED",
      reason: `identity_confidence ${conf} below minimum 0.7`,
    };
  }

  if (
    spec.entity !== "unknown" &&
    candidate.entity_type &&
    candidate.entity_type !== spec.entity &&
    candidate.entity_resolved === true
  ) {
    return {
      ok: false,
      reject_code: "ENTITY_TYPE_MISMATCH",
      reason: `resolved type ${candidate.entity_type} ≠ spec ${spec.entity}`,
    };
  }

  const missing: string[] = [];
  const qFields = queryRequiredFields(spec);
  const f = candidate.fields ?? {};
  const socialObservation = (item: Evidence | ClaimEvidence): boolean => {
    if (
      ("source_type" in item && item.source_type === "social") ||
      ("evidence_source" in item &&
        /social|instagram|facebook|linkedin|tiktok|youtube/i.test(item.evidence_source ?? ""))
    )
      return true;
    if (
      !(
        "extraction_method" in item &&
        item.extraction_method === "browser_observed_text" &&
        item.evidence_type === "identity" &&
        !!candidate.name &&
        !!item.excerpt?.toLowerCase().includes(candidate.name.toLowerCase())
      )
    )
      return false;
    try {
      return /(?:^|\.)(?:instagram|facebook|linkedin|tiktok|youtube|twitter|x)\.com$/i.test(
        new URL(item.source_url).hostname,
      );
    } catch {
      return false;
    }
  };
  const observedField = (field: string): boolean => {
    const text = (value: unknown) => typeof value === "string" && !!value.trim();
    if (field === "website") return text(f.website_url);
    if (field === "contact")
      return (
        text(f.email) ||
        text(f.phone) ||
        (text(f.contact_page_url) &&
          (candidate.field_provenance?.contact_page_url as Record<string, unknown> | undefined)
            ?.verification_status === "verified") ||
        !!candidate.evidence?.some(
          (item) =>
            isSubjectBound(item, id!) &&
            "evidence_type" in item &&
            item.evidence_type === "contact" &&
            !!item.source_url,
        )
      );
    if (field === "socials" || field === "social")
      return !!candidate.evidence?.some(
        (item) =>
          isSubjectBound(item, id!) &&
          socialObservation(item) &&
          !!("source_url" in item ? item.source_url : item.evidence_url),
      );
    if (["instagram", "facebook", "linkedin", "tiktok", "youtube", "twitter"].includes(field)) {
      const hostMatches = (url: unknown) => {
        if (!text(url)) return false;
        try {
          const host = new URL(String(url)).hostname.toLowerCase();
          return (
            host === `${field}.com` ||
            host.endsWith(`.${field}.com`) ||
            (field === "twitter" && host === "x.com")
          );
        } catch {
          return false;
        }
      };
      const verifiedField = (name: string) =>
        hostMatches(f[name]) &&
        (candidate.field_provenance?.[name] as Record<string, unknown> | undefined)
          ?.verification_status === "verified";
      return (
        verifiedField(`${field}_url`) ||
        verifiedField(field) ||
        !!candidate.evidence?.some(
          (item) =>
            isSubjectBound(item, id!) &&
            socialObservation(item) &&
            hostMatches("source_url" in item ? item.source_url : item.evidence_url),
        )
      );
    }
    return text(f[field]);
  };

  if (qFields.includes("location")) {
    const loc = f.location ?? null;
    if (typeof loc !== "string" || !loc.trim()) {
      missing.push("location");
    } else {
      // Spec location is a hard gate: Dallas cannot satisfy Austin even when
      // claim evidence matches. Prefer location_id when extract stamped one.
      const places = spec.locations?.length
        ? spec.locations
        : [fieldOf(spec, "location")].filter((place): place is string => !!place);
      const matches = places.some((place) => {
        const required = resolveCanonicalLocation(place) ?? place;
        const countryCode =
          typeof f.country === "string"
            ? (resolveCanonicalLocation(f.country)?.country_code ?? f.country)
            : null;
        const countryMatches =
          typeof required === "object" &&
          required.kind === "country" &&
          !!countryCode &&
          !!required.country_code &&
          countryCode.toUpperCase() === required.country_code.toUpperCase();
        return countryMatches || locationSatisfies(String(loc), required);
      });
      if (places.length && !matches) {
        return {
          ok: false,
          reject_code: "LOCATION_MISMATCH",
          reason: `candidate location "${loc}" does not satisfy Spec location`,
        };
      }
    }
  }
  if (qFields.includes("salary")) {
    const salRaw = f.salary ?? f.salary_min ?? null;
    const sal = parseSalaryAmount(salRaw as string | number | null);
    if (sal == null) {
      missing.push("salary");
    } else {
      const min = parseSalaryAmount(fieldOf(spec, "salary_min"));
      if (min != null && sal < min) {
        return {
          ok: false,
          reject_code: "SALARY_BELOW_THRESHOLD",
          reason: `salary ${sal} below Spec salary_min ${min}`,
        };
      }
    }
  }
  for (const field of ["phone", "email", "website", "contact", "socials"])
    if (qFields.includes(field) && !observedField(field)) missing.push(field);
  for (const group of spec.required_field_groups ?? [])
    if (!group.any_of.some(observedField)) missing.push(`any_of(${group.any_of.join("|")})`);
  if (spec.entity === "job") {
    if (!candidate.source_url?.trim() && !f.apply_url) missing.push("apply_or_source_url");
    if (!f.employer && !f.company) missing.push("employer");
  }

  if (missing.length) {
    return {
      ok: false,
      reject_code: "MISSING_QUERY_REQUIRED",
      reason: `missing query-required: ${missing.join(", ")}`,
      missing_query_required: missing,
    };
  }

  if (!spec.signal_required) {
    return { ok: true };
  }

  const requested = requestedClaimTypes(spec);
  const evidence = candidate.evidence ?? [];
  if (!evidence.length) {
    return {
      ok: false,
      reject_code: "NO_CLAIM_EVIDENCE",
      reason: "signal_required but no evidence",
    };
  }

  if (!requested.length) {
    return {
      ok: false,
      reject_code: "NO_CLAIM_EVIDENCE",
      reason: "signal_required but Spec has no requested claim types",
    };
  }

  // M9: subject binding + claim type/params + temporal + provenance + currentness.
  // observed_at is never a substitute for event_at.
  const verified = verifyCandidateClaims({
    evidence,
    entityId: id!,
    spec,
  });
  if (!verified.ok) {
    return {
      ok: false,
      reject_code: (verified.reject_code ?? "NO_CLAIM_EVIDENCE") as QualificationRejectCode,
      reason: verified.reason ?? "claim verification failed",
    };
  }

  return { ok: true };
}

/** Prefix for minting provisional ids on intermediate candidates only. */
export function mintProvisionalEntityId(seed: string): string {
  return `${PROVISIONAL_PREFIX}${seed}`;
}
