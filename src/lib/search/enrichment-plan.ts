/**
 * M8 — Query-aware enrichment planning.
 *
 * Enrichment is determined by SearchSpec + field tiers, happens before
 * qualification when required, and never fabricates missing data.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { EvidenceType } from "@/lib/search/evidence";
import {
  fieldTiersFor,
  queryRequiredFields,
  type FieldTier,
} from "@/lib/search/canonical-contract";

export type EnrichmentProviderId =
  | "candidate-existing"
  | "contact-harvest"
  | "salary-extract"
  | "no-website-verify"
  | "registry-identity"
  | "paid-enrichment";

export type EnrichmentCapability = {
  id: EnrichmentProviderId;
  fields: string[];
  /** Claim types this provider may emit (never substitutes other claims). */
  claims: EvidenceType[];
  costTier: 0 | 1 | 2 | 3 | 7;
  escalateOnly?: boolean;
};

export const ENRICHMENT_PROVIDER_CATALOG: readonly EnrichmentCapability[] = [
  {
    id: "candidate-existing",
    fields: ["*"],
    claims: [],
    costTier: 0,
  },
  {
    id: "no-website-verify",
    fields: ["no_website"],
    claims: ["no_website"],
    costTier: 1,
  },
  {
    id: "registry-identity",
    fields: ["url", "domain", "location", "associated_company"],
    claims: ["identity"],
    costTier: 1,
  },
  {
    id: "salary-extract",
    fields: ["salary"],
    claims: [],
    costTier: 1,
  },
  {
    id: "contact-harvest",
    fields: ["email", "phone", "url"],
    claims: [],
    costTier: 2,
  },
  {
    id: "paid-enrichment",
    fields: ["email", "phone", "url", "salary"],
    claims: [],
    costTier: 7,
    escalateOnly: true,
  },
];

export type EnrichmentRequirement = {
  field: string;
  tier: FieldTier;
  present: boolean;
  /** True when Spec forbids inventing this field (e.g. url under no_website). */
  forbidden: boolean;
};

export type EnrichmentRequirements = {
  entityId: string | null;
  entityType: string;
  requirements: EnrichmentRequirement[];
  /** Fields that must not be filled by enrichment. */
  forbidFields: string[];
  /** Claim types Spec needs — enrichment must not launder other claims into these. */
  requestedClaims: EvidenceType[];
  blockingMissing: string[];
  whenAvailableMissing: string[];
};

export type EnrichmentPlanStep = {
  providerId: EnrichmentProviderId;
  fields: string[];
  role: "primary" | "escalation";
  reason: string;
  costTier: 0 | 1 | 2 | 3 | 7;
};

export type EnrichmentPlan = {
  requirements: EnrichmentRequirements;
  steps: EnrichmentPlanStep[];
  skipped: { providerId: EnrichmentProviderId; reason: string }[];
};

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0 && v.trim() !== "?";
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  return false;
}

function candidateFieldValue(row: SpecRow, field: string): unknown {
  const r = row as SpecRow & {
    salary?: string | number | null;
    employer?: string | null;
    domain?: string | null;
    associated_company?: string | null;
    role?: string | null;
  };
  switch (field) {
    case "name":
    case "title":
      return r.title;
    case "email":
      return r.email;
    case "phone":
      return r.phone;
    case "url":
      return r.url;
    case "website":
      return r.website_url;
    case "apply_or_source_url":
      return r.apply_url ?? r.source_url;
    case "location":
      return r.location;
    case "salary":
      return r.salary;
    case "employer":
      return r.employer ?? (r.kind === "job" ? r.detail : null);
    case "entity_id":
      return r.entity_id;
    case "entity_type":
      return r.kind;
    case "claim_evidence":
      return (r.evidence?.length ?? 0) > 0 ? "yes" : null;
    case "no_website":
      // Only claim evidence establishes this — opportunity on the hunt is not proof.
      if (r.no_website_verification?.structured_absence &&
          r.no_website_verification.structured_source_url &&
          new Set(r.no_website_verification.exact_queries.map((q) => q.trim().toLowerCase()).filter(Boolean)).size >= 2 &&
          r.evidence?.some((e) => e.evidence_type === "no_website" &&
            e.subject === r.entity_id && ["osm_absence_plus_exact_web_check", "structured_absence_plus_exact_web_check"].includes(e.extraction_method ?? ""))) return "yes";
      return null;
    case "associated_company":
      return r.associated_company;
    case "role":
      return r.role;
    case "domain":
      return r.domain;
    default:
      return null;
  }
}

