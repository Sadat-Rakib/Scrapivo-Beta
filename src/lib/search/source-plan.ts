/**
 * M7 — Coverage requirements + capability-based source plan.
 *
 * SearchSpec → deriveCoverageRequirements → buildSourcePlan → free-first ladder.
 * Phrase-matching routers are forbidden; capabilities on the Spec drive the plan.
 */
import type { SearchSpec, SpecEntity } from "@/lib/search/search-spec";
import type { EvidenceType } from "@/lib/search/evidence";
import { requestedClaimTypes } from "@/lib/search/canonical-contract";
import type { SearchOutcomeCode } from "@/lib/search/canonical-contract";
import {
  SOURCE_PROVIDER_CATALOG,
  type CostTier,
  type SourceCapability,
  type SourceProviderId,
} from "@/lib/search/source-capabilities";

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

export interface CoverageRequirements {
  entityTypes: SpecEntity[];
  claims: EvidenceType[];
  needsDiscovery: boolean;
  needsIdentityResolution: boolean;
  needsLocation: boolean;
  needsTemporal: boolean;
  opportunity: string | null;
}

export interface SourcePlanStep {
  providerId: SourceProviderId;
  costTier: CostTier;
  role: "primary" | "escalation";
  reason: string;
  capabilities: SourceCapability;
}

export interface SourcePlanSkip {
  providerId: SourceProviderId;
  reason: string;
}

export interface SourcePlan {
  requirements: CoverageRequirements;
  steps: SourcePlanStep[];
  skipped: SourcePlanSkip[];
  researchPlan: ResearchPlan;
}

export interface ResearchPlan {
  discoveryQueries: string[];
  requiredFields: string[];
  desiredCount: number;
  stoppingRules: {
    maxQueries: number;
    maxPages: number;
    maxCandidates: number;
    maxNoProgressQueries: number;
  };
}

/**
 * Provider execution diagnostics — coverage ≠ qualification.
 * A successful provider with 0 qualified leads is not a failed search.
 */
export interface ProviderDiagnostic {
  provider: SourceProviderId | string;
  attempted: boolean;
  succeeded: boolean;
  artifactsFound: number;
  entitiesResolved: number;
  qualified: number;
  costTier?: CostTier;
  role?: "primary" | "escalation";
  error?: string | null;
  /** Typed provider-level outcome (diagnostic unless all capable failed). */
  outcome?: SearchOutcomeCode | null;
}

export function deriveCoverageRequirements(spec: SearchSpec): CoverageRequirements {
  const entity = spec.entity === "unknown" ? null : spec.entity;
  const claims = requestedClaimTypes(spec);
  const location = fieldOf(spec, "location");
  const opportunity = fieldOf(spec, "opportunity");
  const needsTemporal =
    !!spec.signal_recency ||
    !!fieldOf(spec, "funding_status") ||
    !!fieldOf(spec, "temporal_relation") ||
    !!fieldOf(spec, "year");

  return {
    entityTypes: entity ? [entity] : ["company", "business", "person"],
    claims,
    needsDiscovery: true,
    needsIdentityResolution: true,
    needsLocation: !!location,
    needsTemporal,
    opportunity,
  };
}

function entityMatch(cap: SourceCapability, entityTypes: SpecEntity[]): boolean {
  if (!entityTypes.length) return true;
  return entityTypes.some((e) => cap.entityTypes.includes(e));
}

function claimFit(cap: SourceCapability, claims: EvidenceType[]): boolean {
  if (!claims.length) return true;
  // Identity-resolution-only feeds (registry) do not need to advertise every claim.
  if (cap.identityResolution && !cap.discovery) return true;
  if (!cap.claims.length) return true; // general discovery
  return claims.some((c) => cap.claims.includes(c));
}

function capabilityFit(
  cap: SourceCapability,
  req: CoverageRequirements,
): { ok: boolean; reason: string } {
  if (!entityMatch(cap, req.entityTypes)) {
    return { ok: false, reason: "entity_type_mismatch" };
  }
  if (req.needsLocation && !cap.locationSupport && !cap.discovery) {
    return { ok: false, reason: "no_location_support" };
  }
  if (req.needsTemporal && !cap.temporalSupport && !cap.discovery && !cap.identityResolution) {
    return { ok: false, reason: "no_temporal_support" };
  }
  if (!claimFit(cap, req.claims)) {
    return { ok: false, reason: "claim_capability_mismatch" };
  }
  // Opportunity no_website strongly prefers local structured sources.
  if (req.opportunity === "no_website" && cap.id === "jobs-fleet") {
    return { ok: false, reason: "jobs_irrelevant_for_no_website" };
  }
  return { ok: true, reason: "capability_match" };
}

