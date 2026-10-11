/**
 * M7 — Coverage requirements + capability-based source plan.
 *
 * SearchSpec → deriveCoverageRequirements → buildSourcePlan → free-first ladder.
 * Phrase-matching routers are forbidden; capabilities on the Spec drive the plan.
 */
import type { SearchSpec, SpecEntity } from "@/lib/search/search-spec";
import type { EvidenceType } from "@/lib/search/evidence";
import { jobDiscoveryRemoteIntent, jobDiscoveryRole, planDiscoveryVariants } from "./search-query-planner";
import { requestedClaimTypes } from "@/lib/search/canonical-contract";
import type { SearchOutcomeCode } from "@/lib/search/canonical-contract";
import {
  SOURCE_PROVIDER_CATALOG,
  type CostTier,
  type SourceCapability,
  type SourceProviderId,
} from "@/lib/search/source-capabilities";
import { applyStableYieldOrder } from "./source-yield";
import { geoById, resolveCanonicalLocation } from "./location-resolver";
import { SOURCE_REGISTRY, type SourceDefinition } from "@/lib/sources/registry";

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
  /** Observed wall-time of the provider attempt (PRD §15 diagnostics). */
  latencyMs?: number;
  /** Query variants the provider actually spent (PRD §15). */
  queries?: number;
  /** Result pages fetched (PRD §15), when the provider reports them. */
  pages?: number;
  /** Anti-bot challenge encountered (PRD §15). */
  challenge?: boolean;
  /** Retries spent (PRD §15). */
  retries?: number;
  /** Per-query browser discovery funnel (WS1 zero-classification); browser-live only. */
  queryFunnel?: import("./browser-live.server").BrowserQueryFunnel[];
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

/**
 * Registry (source intelligence) → plan provider mapping. Only confident
 * 1:1 pairs; job feed/ATS gating lives in the jobs pipeline itself.
 */
const REGISTRY_TO_PLAN_PROVIDER: Record<string, string> = {
  "db-indexed": "indexed-db",
  "db-osm": "osm-local",
  "db-company-registry": "company-registry",
  "search-searxng": "searxng",
  "search-browser": "browser-automation",
  "web-official-sites": "direct-http",
};

/**
 * Source registry policy enforcement: a registry decision of `disabled` or
 * `needs_review` blocks the mapped plan provider so a disabled source can
 * never be planned (beta spec §64). Allowed/needs_key sources stay plannable.
 */