/**
 * What the Spec asks enrichment to attempt for this candidate.
 */
export function deriveEnrichmentRequirements(
  spec: SearchSpec,
  candidate: SpecRow,
): EnrichmentRequirements {
  const tiers = fieldTiersFor(spec);
  const opportunity = fieldOf(spec, "opportunity");
  const forbidFields: string[] = [];
  if (opportunity === "no_website") {
    forbidFields.push("url", "website");
  }

  const requestedClaims: EvidenceType[] = [];
  // Website absence is an explicit opportunity constraint even when the query
  // does not request a separate buying-intent signal.
  if (opportunity === "no_website") requestedClaims.push("no_website");
  if (spec.signal_required) {
    for (const t of spec.signal_types ?? []) {
      const n = t.toLowerCase();
      if (n === "hiring" || n === "job") requestedClaims.push("hiring");
      if (n === "funding" || n === "funded") requestedClaims.push("funding");
      if (n === "social_ask" || n === "social") requestedClaims.push("social_ask");
      if (n === "service_request" || n === "need") requestedClaims.push("service_request");
      if (n === "no_website") requestedClaims.push("no_website");
    }
  }

  const fieldsOfInterest = new Set([
    ...Object.keys(tiers),
    ...queryRequiredFields(spec),
  ]);

  const requirements: EnrichmentRequirement[] = [];
  const blockingMissing: string[] = [];
  const whenAvailableMissing: string[] = [];

  for (const field of fieldsOfInterest) {
    const tier = tiers[field] ?? "optional";
    const forbidden = forbidFields.includes(field);
    const present = !forbidden && hasValue(candidateFieldValue(candidate, field));
    requirements.push({ field, tier, present, forbidden });
    if (present || forbidden) continue;
    if (tier === "required_for_qualification") blockingMissing.push(field);
    else if (tier === "required_when_available") whenAvailableMissing.push(field);
  }

  return {
    entityId: candidate.entity_id?.trim() || null,
    entityType: candidate.kind,
    requirements,
    forbidFields,
    requestedClaims: [...new Set(requestedClaims)],
    blockingMissing,
    whenAvailableMissing,
  };
}

export type BuildEnrichmentPlanOptions = {
  providers?: readonly EnrichmentCapability[];
  budget?: {
    maxPaidCalls?: number;
    maxContactHarvest?: number;
    /** Hard cap on total provider steps after existing. */
    maxSteps?: number;
  };
  unavailable?: ReadonlySet<string> | readonly string[];
};

/**
 * Free-first enrichment plan: only schedule work for missing non-optional fields
 * that a configured provider can establish — never invent, never launder claims.
 */