export type BuildSourcePlanOptions = {
  providers?: readonly SourceCapability[];
  /** When true (default), escalateOnly providers stay in escalation role. */
  freeFirst?: boolean;
  /**
   * Provider ids that are not callable in this deployment (no key / no adapter).
   * They are skipped rather than planned as if live.
   */
  unavailable?: ReadonlySet<string> | readonly string[];
  desiredCount?: number;
};

/**
 * Build an ordered free-first source plan from Spec-derived requirements.
 * Paid SERP is never a primary step when any free/self-hosted capable source exists.
 */
export function buildSourcePlan(
  spec: SearchSpec,
  requirements?: CoverageRequirements,
  opts?: BuildSourcePlanOptions,
): SourcePlan {
  const req = requirements ?? deriveCoverageRequirements(spec);
  const catalog = opts?.providers ?? SOURCE_PROVIDER_CATALOG;
  const freeFirst = opts?.freeFirst !== false;
  const unavailable = new Set(
    opts?.unavailable
      ? Array.isArray(opts.unavailable)
        ? opts.unavailable
        : [...opts.unavailable]
      : [],
  );

  const skipped: SourcePlanSkip[] = [];
  const fitted: SourceCapability[] = [];

  for (const cap of catalog) {
    if (unavailable.has(cap.id)) {
      skipped.push({ providerId: cap.id, reason: "provider_unavailable" });
      continue;
    }
    const fit = capabilityFit(cap, req);
    if (!fit.ok) {
      skipped.push({ providerId: cap.id, reason: fit.reason });
      continue;
    }
    fitted.push(cap);
  }

  fitted.sort((a, b) => a.costTier - b.costTier || a.id.localeCompare(b.id));

  const hasFreePrimary = fitted.some((c) => !c.escalateOnly && c.costTier < 7);

  const steps: SourcePlanStep[] = [];
  for (const cap of fitted) {
    const escalate =
      freeFirst && !!cap.escalateOnly && (hasFreePrimary || cap.costTier >= 7);
    // Paid SERP: always escalation when any cheaper capable source exists.
    const paidEscalation =
      cap.id === "paid-serp" && fitted.some((c) => c.id !== "paid-serp" && c.costTier < 7);
    const role: "primary" | "escalation" =
      escalate || paidEscalation ? "escalation" : "primary";

    steps.push({
      providerId: cap.id,
      costTier: cap.costTier,
      role,
      reason:
        role === "escalation"
          ? `escalate_after_free_ladder:${cap.id}`
          : `primary_tier_L${cap.costTier}:${fitReason(cap, req)}`,
      capabilities: cap,
    });
  }

  // Stable order: all primaries (by tier) then escalations (by tier).
  steps.sort((a, b) => {
    if (a.role !== b.role) return a.role === "primary" ? -1 : 1;
    return a.costTier - b.costTier || a.providerId.localeCompare(b.providerId);
  });

  return {
    requirements: req,
    steps,
    skipped,
    researchPlan: buildResearchPlan(spec, { desiredCount: opts?.desiredCount }),
  };
}

function fitReason(cap: SourceCapability, req: CoverageRequirements): string {
  const bits: string[] = [cap.id];
  if (req.opportunity === "no_website" && cap.claims.includes("no_website")) {
    bits.push("no_website");
  }
  if (req.claims.includes("funding") && (cap.claims.includes("funding") || cap.identityResolution)) {
    bits.push("funding");
  }
  if (req.claims.includes("hiring") && cap.claims.includes("hiring")) bits.push("hiring");
  if (req.claims.includes("service_request") && cap.claims.includes("service_request")) {
    bits.push("service_request");
  }
  if (cap.identityResolution) bits.push("identity");
  return bits.join("+");
}

/**
 * Primary provider ids in plan order (excludes escalation).
 */
export function primaryProviderIds(plan: SourcePlan): SourceProviderId[] {
  return plan.steps.filter((s) => s.role === "primary").map((s) => s.providerId);
}

function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function usefulLocation(spec: SearchSpec): string | null {
  const location = fieldOf(spec, "location");
  return location && !/^(worldwide|global|anywhere)$/i.test(location) ? location : null;
}

function roleTerms(role: string | null): string[] {
  if (!role) return [];
  if (/\bfounder\b/i.test(role)) return ['"founder"', '"co-founder"', '"Founder & CEO"'];
  return [role];
}

function discoveryTerms(spec: SearchSpec): string[] {
  return uniq([
    fieldOf(spec, "role"),
    fieldOf(spec, "industry"),
    fieldOf(spec, "category"),
    fieldOf(spec, "business_model"),
    fieldOf(spec, "technology"),
    fieldOf(spec, "requested_role"),
    fieldOf(spec, "requested_service"),
    fieldOf(spec, "requested_product"),
    fieldOf(spec, "funding_status"),
  ]);
}