export function registryBlockedProviderIds(
  defs: readonly SourceDefinition[] = SOURCE_REGISTRY,
): Map<string, string> {
  const blocked = new Map<string, string>();
  for (const def of defs) {
    const planId = REGISTRY_TO_PLAN_PROVIDER[def.id];
    if (!planId) continue;
    if (def.decision === "disabled") blocked.set(planId, "registry_disabled");
    else if (def.decision === "needs_review") blocked.set(planId, "registry_needs_review");
  }
  return blocked;
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
  /**
   * Workstream 4: precomputed smoothed qualification yield per provider id
   * (prefetch with smoothedYieldsBySource() from source-yield.server.ts).
   * When present, capable providers WITH yield data are stable-reordered by
   * yield desc after the tier sort; providers without data keep their tier
   * position and are never dropped. Optional — buildSourcePlan stays sync.
   */
  yieldOrder?: Readonly<Record<string, number>>;
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

  const registryBlocked = registryBlockedProviderIds();
  for (const cap of catalog) {
    const blockedReason = registryBlocked.get(cap.id);
    if (blockedReason) {
      skipped.push({ providerId: cap.id, reason: blockedReason });
      continue;
    }
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

  // Workstream 4 post-step: yield reorder. Applied ONLY when smoothed data
  // was prefetched; applyStableYieldOrder keeps no-data providers in place.
  if (opts?.yieldOrder && Object.keys(opts.yieldOrder).length > 0) {
    const yields = new Map<string, number | null>(
      Object.entries(opts.yieldOrder).map(([k, v]) => [
        k,
        typeof v === "number" && Number.isFinite(v) ? v : null,
      ]),
    );
    const ordered = applyStableYieldOrder(
      steps.map((s) => s.providerId),
      yields,
    );
    const byId = new Map<string, SourcePlanStep>(steps.map((s) => [s.providerId, s]));
    steps.length = 0;
    for (const id of ordered) {
      const step = byId.get(id);
      if (step) steps.push(step);
    }
  }

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

/**
 * E2E-C8: a discovery query built from filler alone ("startup", "company")
 * burns live-browser budget on junk and answers nothing. A query earns a slot
 * only when it carries request-specific terms and at least two of them (or one
 * quoted phrase). The signal/topic terms are seeded FIRST so a request like
 * "people looking for a web designer" gapsfills with the ask, not "startup".
 */
const GENERIC_FILLER = new Set([
  "startup", "startups", "company", "companies", "business", "businesses",
  "people", "person", "find", "leads", "looking", "needs",
]);

function substantiveQuery(q: string): boolean {
  const quoted = /"[^"]+"/.test(q);
  const meat = q
    .replace(/"[^"]*"/g, " ")
    .split(/[^a-z0-9]+/i)
    .filter((w) => w && !GENERIC_FILLER.has(w.toLowerCase()));
  return meat.length >= 2 || (meat.length >= 1 && quoted);
}

function keepSubstantive(queries: Array<string | null>): string[] {
  return uniq(
    queries
      .map((q) => (q ?? "").trim())
      .filter((q) => q && substantiveQuery(q)),
  );
}

export function buildResearchPlan(
  spec: SearchSpec,
  opts?: { desiredCount?: number; /** Widen round: more query variants of the SAME constraints + deeper pages. */ widen?: boolean },
): ResearchPlan {
  const desiredCount = Math.max(1, opts?.desiredCount ?? 10);
  const location = usefulLocation(spec);
  // Geo-scoped discovery: search engines do NOT scope a bare city query —
  // "solar installer Windhoek" served US/UK/ZA results and starved every
  // downstream stage. Appending the resolved country name focuses each
  // engine on the requested geography; the query is deduplicated when the
  // user's own wording already names the country.
  const locationGeo = location
    ? resolveCanonicalLocation(location, { gazetteer: true, correctTypos: true })
    : null;
  const countryName = locationGeo?.country_code
    ? geoById(`geo:country:${locationGeo.country_code.toLowerCase()}`)?.name ?? null
    : null;
  const scopedLocation =
    countryName && location && !location.toLowerCase().includes(countryName.toLowerCase())
      ? `${location} ${countryName}`
      : location;
  const role = fieldOf(spec, "role");
  const industry = fieldOf(spec, "industry") ?? fieldOf(spec, "category");
  const model = fieldOf(spec, "business_model");
  const requestedRole = fieldOf(spec, "requested_role");
  const requestedService = fieldOf(spec, "requested_service");
  const requestedProduct = fieldOf(spec, "requested_product");
  const funding = fieldOf(spec, "funding_status");
  const category = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
  const noWebsite = fieldOf(spec, "opportunity") === "no_website";
  const topics = (fieldOf(spec, "content_topic") ?? "").split(/\s+or\s+|\|/i).map((topic) => topic.trim()).filter(Boolean);

  let discoveryQueries: string[];
  if (spec.entity === "person") {
    const roles = roleTerms(role);
    discoveryQueries = keepSubstantive([
      ...topics.map((topic) => [role, scopedLocation, `"${topic.replace(/"/g, "")}"`].filter(Boolean).join(" ")),
      ...[requestedService, requestedProduct].filter(Boolean).map((want) => [`"looking for" "${want}"`, scopedLocation].filter(Boolean).join(" ")),
      ...roles.map((r) => [r, industry, model, scopedLocation].filter(Boolean).join(" ")),
      ...roles.map((r) => ['site:linkedin.com/in', r, industry, scopedLocation].filter(Boolean).join(" ")),
      [role, industry, scopedLocation].filter(Boolean).join(" "),
    ]);
  } else if (spec.entity === "company") {
    discoveryQueries = keepSubstantive([
      [industry, model, scopedLocation].filter(Boolean).join(" "),
      funding ? [industry, "funded startup", scopedLocation].filter(Boolean).join(" ") : null,
      requestedRole ? [industry, "hiring", requestedRole, scopedLocation].filter(Boolean).join(" ") : null,
      requestedService ? [industry, "needs", requestedService, scopedLocation].filter(Boolean).join(" ") : null,
      ...topics.map((topic) => [`"${topic.replace(/"/g, "")}"`, scopedLocation].filter(Boolean).join(" ")),
    ]);
  } else if (spec.entity === "business") {
    // Universal business query families (PRD: general planner): every
    // variant derives from the user's own category string — no trade
    // vocabulary, no benchmark terms.
    const base = [category, scopedLocation].filter(Boolean).join(" ");
    discoveryQueries = uniq([
      base,
      [category, "companies", scopedLocation].filter(Boolean).join(" "),
      [category, "services", scopedLocation].filter(Boolean).join(" "),
      [category, "directory", scopedLocation].filter(Boolean).join(" "),
      [category, noWebsite ? '"no website"' : "contact", scopedLocation].filter(Boolean).join(" "),
      [category, "near", scopedLocation].filter(Boolean).join(" "),
    ]);
  } else if (spec.entity === "job") {
    const jobRole = jobDiscoveryRole(spec);
    discoveryQueries = uniq([
      [jobRole, scopedLocation, "job"].filter(Boolean).join(" "),
      jobDiscoveryRemoteIntent(spec) ? [jobRole, "remote job"].filter(Boolean).join(" ") : null,
    ]);
  } else if (spec.entity === "investor") {
    // Investor discovery: fund-site and portfolio queries per the source
    // routing contract — fund sites, team/thesis pages, directories, and
    // stage/sector-qualified lists. Never the generic entity dump.
    // MEASURED: search engines return 0 for 5-6-term ANDed investor queries
    // ("AI venture capital seed Canada fund" → 0) while 2-3-term queries
    // return 24-56. Keep each query at ≤3 content terms; the extraction and
    // qualification stages do the narrowing.
    const sector = fieldOf(spec, "investor_sector") ?? fieldOf(spec, "industry") ?? category;
    const stage = fieldOf(spec, "investor_stage");
    // MEASURED: generic "[sector] investors [location]" queries surface
    // podcasts/news, not fund pages ("AI investors Canada" → a podcast).
    // "firms"/"funds"/"portfolio" force list-page results that the extractor
    // can actually read.
    const investorScope = fieldOf(spec, "investor_type");
    discoveryQueries = investorScope ? uniq([
      /\bfund\b/i.test(investorScope) ? ["venture capital funds", sector, scopedLocation].filter(Boolean).join(" ") : null,
      /\bfund\b/i.test(investorScope) ? [sector, "VC funds portfolio"].filter(Boolean).join(" ") : null,
      /\bfund\b/i.test(investorScope) ? ["venture capital funds", scopedLocation].filter(Boolean).join(" ") : null,
      /\bangel\b/i.test(investorScope) ? ["angel investors", sector, scopedLocation].filter(Boolean).join(" ") : null,
      /\bangel\b/i.test(investorScope) ? [sector, '"angel investor" portfolio'].filter(Boolean).join(" ") : null,
      /\bangel\b/i.test(investorScope) ? ['site:linkedin.com/in "angel investor"', sector].filter(Boolean).join(" ") : null,
    ]) : uniq([
      ["venture capital firms", sector, scopedLocation].filter(Boolean).join(" "),
      [sector, "VC funds portfolio"].filter(Boolean).join(" "),
      [sector, "startup investors list"].filter(Boolean).join(" "),
      [stage, "VC firms", sector].filter(Boolean).join(" "),
      ["venture capital funds", scopedLocation].filter(Boolean).join(" "),
      [sector, "angel list"].filter(Boolean).join(" "),
    ]);
  } else {
    const terms = discoveryTerms(spec);
    discoveryQueries = uniq([
      [spec.entity !== "unknown" ? spec.entity : null, ...terms, scopedLocation].filter(Boolean).join(" "),
      [...terms, scopedLocation].filter(Boolean).join(" "),
    ]);
  }

  // Query planner (Part 7): Boolean/site: discovery variants as ADDITIONS —
  // exact phrases, publicly indexed signal hunts, role aliases. Capped by the
  // existing maxQueries rule.
  discoveryQueries = uniq([...discoveryQueries, ...(spec.entity === "investor" && fieldOf(spec, "investor_type") ? [] : planDiscoveryVariants(spec))]);

  // Last resort: if every constructed query was filler, the user's own words
  // are still the honest query — never hand the live browser an empty plan.
  if (discoveryQueries.length === 0 && spec.raw_query?.trim()) {
    discoveryQueries = [spec.raw_query.trim()];
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

  // Widening (PRD §35): a widen round activates MORE query variants of the
  // SAME constraints (the plan already generates them; the base cap keeps
  // most unspent) and deeper result pages. Constraints themselves never move.
  const queryCap = opts?.widen ? 10 : 6;
  const pageCap = opts?.widen ? 90 : 60;
  return {
    discoveryQueries,
    requiredFields,
    desiredCount,
    stoppingRules: {
      maxQueries: Math.min(queryCap, Math.max(3, discoveryQueries.length)),
      maxPages: Math.max(12, Math.min(pageCap, desiredCount * 4)),
      maxCandidates: Math.min(opts?.widen ? 120 : 60, Math.max(desiredCount * 2, 20)),
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
  if (missing.includes("product_company")) queries.push([`"${exactName}"`, industry, "own software products platform official website"].filter(Boolean).join(" "));
  const topics = (fieldOf(spec, "content_topic") ?? "").split(/\s+or\s+|\|/i).map((topic) => topic.trim()).filter(Boolean);
  if (missing.includes("topic") || missing.includes("topic_evidence")) for (const topic of topics) queries.push([subject, `"${topic.replace(/"/g, "")}"`].join(" "));
  if (noWebsite && (missing.includes("no_website_evidence") || missing.includes("no_website_verification"))) {
    queries.push([`"${exactName}"`, fieldOf(spec, "location") ? `"${fieldOf(spec, "location")?.replace(/"/g, "")}"` : null].filter(Boolean).join(" "));
    queries.push([`"${exactName}"`, fieldOf(spec, "location") ? `"${fieldOf(spec, "location")?.replace(/"/g, "")}"` : null, "official website"].filter(Boolean).join(" "));
  }

  if (missing.some((f) => /role|company|identity/i.test(f))) {
    queries.push([`"${exactName}"`, company ? `"${company.replace(/"/g, "")}"` : null, fieldOf(spec, "role"), industry].filter(Boolean).join(" "));
    if (spec.entity === "investor" && fieldOf(spec, "investor_type")) queries.push([`"${exactName}"`, 'fund OR "angel investor"', "official profile"].join(" "));
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
  if (missing.includes("social")) {
    queries.push([`"${exactName}"`, "Instagram OR Facebook OR LinkedIn recent posts"].join(" "));
  }
  if (spec.signal_required && missing.some((f) => /signal|evidence/.test(f))) {
    const claims = requestedClaimTypes(spec);
    if (claims.includes("hiring")) {
      queries.push([subject, "hiring", requestedRole].filter(Boolean).join(" "));
      queries.push([subject, "careers"].join(" "));
    }
    if (claims.includes("investment")) queries.push([subject, fieldOf(spec, "investor_sector"), "portfolio invested backed"].filter(Boolean).join(" "));
    if (claims.includes("funding")) queries.push([subject, "funding raised round", fieldOf(spec, "funding_status")].filter(Boolean).join(" "));
    if (claims.includes("service_request") && requestedService) queries.push([subject, "needs", requestedService].join(" "));
    if (claims.includes("social_ask")) queries.push([subject, "looking for", requestedRole ?? requestedService].filter(Boolean).join(" "));
    if (claims.includes("custom_signal") || !claims.length) queries.push([subject, spec.custom_signal_text?.trim() || "recent activity evidence"].join(" "));
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