export function buildEnrichmentPlan(
  spec: SearchSpec,
  candidate: SpecRow,
  opts?: BuildEnrichmentPlanOptions,
): EnrichmentPlan {
  const requirements = deriveEnrichmentRequirements(spec, candidate);
  const catalog = opts?.providers ?? ENRICHMENT_PROVIDER_CATALOG;
  const unavailable = new Set(
    opts?.unavailable
      ? Array.isArray(opts.unavailable)
        ? opts.unavailable
        : [...opts.unavailable]
      : [],
  );
  const budget = opts?.budget ?? {};
  const maxPaid = budget.maxPaidCalls ?? 0;
  const maxHarvest = budget.maxContactHarvest ?? 8;
  const maxSteps = budget.maxSteps ?? 6;

  const needed = requirements.requirements.filter(
    (r) => !r.present && !r.forbidden && r.tier !== "optional",
  );
  const neededFields = new Set(needed.map((r) => r.field));

  const skipped: EnrichmentPlan["skipped"] = [];
  const steps: EnrichmentPlanStep[] = [];

  if (!neededFields.size) {
    return { requirements, steps, skipped };
  }

  // Identity/claim_evidence are not "enriched" via contact APIs.
  neededFields.delete("entity_id");
  neededFields.delete("entity_type");
  neededFields.delete("name");
  neededFields.delete("claim_evidence");

  const remaining = new Set(neededFields);
  let harvestScheduled = 0;
  let paidScheduled = 0;

  const sorted = [...catalog].sort(
    (a, b) => a.costTier - b.costTier || a.id.localeCompare(b.id),
  );

  for (const cap of sorted) {
    if (!remaining.size) break;
    if (steps.length >= maxSteps) break;
    if (unavailable.has(cap.id)) {
      skipped.push({ providerId: cap.id, reason: "provider_unavailable" });
      continue;
    }
    if (cap.id === "candidate-existing") continue;

    const can = cap.fields.filter(
      (f) => f === "*" || remaining.has(f),
    );
    // Match remaining against provider field list
    const targets = [...remaining].filter(
      (f) => cap.fields.includes(f) || cap.fields.includes("*"),
    );
    if (!targets.length && !can.length) {
      skipped.push({ providerId: cap.id, reason: "no_matching_fields" });
      continue;
    }
    if (!targets.length) continue;

    // no_website: only no-website-verify may touch that claim; contact-harvest
    // must not run for url.
    if (requirements.forbidFields.includes("url") && cap.id === "contact-harvest") {
      const withoutUrl = targets.filter((f) => f !== "url" && f !== "website");
      if (!withoutUrl.length) {
        skipped.push({
          providerId: cap.id,
          reason: "forbidden_under_no_website",
        });
        continue;
      }
      targets.length = 0;
      targets.push(...withoutUrl);
    }

    if (cap.id === "contact-harvest") {
      if (harvestScheduled >= maxHarvest) {
        skipped.push({ providerId: cap.id, reason: "budget_contact_harvest" });
        continue;
      }
      harvestScheduled += 1;
    }
    if (cap.escalateOnly || cap.id === "paid-enrichment") {
      if (paidScheduled >= maxPaid) {
        skipped.push({ providerId: cap.id, reason: "budget_paid_or_escalate" });
        continue;
      }
      // Only escalate when a cheaper provider covering same fields is absent
      // from the plan or already skipped.
      const cheaperCovers = steps.some((s) =>
        targets.every((t) => s.fields.includes(t)),
      );
      if (cheaperCovers) {
        skipped.push({ providerId: cap.id, reason: "already_covered_cheaper" });
        continue;
      }
      paidScheduled += 1;
    }

    const role: "primary" | "escalation" =
      cap.escalateOnly || cap.costTier >= 7 ? "escalation" : "primary";

    steps.push({
      providerId: cap.id,
      fields: targets,
      role,
      reason: `missing_${targets.join("+")}_tier_${[...needed]
        .filter((n) => targets.includes(n.field))
        .map((n) => n.tier)
        .join("|")}`,
      costTier: cap.costTier,
    });

    for (const t of targets) remaining.delete(t);
  }

  for (const f of remaining) {
    skipped.push({
      providerId: "paid-enrichment",
      reason: `uncovered_field:${f}`,
    });
  }

  return { requirements, steps, skipped };
}

/** Whether enrichment should run before qualify for this candidate. */
export function needsEnrichmentBeforeQualify(
  spec: SearchSpec,
  candidate: SpecRow,
): boolean {
  const req = deriveEnrichmentRequirements(spec, candidate);
  return req.blockingMissing.length > 0 || req.whenAvailableMissing.length > 0;
}