export function buildResearchPlan(
  spec: SearchSpec,
  opts?: { desiredCount?: number },
): ResearchPlan {
  const desiredCount = Math.max(1, opts?.desiredCount ?? 10);
  const location = usefulLocation(spec);
  const role = fieldOf(spec, "role");
  const industry = fieldOf(spec, "industry") ?? fieldOf(spec, "category");
  const model = fieldOf(spec, "business_model");
  const requestedRole = fieldOf(spec, "requested_role");
  const requestedService = fieldOf(spec, "requested_service");
  const funding = fieldOf(spec, "funding_status");
  const category = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
  const noWebsite = fieldOf(spec, "opportunity") === "no_website";
  const topics = (fieldOf(spec, "content_topic") ?? "").split(/\s+or\s+|\|/i).map((topic) => topic.trim()).filter(Boolean);

  let discoveryQueries: string[];
  if (spec.entity === "person") {
    const roles = roleTerms(role);
    discoveryQueries = uniq([
      ...topics.map((topic) => [role, location, `"${topic.replace(/"/g, "")}"`].filter(Boolean).join(" ")),
      ...roles.map((r) => [r, industry, model, location].filter(Boolean).join(" ")),
      ...roles.map((r) => ['site:linkedin.com/in', r, industry, location].filter(Boolean).join(" ")),
      [role, industry, "startup", location].filter(Boolean).join(" "),
    ]);
  } else if (spec.entity === "company") {
    discoveryQueries = uniq([
      [industry, model, "company", location].filter(Boolean).join(" "),
      [industry, model, "startup", location].filter(Boolean).join(" "),
      funding ? [industry, "funded startup", location].filter(Boolean).join(" ") : null,
      requestedRole ? [industry, "hiring", requestedRole, location].filter(Boolean).join(" ") : null,
      requestedService ? [industry, "needs", requestedService, location].filter(Boolean).join(" ") : null,
    ]);
  } else if (spec.entity === "business") {
    discoveryQueries = uniq([
      [category, location].filter(Boolean).join(" "),
      [category, "business", location].filter(Boolean).join(" "),
      [category, noWebsite ? '"no website"' : "contact", location].filter(Boolean).join(" "),
    ]);
  } else if (spec.entity === "job") {
    discoveryQueries = uniq([
      [role ?? requestedRole ?? category, location, "job"].filter(Boolean).join(" "),
      [role ?? requestedRole ?? category, "remote job"].filter(Boolean).join(" "),
    ]);
  } else {
    const terms = discoveryTerms(spec);
    discoveryQueries = uniq([
      [spec.entity !== "unknown" ? spec.entity : null, ...terms, location].filter(Boolean).join(" "),
      [...terms, location].filter(Boolean).join(" "),
    ]);
  }

  const requiredFields = uniq([
    "name",
    spec.entity === "person" || role ? "role" : null,
    spec.entity === "person" ? "company" : null,
    industry ? "industry" : null,
    spec.entity === "job" ? "job_url" : noWebsite ? "no_website_evidence" : "website_or_profile",
    location ? "location" : null,
    /\b(?:email|phone|public contact details?)\b/i.test(spec.raw_query) ? "contact" : null,
    spec.signal_required ? "signal_evidence" : null,
    topics.length ? "topic_evidence" : null,
    "identity_evidence",
  ]);

  return {
    discoveryQueries,
    requiredFields,
    desiredCount,
    stoppingRules: {
      maxQueries: Math.min(6, Math.max(3, discoveryQueries.length)),
      maxPages: Math.max(12, Math.min(40, desiredCount * 4)),
      maxCandidates: Math.min(30, Math.max(desiredCount * 3, 12)),
      maxNoProgressQueries: 2,
    },
  };
}

export function buildCandidateResearchQueries(
  spec: SearchSpec,
  row: { title?: string | null; url?: string | null; company?: string | null; company_name?: string | null },
  missing: string[],
): string[] {
  const name = row.title?.trim();
  const company = row.company ?? row.company_name ?? null;
  const subject = spec.entity === "person" ? uniq([name, company]).join(" ") : name;
  if (!subject) return [];
  const exactName = (name ?? subject).replace(/"/g, "");
  const requestedRole = fieldOf(spec, "requested_role");
  const requestedService = fieldOf(spec, "requested_service");
  const industry = fieldOf(spec, "industry") ?? fieldOf(spec, "category");
  const noWebsite = fieldOf(spec, "opportunity") === "no_website";
  const queries: Array<string | null> = [];
  const topics = (fieldOf(spec, "content_topic") ?? "").split(/\s+or\s+|\|/i).map((topic) => topic.trim()).filter(Boolean);
  if (missing.includes("topic") || missing.includes("topic_evidence")) for (const topic of topics) queries.push([subject, `"${topic.replace(/"/g, "")}"`].join(" "));
  if (noWebsite && (missing.includes("no_website_evidence") || missing.includes("no_website_verification"))) {
    queries.push([`"${exactName}"`, fieldOf(spec, "location") ? `"${fieldOf(spec, "location")?.replace(/"/g, "")}"` : null].filter(Boolean).join(" "));
    queries.push([`"${exactName}"`, fieldOf(spec, "location") ? `"${fieldOf(spec, "location")?.replace(/"/g, "")}"` : null, "official website"].filter(Boolean).join(" "));
  }

  if (missing.some((f) => /role|company|identity/i.test(f))) {
    queries.push([`"${exactName}"`, company ? `"${company.replace(/"/g, "")}"` : null, fieldOf(spec, "role"), industry].filter(Boolean).join(" "));
  }
  if (missing.some((f) => /industry|location/i.test(f)) && spec.entity === "company") {
    queries.push([`"${exactName}"`, fieldOf(spec, "location"), industry, "official website"].filter(Boolean).join(" "));
  }
  if (missing.some((f) => /website|profile|contact/i.test(f))) {
    const destinationName = spec.entity === "person" && company ? company : subject;
    queries.push([destinationName, fieldOf(spec, "location"), "official website"].filter(Boolean).join(" "));
    if (missing.includes("profile")) queries.push([subject, "LinkedIn"].join(" "));
    if (missing.includes("contact")) queries.push([destinationName, "contact"].join(" "));
  }
  if (spec.signal_required && missing.some((f) => /signal|evidence/.test(f))) {
    if (requestedRole) queries.push([subject, "hiring", requestedRole].join(" "));
    if (requestedService) queries.push([subject, "needs", requestedService].join(" "));
    queries.push([subject, "careers"].join(" "));
  }
  return uniq(queries);
}

/**
 * Whether paid SERP would be invoked under free-first rules given current diagnostics.
 * True only when every primary discovery source failed or returned nothing AND
 * escalation is explicitly allowed.
 */
export function shouldInvokePaidSerp(
  plan: SourcePlan,
  diagnostics: ProviderDiagnostic[],
): boolean {
  const paid = plan.steps.find((s) => s.providerId === "paid-serp");
  if (!paid) return false;
  const primaries = plan.steps.filter(
    (s) => s.role === "primary" && s.capabilities.discovery,
  );
  if (!primaries.length) return true;
  return primaries.every((p) => {
    const d = diagnostics.find((x) => x.provider === p.providerId);
    if (!d || !d.attempted) return false;
    return !d.succeeded || d.artifactsFound === 0;
  });
}

/**
 * Coverage vs qualification outcome for a finished plan run.
 * - Some capable provider succeeded (even with 0 qualified) → NO_QUALIFIED_RESULTS
 * - All capable providers unavailable/failed → SOURCE_UNAVAILABLE (not fake zero)
 */
export function resolveSourcePlanOutcome(args: {
  diagnostics: ProviderDiagnostic[];
  qualifiedCount: number;
  cancelled?: boolean;
  failed?: boolean;
}): {
  outcome: SearchOutcomeCode;
  coverageEstablished: boolean;
  diagnostics: ProviderDiagnostic[];
} {
  if (args.cancelled) {
    return {
      outcome: "SEARCH_CANCELLED",
      coverageEstablished: false,
      diagnostics: args.diagnostics,
    };
  }
  if (args.failed) {
    return {
      outcome: "SEARCH_FAILED",
      coverageEstablished: false,
      diagnostics: args.diagnostics,
    };
  }
  if (args.qualifiedCount > 0) {
    return {
      outcome: "QUALIFIED_RESULTS",
      coverageEstablished: true,
      diagnostics: args.diagnostics,
    };
  }

  const attempted = args.diagnostics.filter((d) => d.attempted);
  const anySucceeded = attempted.some((d) => d.succeeded);
  const coverageEstablished = anySucceeded;

  if (!coverageEstablished) {
    const allErrored =
      attempted.length > 0 &&
      attempted.every((d) => !d.succeeded && (d.outcome === "SOURCE_ERROR" || !!d.error));
    return {
      outcome: allErrored && attempted.every((d) => d.outcome === "SOURCE_ERROR")
        ? "SOURCE_ERROR"
        : "SOURCE_UNAVAILABLE",
      coverageEstablished: false,
      diagnostics: args.diagnostics,
    };
  }

  return {
    outcome: "NO_QUALIFIED_RESULTS",
    coverageEstablished: true,
    diagnostics: args.diagnostics,
  };
}
