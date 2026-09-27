/**
 * Spec-first conversational search (Phase 1).
 *
 * USER MESSAGE → extract spec → missing? ask : DB-first → validate → results.
 * Live fan-out runs ONLY when spec.signal_required or DB-thin (Phase 7 wires
 * live; until then the response reports what would happen — never fake rows).
 *
 * Readers are injectable so tests prove logic without S3 credentials.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import type { SearchSpec } from "@/lib/search/search-spec";
import { investorSectorMatches } from "@/lib/search/search-spec";
import type { DbHitMeta } from "@/lib/canonical/read-parquet.server";
import { searchPeopleDB, personRoleMatches } from "@/lib/canonical/people.server";
import { searchCompaniesDB, companyCategoryMatches } from "@/lib/canonical/companies.server";
import { searchBusinessesDB, craftMatches } from "@/lib/canonical/businesses.server";
import { searchInvestorsDB } from "@/lib/canonical/investors.server";
import { COUNTRY_ISO } from "@/lib/search/search-spec-extract";
import { countryHintForCity, locationSatisfies, resolveCanonicalLocation } from "@/lib/search/location-resolver";
import { useIndexedSearch, useObjectSearchIndex } from "@/lib/search/flag";
import { queryIndexForSpec } from "@/lib/indexed/search-index.server";
import { queryObjectIndexForSpec } from "@/lib/object-index/search.server";
import { useCoverageSelector } from "@/lib/search/flag";
import { selectCoverageSources, type CoverageMatrix } from "@/lib/search/coverage-selector";
import { normCityLookup } from "@/lib/search/search-spec-extract";
import {
  detectModeFromQuery,
  interpretModeAnswer,
  isDirectoryEntity,
} from "@/lib/search/mode-gate";
import { inferOfferingId, offeringById } from "@/lib/search/offer-taxonomy";
import { checkPhone } from "@/lib/search/phone-safety";
import { fixMojibake } from "@/lib/encoding";
import { missingRequiredFields } from "@/lib/search/completeness";
import { formatPlace, markSoftDuplicates } from "@/lib/search/format-place";
import { makeEvidence } from "@/lib/search/evidence";
import type { Evidence } from "@/lib/search/evidence";
import { mergeDuplicateCandidates } from "@/lib/search/candidate-merge";
import { normalizeRole } from "@/lib/search/search-spec-extract";
// NOTE: provider modules stay behind dynamic import() at their use sites.
// This file is statically imported by client routes, and the provider
// chains reach node builtins (registry → node:crypto/fs, ats-adapters →
// node:child_process) which crash the browser bundle. Type-only here.
import type { searchOsmLocalBusinesses } from "@/lib/search/osm-local-businesses.server";
import type { fetchSpecJobs } from "@/lib/search/jobs-provider";
import type { EnrichRowFn } from "@/lib/search/enrich-incomplete";
import type { LiveGapfillDeps } from "@/lib/search/live-gapfill";
import {
  entityModeQuestion,
  entityOfferQuestion,
  entityQuestionsForSpec,
  subjectFromQuery,
} from "@/lib/search/clarifier";

export interface SpecSearchDeps {
  people?: typeof searchPeopleDB;
  companies?: typeof searchCompaniesDB;
  businesses?: typeof searchBusinessesDB;
  investors?: typeof searchInvestorsDB;
  /** Indexed retriever (injectable for tests). null forces the S3 path. */
  index?: typeof queryIndexForSpec | null;
  /** Live business provider (Overpass/Nominatim). null skips the tier. */
  providerBusinesses?: typeof searchOsmLocalBusinesses | null;
  /** Jobs fleet provider (registry subset). null keeps the legacy placeholder. */
  providerJobs?: typeof fetchSpecJobs | null;
  /** Phase B: enrich incomplete rows. null skips; undefined uses production. */
  enrichFn?: EnrichRowFn | null;
  /** Phase C: live gapfill adapters. */
  liveGapfill?: LiveGapfillDeps | null;
  /** M8: query-aware enrichment adapters (injectable for tests). */
  enrichmentAdapters?: Partial<
    Record<
      import("@/lib/search/enrichment-plan").EnrichmentProviderId,
      import("@/lib/search/enrichment-run").EnrichmentAdapter
    >
  >;
  /** M3: abort in-flight work when signalled. */
  signal?: AbortSignal | null;
  browserProgress?: (event: { action: string; source?: string; detail?: string; count?: number | string }) => void;
}

export interface SpecRow {
  kind: "person" | "company" | "business" | "investor" | "job";
  title: string;
  detail: string;
  role?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Phone-country safety (Phase 1.5): 'mismatch-hidden'/'invalid-hidden'
   *  means a wrong-country or garbage number was suppressed — never shown. */
  phoneStatus?: import("@/lib/search/phone-safety").PhoneStatus;
  url?: string | null;
  /** Discovery or observation page; never an entity destination by itself. */
  source_url?: string | null;
  /** Confirmed first-party company or business site. */
  website_url?: string | null;
  /** Public contact page observed on the confirmed first-party site. */
  contact_page_url?: string | null;
  /** Canonical public person profile. */
  profile_url?: string | null;
  /** Actual job posting or application destination. */
  apply_url?: string | null;
  /** Bounded absence research; the claim still requires subject-bound evidence. */
  no_website_verification?: {
    structured_source_url?: string | null;
    structured_absence: boolean;
    exact_queries: string[];
    official_site_found?: string | null;
  };
  /** Registry key of the retrieved DB row (anti-hallucination boundary:
   *  index-served rows must carry a key from this run's retrieval set). */
  key?: string | null;
  /**
   * Stable canonical entity id for QualifiedLead.
   * Provisional ids (prefix `provisional:`) cannot qualify or be delivered.
   * Falls back to `key` / url-derived id in the theorem bridge.
   */
  entity_id?: string | null;
  /** Hard entity-resolution gate — required true to qualify. */
  entity_resolved?: boolean | null;
  /** Page classification — list/directory/job_board/institute cannot be the lead. */
  page_type?: import("@/lib/search/canonical-contract").PageType | null;
  /** Original source page type before entity extraction (article → company, etc.). */
  source_page_type?: import("@/lib/search/canonical-contract").PageType | null;
  identity_confidence?: number | null;
  /** How entity resolution decided (provenance). */
  resolution_method?: string | null;
  /** Row's own fields for validation (DB-filtered values, not title text). */
  category?: string | null;
  location?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  stage?: string | null;
  check?: string | null;
  /** Evidence-backed why-match (Phase 1B). Never LLM-invented. */
  why_match?: string | null;
  /** Completeness (Phase A): false → enrich queue, not first-page grid. */
  complete?: boolean;
  missingFields?: string[];
  /** Opportunity criterion copy (e.g. no_website) for completeness. */
  opportunity?: string | null;
  /** Same phone+address as another row on this page (soft flag). */
  soft_duplicate?: boolean;
  /** Phase 1B/C: observed evidence backing signal/opportunity/intent. */
  evidence?: import("@/lib/search/evidence").Evidence[];
  /** Phase 1C: request↔entity fit (0..1). */
  relevance_score?: number | null;
  /** Phase 1C: seeking intensity from evidence (0..1). */
  intent_score?: number | null;
  /** Phase 1C qualification disposition. */
  disposition?: "qualified" | "potential_match" | "dropped" | null;
  disposition_label?: string | null;
  /** Phase 1D verification status for live write-back. */
  verification_status?: "discovered" | "normalized" | "verified" | "rejected" | null;
  /** M8: job salary when Spec requires/thresholded. */
  salary?: string | number | null;
  /** M8: employer for job rows. */
  employer?: string | null;
  /** M8: field-level enrichment provenance (not claim evidence). */
  field_provenance?: Record<
    string,
    {
      value: string | number | boolean | null;
      source: string;
      source_url: string | null;
      observed_at: string;
      confidence: number;
    }
  >;
}

/**
 * Canonical opportunity stamp: when the Spec hunts an opportunity
 * (e.g. no_website), candidate rows must carry it BEFORE completeness runs —
 * otherwise a legitimate no-site candidate is judged incomplete by every
 * check that evaluates completeness before applyWhyMatchGate gets to stamp.
 * Row-level value always wins (browser-observed text beats spec copy).
 */
export function stampSpecOpportunity(row: SpecRow, spec?: SearchSpec): SpecRow {
  if (!spec || row.opportunity) return row;
  const opp = fieldOf(spec, "opportunity");
  return opp ? { ...row, opportunity: opp } : row;
}

/** Apply mojibake repair to all user-visible string fields. Never invents. */
export function sanitizeSpecRow(row: SpecRow, spec?: SearchSpec): SpecRow {
  const stamped = stampSpecOpportunity(row, spec);
  const s = (v: string | null | undefined) =>
    v == null ? v : fixMojibake(v);
  const sourceUrl = s(stamped.source_url) ?? null;
  const sourceIsDiscovery = ["list", "directory", "aggregator", "job_board", "article", "institute", "social_post"].includes(stamped.source_page_type ?? "");
  const legacyUrl = s(stamped.url) ?? null;
  const safeLegacy = sourceIsDiscovery || (sourceUrl && legacyUrl === sourceUrl) ? null : legacyUrl;
  const websiteUrl = s(stamped.website_url) ?? (["company", "business", "investor"].includes(stamped.kind) ? safeLegacy : null);
  const profileUrl = s(stamped.profile_url) ?? (stamped.kind === "person" && safeLegacy !== websiteUrl ? safeLegacy : null);
  const applyUrl = s(stamped.apply_url) ?? (stamped.kind === "job" ? safeLegacy : null);
  const destination = stamped.kind === "job" ? applyUrl : stamped.kind === "person" ? profileUrl ?? websiteUrl : websiteUrl;
  const out: SpecRow = {
    ...stamped,
    title: fixMojibake(stamped.title ?? ""),
    detail: fixMojibake(stamped.detail ?? ""),
    role: s(stamped.role) ?? null,
    company: s(stamped.company) ?? null,
    email: s(stamped.email) ?? null,
    phone: s(stamped.phone) ?? null,
    source_url: sourceUrl ?? (sourceIsDiscovery ? legacyUrl : null),
    website_url: websiteUrl,
    profile_url: profileUrl,
    apply_url: applyUrl,
    url: destination ?? null,
    category: s(stamped.category) ?? null,
    location: s(stamped.location) ?? null,
    country: s(stamped.country) ?? null,
    sector: s(stamped.sector) ?? null,
    industry: s(stamped.industry) ?? null,
    stage: s(stamped.stage) ?? null,
    check: s(stamped.check) ?? null,
    why_match: s(stamped.why_match) ?? null,
  };
  const miss = missingRequiredFields({
    kind: out.kind,
    title: out.title,
    detail: out.detail,
    email: out.email,
    phone: out.phone,
    url: out.url,
    location: out.location,
    country: out.country,
    category: out.category,
    industry: out.industry,
    opportunity: out.opportunity,
  });
  out.missingFields = miss;
  out.complete = miss.length === 0;
  return out;
}

const QUESTION_TEMPLATES: Record<string, (spec: SearchSpec) => string> = {
  entity: () => "Are you looking for people, companies, local businesses, or investors?",
  role: (s) =>
    `Got it — “${subjectFromQuery(s.raw_query, s.entity)}”. What role or title (e.g. founder, CTO)?`,
  category: (s) =>
    s.entity === "business"
      ? `You're looking for businesses. What type of businesses (e.g. cafes, plumbers, dentists)?`
      : `Which industry or category for “${subjectFromQuery(s.raw_query, s.entity)}”?`,
  industry: (s) =>
    `Understood — “${subjectFromQuery(s.raw_query, s.entity)}”. Any particular industry, or all?`,
  business_model: (s) =>
    `For “${subjectFromQuery(s.raw_query, s.entity)}”, any business model (agency, brand, D2C, B2B, B2C), or all?`,
  seniority: () => "What seniority level (e.g. junior, senior, lead)?",
  employment: () => "What employment type (e.g. full-time, part-time, contract, remote)?",
  location: (s) =>
    `You're looking for ${subjectFromQuery(s.raw_query, s.entity)}. Which location (city, region, or country)?`,
  investor_stage: () => "Which stage should the investor cover (e.g. pre-seed, seed)?",
  investor_sector: () => "Which sector should the investors cover?",
  investor_check: () => "Rough check size (e.g. angel, seed, growth)?",
};

/** Ordered high-value questions for actually-missing fields only. */
export function questionsForMissing(spec: SearchSpec): string[] {
  const order = [
    "entity",
    "role",
    "category",
    "industry",
    "business_model",
    "seniority",
    "employment",
    "investor_stage",
    "investor_sector",
    "investor_check",
    "location",
  ];
  return order
    .filter((f) => spec.missing.includes(f) && QUESTION_TEMPLATES[f])
    .map((f) => QUESTION_TEMPLATES[f](spec));
}

/**
 * UI-ready clarification questions (ClarifyPanel shape) for a spec.
 * Empty when nothing is materially missing (search proceeds immediately).
 */
export async function clarifyQuestionsForSpec(
  spec: SearchSpec,
): Promise<import("@/lib/search/clarifier").ClarifyQuestion[]> {
  const { entityQuestionsForSpec } = await import("@/lib/search/clarifier");
  return entityQuestionsForSpec(spec);
}

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const like = (v: unknown, needle: string) =>
  typeof v === "string" && v.toLowerCase().includes(needle.toLowerCase());

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c ? c.value : null;
}

/** Coverage matrix (Phase 1.7): generated artifact, cached after first read.
 *  Absent/unreadable → empty matrix: the selector degrades to hot-first with
 *  everything else skipped, and says so in the coverage log. */
let COVERAGE_MATRIX_CACHE: CoverageMatrix | undefined;
let COVERAGE_MATRIX_MISSING_LOGGED = false;
async function loadCoverageMatrix(): Promise<CoverageMatrix> {
  if (COVERAGE_MATRIX_CACHE !== undefined) return COVERAGE_MATRIX_CACHE;
  try {
    // Dynamic import: works under ESM (tsx/server) and CJS (vitest).
    // Static require() throws under ESM — the previous loader silently
    // degraded to an empty matrix on the live path (acceptance caught it).
    const fs = await import("node:fs").then((m) => m as typeof import("node:fs"));
    const path = await import("node:path").then((m) => m as typeof import("node:path"));
    const candidates = [path.join(process.cwd(), "data", "coverage-matrix.json")];
    for (const p of candidates) {
      try {
        COVERAGE_MATRIX_CACHE = JSON.parse(fs.readFileSync(p, "utf-8")) as CoverageMatrix;
        return COVERAGE_MATRIX_CACHE;
      } catch {
        continue;
      }
    }
  } catch {
    // Non-node runtime: degrade to empty matrix (logged by the executor).
  }
  COVERAGE_MATRIX_CACHE = { entities: {} };
  if (!COVERAGE_MATRIX_MISSING_LOGGED) {
    COVERAGE_MATRIX_MISSING_LOGGED = true;
    console.warn(
      "[coverage] matrix-missing: data/coverage-matrix.json unreadable — selector degrades to hot-first",
    );
  }
  return COVERAGE_MATRIX_CACHE;
}

/** Bounded tier execution: a hung source can delay one query by at most its
 *  budget, never the whole search. Timeout errors propagate to the caller,
 *  which logs the stage and continues to the next tier. */
function withTierTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`tier timeout: ${label} after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (t !== undefined) clearTimeout(t);
  });
}

/**
 * Business-model signals (Phase 2 taxonomy): normalized model value →
 * text patterns that count as a match in a row's own fields. Lenient by
 * design (substring over title/detail/category) — the DB has no dedicated
 * model column, so the row's own wording is the judge.
 */
const BUSINESS_MODEL_SIGNALS: Record<string, RegExp> = {
  agency: /agenc(y|ies)/i,
  brand: /brand/i,
  d2c: /d2c|\bdtc\b|direct[- ]to[- ]consumer/i,
  b2b: /b2b|business[- ]to[- ]business|wholesale|enterprise/i,
  b2c: /b2c|business[- ]to[- ]consumer|retail/i,
};

export function businessModelMatches(rowText: string, model: string): boolean {
  const re = BUSINESS_MODEL_SIGNALS[model.toLowerCase().trim()];
  if (!re) return true; // unknown model value: never reject on it
  return re.test(rowText);
}

/** Result-correctness validation: every displayed row must satisfy the spec.
 *  Uses the row's OWN category/location fields with craft-aware matching
 *  (never raw title substring alone) — the DB reader already filtered, so
 *  this catches misassigned/empty rows. Fixed the bug where 50 fetched
 *  dentists were all rejected because clinic names lack the word "dentists". */
export function rowSatisfiesSpec(spec: SearchSpec, row: SpecRow): boolean {
  if (spec.entity === "person") {
    const role = fieldOf(spec, "role");
    const industry = fieldOf(spec, "industry");
    const location = fieldOf(spec, "location");
    if (role && !personRoleMatches(row.role ?? row.title, role))
      return false;
    if (industry && !like(row.industry ?? row.detail, industry) && !( /^saas$/i.test(industry) && /software[ -]as[ -]a[ -]service/i.test(row.industry ?? "") )) return false;
    if (location && !locationOk(row.country, row.location, row.detail, location)) return false;
  }
  if (spec.entity === "business") {
    const cat = fieldOf(spec, "category");
    const location = fieldOf(spec, "location");
    const requestedGeo = location ? resolveCanonicalLocation(location) : null;
    if (cat && !craftMatches(row.category, cat) && !like(row.title, cat) && !like(row.detail, cat))
      return false;
    const model = fieldOf(spec, "business_model");
    if (
      model &&
      !businessModelMatches(
        `${row.title ?? ""} ${row.detail ?? ""} ${row.category ?? ""}`,
        model,
      )
    )
      return false;
    if (location && requestedGeo?.kind === "metro") {
      if (!locationSatisfies(row.location ?? row.detail ?? "", requestedGeo)) return false;
    } else if (location) {
      const isoList = COUNTRY_ISO[location.toLowerCase().trim()];
      if (isoList) {
        // Country query ("Canada"): strict ISO gate. DB stores "CA",
        // never "Canada", so text match alone rejects everything.
        const rowIso = (row.country ?? "").toLowerCase().trim();
        const isoOk = isoList.some((s) => rowIso === s || (rowIso && rowIso.includes(s)));
        const nameOk = like(row.location ?? "", location) || like(row.detail, location);
        if (!isoOk && !nameOk) return false;
      } else {
        // City query: when the city maps to a known country, the row must
        // carry that country (ISO) or name the city — Jamnagar rows must
        // never pass a Dhaka query even if a misrouted reader served them.
        // Unknown cities keep the lenient rule (reader-gated).
        const hint = countryHintForCity(location);
        const rowIso = (row.country ?? "").toLowerCase().trim();
        if (hint) {
          const isoOk = !!rowIso && rowIso === hint.toLowerCase();
          const nameOk = like(row.location ?? "", location) || like(row.detail, location);
          // The city is proof; a populated country is only a disambiguation
          // guard. Providers such as OSM often omit country on exact-city rows.
          if (!nameOk || (rowIso.length > 0 && !isoOk)) return false;
        } else if (
          !like(row.country ?? "", location) &&
          !like(row.location ?? "", location) &&
          !like(row.detail, location) &&
          !(row.country ?? row.location)
        )
          return false;
      }
    }
  }
  if (spec.entity === "company") {
    const cat = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
    if (
      cat &&
      !companyCategoryMatches(row.category ?? row.title, cat) &&
      !companyCategoryMatches(row.detail, cat)
    ) return false;
    const model = fieldOf(spec, "business_model");
    if (
      model &&
      !businessModelMatches(
        `${row.title ?? ""} ${row.detail ?? ""} ${row.category ?? ""}`,
        model,
      )
    )
      return false;
    const location = fieldOf(spec, "location");
    if (location && !locationOk(row.country, row.location, row.detail, location)) return false;
  }
  if (spec.entity === "investor") {
    const sector = fieldOf(spec, "investor_sector") ?? fieldOf(spec, "industry");
    const stage = fieldOf(spec, "investor_stage");
    const check = fieldOf(spec, "investor_check");
    const location = fieldOf(spec, "location");
    // Broad-then-enrich: stored sector strings are curated mega-tokens; match
    // ANY content token of the requested focus ("AI infrastructure startups").
    if (sector && !investorSectorMatches(row.sector ?? row.detail, sector) && !like(row.title, sector)) return false;
    if (stage && !like(row.stage ?? row.detail, stage)) return false;
    if (check && !like(row.check ?? row.detail, check)) return false;
    if (location && !locationOk(row.country, row.location, row.detail, location)) return false;
  }
  if (spec.entity === "job") {
    // Registry pre-filtered by role/location; validation re-checks against
    // the row's own fields (same anti-hallucination contract as entities).
    // Seniority/employment are optional refinements: enforced only when the
    // user stated them, matched leniently against title/detail.
    const role = fieldOf(spec, "role");
    const location = fieldOf(spec, "location");
    const seniority = fieldOf(spec, "seniority");
    const employment = fieldOf(spec, "employment");
    if (role && !role.toLowerCase().split(/\s+/).every((term) => term && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(row.title))) return false;
    if (location && !locationOk(row.country, row.location, row.detail, location)) return false;
    if (seniority && !like(row.title, seniority) && !like(row.detail, seniority)) return false;
    if (employment && !like(row.title, employment) && !like(row.detail, employment)) {
      // "remote" also matches an explicit Remote marker in the detail line.
      if (!(employment.toLowerCase() === "remote" && /\bremote\b/i.test(row.detail))) return false;
    }
  }
  return true;
}

/** Role wording that counts as an explicitly stated role on a person row. */
const ROLE_WORD_RE =
  /\b(founder|co-?founder|ceo|cto|cfo|coo|owner|partner|president|director|head\s+of|engineer|developer|designer|manager|consultant|accountant|attorney|lawyer|dentist|plumber|electrician|realtor|recruiter|marketer|freelancer|photographer|architect)\b/i;

/**
 * Pre-research gate: reject KNOWN HARD CONTRADICTIONS only. Unknown is
 * researchable — a partial candidate may be missing exactly the facts
 * (role/industry/location/website/contact) that enrichment exists to
 * establish. Strict rowSatisfiesSpec stays the post-research judge; this
 * gate only decides whether a candidate survives INTO research.
 */
export function rowCouldSatisfySpec(spec: SearchSpec, row: SpecRow): boolean {
  if (spec.entity === "person") {
    const role = fieldOf(spec, "role");
    const industry = fieldOf(spec, "industry");
    const location = fieldOf(spec, "location");
    if (role) {
      const explicitRole =
        (row.role && row.role.trim()) ||
        (row.title && ROLE_WORD_RE.test(row.title) ? row.title : null);
      if (explicitRole && !personRoleMatches(explicitRole, role)) return false;
    }
    if (
      industry &&
      row.industry &&
      row.industry.trim() &&
      !like(row.industry, industry) &&
      !(/^saas$/i.test(industry) && /software[ -]as[ -]a[ -]service/i.test(row.industry))
    )
      return false;
    if (location && (row.location || row.country) && !locationOk(row.country, row.location, "", location))
      return false;
    return true;
  }
  if (spec.entity === "business") {
    const cat = fieldOf(spec, "category");
    const location = fieldOf(spec, "location");
    if (
      cat &&
      row.category &&
      row.category.trim() &&
      !craftMatches(row.category, cat) &&
      !like(row.title, cat) &&
      !like(row.detail, cat)
    )
      return false;
    if (location && (row.location || row.country) && !locationOk(row.country, row.location, "", location))
      return false;
    return true;
  }
  if (spec.entity === "company") {
    const cat = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
    const location = fieldOf(spec, "location");
    if (
      cat &&
      row.category &&
      row.category.trim() &&
      !companyCategoryMatches(row.category, cat) &&
      !companyCategoryMatches(row.detail, cat) &&
      !like(row.title, cat)
    )
      return false;
    if (location && (row.location || row.country) && !locationOk(row.country, row.location, "", location))
      return false;
    return true;
  }
  // investor/job rows are structured enough that strict validation is the
  // contradiction judge; no researchable-unknown gap has been shown there.
  return rowSatisfiesSpec(spec, row);
}

/**
 * Shared location gate: metro-aware (GTA rows may say "Toronto"), ISO-aware
 * for known countries ("Canada" matches "CA"), substring otherwise. Used by
 * person/company/investor validation so every entity enforces location the
 * same way.
 */
function locationOk(
  country: string | null | undefined,
  location: string | null | undefined,
  detail: string,
  want: string,
): boolean {
  // Metro asks (GTA, Bay Area, …): member-city rows satisfy even though the
  // literal metro name never appears on the row. Mirrors the business
  // branch's metro-aware locationSatisfies check.
  const wantGeo = resolveCanonicalLocation(want);
  if (wantGeo?.kind === "metro") {
    return locationSatisfies(location ?? detail ?? "", wantGeo) || locationSatisfies(detail ?? "", wantGeo);
  }
  const isoList = COUNTRY_ISO[want.toLowerCase().trim()];
  if (isoList) {
    const rowIso = (country ?? "").toLowerCase().trim();
    const isoOk = isoList.some((s) => rowIso === s || (rowIso && rowIso.includes(s)));
    const nameOk = like(location ?? "", want) || like(detail, want);
    return isoOk || nameOk;
  }
  return like(country ?? "", want) || like(location ?? "", want) || like(detail, want);
}

export interface SpecSearchResult {
  spec: SearchSpec;
  executionPlan?: import("@/lib/search/source-plan").SourcePlan;
  providerAttempts?: import("@/lib/search/source-plan").ProviderDiagnostic[];
  questions: string[];
  clarify: import("@/lib/search/clarifier").ClarifyQuestion[];
  rows: SpecRow[];
  dbMeta: DbHitMeta[];
  /** Rows rejected by validation (transparency, not silent). */
  rejected: number;
  /**
   * Live discovery status:
   * - not_required: DB enough, no signal required
   * - completed: live gapfill ran
   * - db_thin_gapfill_pending: still thin after live (honest empty / refine)
   * - required_pending_phase7: legacy alias kept for older clients (= completed attempt)
   */
  liveDiscovery:
    | "not_required"
    | "completed"
    | "db_thin_gapfill_pending"
    | "required_pending_phase7";
  /** Incomplete rows held for enrichment (not on the first page). */
  pendingEnrichment?: number;
  /** Conversational hint when more verified leads exist beyond this page. */
  moreAvailableMessage?: string | null;
  /** Pagination (Phase 1.8): `limit` is PAGE SIZE ONLY — never a ceiling on
   *  the result set. Offset counts validated matches; load more until
   *  hasMore is false. totalAvailable is null by design: exact totals cost a
   *  second full scan per search (doubling retrieval RU); hasMore is exact. */
  offset: number;
  limit: number;
  hasMore: boolean;
  totalAvailable: number | null;
  /** M3 run identity — every result belongs to this run. */
  search_run_id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  /** Typed overall outcome (never bare “0 results”). */
  outcome: import("@/lib/search/canonical-contract").SearchOutcomeCode;
  /** Provider/source failures that did not set the overall outcome. */
  diagnostics?: Array<{
    code: import("@/lib/search/canonical-contract").SearchOutcomeCode;
    source?: string;
    detail?: string;
  }>;
  /** Qualified count after theorem (delivery/counting denominator). */
  qualified_count: number;
  /** Off-topic domain boundary copy when the request is out of scope. */
  boundary_message?: string;
  /** Internal stage accounting so an empty response has a factual cause. */
  retrievalTrace?: {
    sources: Array<{ source: string; partitions: string[]; scanned: number; matched: number }>;
    /** Stage timings (performance observability, DEV). */
    timings?: {
      understanding_ms: number;
      stored_search_ms: number;
      research_ms: number;
      enrichment_ms: number;
      qualification_ms: number;
      total_ms: number;
    };
    rawCandidates: number;
    postSpecFilter: number;
    /** Candidates that entered query-aware enrichment (complete + researchable). */
    researchable?: number;
    /** Rows that came back through enrichment (researched candidates). */
    researched?: number;
    complete: number;
    pendingEnrichment: number;
    qualificationRejected: number;
    /** Theorem-qualified rows after the final gate. */
    qualified?: number;
    returned: number;
    reason: "NO_DATA" | "NO_PARTITION" | "NO_INDEX_COVERAGE" | "NO_LOCATION_ROUTE" |
      "NO_CATEGORY_MATCH" | "NO_ROLE_MATCH" | "FILTERED_BY_SPEC" | "INCOMPLETE" |
      "FAILED_ENRICHMENT" | "FAILED_VERIFICATION" | "FAILED_QUALIFICATION" | "TIMEOUT" |
      "SOURCE_UNAVAILABLE" | "RESULTS";
  };
}

/**
 * Uniform page slicing (Phase 1.8). hasMore is exact: either a source hit
 * its fetch cap (more may exist beyond the window) or validated matches
 * overflow the page. No global result ceiling anywhere in this path.
 */
function applyPage(
  kept: SpecRow[],
  args: { offset: number; limit: number; fetchedHitCap: boolean },
): { page: SpecRow[]; hasMore: boolean } {
  const page = kept.slice(args.offset, args.offset + args.limit);
  return { page, hasMore: args.fetchedHitCap || kept.length > args.offset + args.limit };
}

/** Practical per-request bound (Phase 1.8): offset counts matches, so deep
 *  S3 pages scan linearly. 5000 (≈50 pages of 100) stops runaway scans;
 *  it bounds single-request work, NOT the discoverable result set. */
const MAX_OFFSET = 5000;

/** OSM craft-tag → canonical craft (provider mapper honesty layer).
 *  Overpass rows arrive with raw OSM tags (dental_clinic, fast_food); the
 *  validator only understands canonical crafts, so tags are normalized here
 *  with reviewable rules. Unknown tags fall back to the queried skill (the
 *  Overpass query itself was craft-directed, so provenance is real). */
const OSM_CRAFT_EXACT: Record<string, string> = {
  dentist: "dentist",
  dental_clinic: "dentist",
  plumbing: "plumber",
  plumber: "plumber",
  restaurant: "restaurant",
  fast_food: "restaurant",
  cafe: "cafe",
  bakery: "bakery",
  hotel: "hotel",
  barber: "barber",
  electrician: "electrician",
  lawyer: "lawyer",
  florist: "florist",
  gym: "gym",
  pharmacy: "pharmacy",
  car_repair: "automotive_repair",
  car_dealer: "car_dealer",
};
const OSM_CRAFT_CONTAINS: Array<[RegExp, string]> = [
  [/dental/i, "dentist"],
  [/plumb/i, "plumber"],
  [/pizza/i, "pizza_restaurant"],
  [/burger/i, "burger_restaurant"],
  [/restaurant|bistro|brasserie/i, "restaurant"],
  [/caf[eé]|coffee/i, "cafe"],
  [/hotel|guest_house|hostel|motel/i, "hotel"],
  [/barber|hair|beauty|salon|spa/i, "salon"],
  [/gym|fitness|yoga/i, "gym"],
  [/auto|car|garage|tyre|tire/i, "automotive_repair"],
  [/bakery|bread/i, "bakery"],
  [/florist|flower/i, "florist"],
  [/electr/i, "electrician"],
  [/law|attorney|legal/i, "lawyer"],
  [/pharma|drugstore/i, "pharmacy"],
];

export function normaliseOsmCraft(tag: string, skillFallback: string): string {
  const t = (tag ?? "").trim().toLowerCase();
  if (!t) return skillFallback;
  if (OSM_CRAFT_EXACT[t]) return OSM_CRAFT_EXACT[t];
  for (const [re, craft] of OSM_CRAFT_CONTAINS) {
    if (re.test(t)) return craft;
  }
  return skillFallback;
}

/** S3 tier fetch+map (Phase 1.7): single owner for the legacy order and the
 *  coverage-planned path. Bodies moved verbatim from the former inline
 *  branches — same readers, same args, same mapping. Returns meta null when
 *  the entity has no S3 branch (unknown entities leave rows untouched). */
async function fetchS3Tier(
  spec: SearchSpec,
  readers: {
    people: typeof searchPeopleDB;
    companies: typeof searchCompaniesDB;
    businesses: typeof searchBusinessesDB;
    investors: typeof searchInvestorsDB;
  },
  params: {
    role: string | null;
    industry: string | null;
    location: string | null;
    category: string | null;
    limit: number;
    signal?: AbortSignal | null;
    deadline?: number;
  },
): Promise<{ rows: SpecRow[]; meta: DbHitMeta | null }> {
  const { role, industry, location, category, limit } = params;
  const { people, companies, businesses, investors } = readers;
  if (spec.entity === "job") {
    return {
      rows: [],
      meta: {
        dbHit: false,
        engine: "s3-parquet",
        partitionsRead: ["(stored_source_unavailable: jobs have no stored corpus)"],
        rowsScanned: 0,
        rowsReturned: 0,
      },
    };
  }
  if (spec.entity === "person") {
    const locationKind = fieldOf(spec, "location_kind");
    const locationCountry = fieldOf(spec, "location_country");
    const countryQuery = locationKind === "country" ? location : locationCountry;
    const cityQuery = locationKind === "country" ? null : location;
    const r = await people({
      role: role ?? undefined,
      industry: industry ?? undefined,
      country: countryQuery ?? undefined,
      city: cityQuery ?? undefined,
      limit,
      signal: params.signal,
      deadline: params.deadline,
    });
    return {
      rows: r.rows.map((p, i) => {
        const entity_id = `db:person:${(p.name ?? "x").toLowerCase().replace(/\s+/g, "-").slice(0, 48)}:${i}`;
        // Structured people-index rows are employment facts (name/title/company),
        // not page co-mention — attach evidence-backed person↔org so M12 gates
        // can qualify without inventing relationships from free text.
        const evidence: Evidence[] = [];
        const company = (p.company_name ?? "").trim();
        const title = (p.title ?? "").trim();
        if (company) {
          const orgSlug = company
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48);
          evidence.push(
            makeEvidence({
              source_url:
                p.personal_linkedin?.trim() ||
                `db://people/${entity_id}`,
              source_type: "db",
              excerpt: title
                ? `${title} at ${company}`
                : `Associated with ${company}`,
              evidence_type: "identity",
              supports: "identity",
              subject: entity_id,
              claim_parameters: {
                role: title ? normalizeRole(title) : "employee",
                organization_entity_id: `company:${orgSlug || "unknown"}`,
                organization_name: company,
                role_currentness: "current_role",
                relationship: /\bfounder\b/i.test(title) ? "founder" : "employment",
              },
            } as unknown as Evidence & { claim_parameters: Record<string, string> }),
          );
        }
        return {
          kind: "person" as const,
          key: entity_id,
          entity_id,
          entity_resolved: true,
          page_type: "person_page" as const,
          identity_confidence: 0.85,
          role: title,
          company,
          title: `${p.name ?? "?"} — ${p.title ?? "?"} @ ${p.company_name ?? "?"}`,
          detail: [company, p.city, p.country, p.industry, p.website].filter(has).join(" · "),
          email: p.email,
          phone: checkPhone(p.phone, p.country ?? "").phone,
          phoneStatus: checkPhone(p.phone, p.country ?? "").status,
          url: p.personal_linkedin,
          profile_url: p.personal_linkedin,
          industry: p.industry,
          country: p.country,
          location: p.city ?? p.country,
          evidence,
        };
      }),
      meta: r.meta,
    };
  }
  if (spec.entity === "company") {
    const r = await companies({
      category: category ?? industry ?? undefined,
      location: location ?? undefined,
      limit,
    });
    return {
      rows: r.rows.map((c, i) => {
        const entity_id =
          (c as { registry_id?: string }).registry_id?.trim() ||
          `db:company:${(c.company_name ?? "x").toLowerCase().replace(/\s+/g, "-").slice(0, 48)}:${i}`;
        return {
          kind: "company" as const,
          key: entity_id,
          entity_id,
          entity_resolved: true,
          page_type: "company_page" as const,
          title: `${c.company_name ?? "?"} — ${c.category ?? ""}`,
          detail: [c.location, c.website].filter(has).join(" · "),
          email: c.email,
          phone: checkPhone(c.phone, "").phone,
          phoneStatus: checkPhone(c.phone, "").status,
          url: c.website,
          website_url: c.website,
          category: c.category,
          location: c.location,
          opportunity: fieldOf(spec, "opportunity"),
        };
      }),
      meta: r.meta,
    };
  }
  if (spec.entity === "business") {
    const requestedGeo = location ? resolveCanonicalLocation(location) : null;
    const readerLocation = requestedGeo?.kind === "metro"
      ? requestedGeo.member_ids.find((id) => id.startsWith("geo:city:"))?.slice("geo:city:".length) ?? location
      : location;
    const r = await businesses({
      category: category ?? undefined,
      location: readerLocation ?? undefined,
      limit,
    });
    return {
      rows: r.rows.map((b, i) => {
        const entity_id =
          b.registry_id?.trim() ||
          `db:business:${(b.name ?? "x").toLowerCase().replace(/\s+/g, "-").slice(0, 48)}:${i}`;
        return {
          kind: "business" as const,
          key: entity_id,
          entity_id,
          entity_resolved: true,
          page_type: "entity_page" as const,
          title: b.name ?? "?",
          // Full geo so cards + validation see city/region/country, not just street.
          detail: formatPlace([b.address, b.locality, b.region, b.country]),
          email: b.email ?? null,
          phone: checkPhone(b.phone, b.country ?? "").phone,
          phoneStatus: checkPhone(b.phone, b.country ?? "").status,
          url: b.website,
          website_url: b.website,
          source_url: `db://businesses/${encodeURIComponent(entity_id)}`,
          category: b.category,
          location:
            formatPlace([b.locality, b.region]) || b.locality || b.region || null,
          country: b.country,
          opportunity: fieldOf(spec, "opportunity"),
          evidence: [makeEvidence({
            source_url: `db://businesses/${encodeURIComponent(entity_id)}`,
            source_type: "db",
            excerpt: [b.name, b.category, formatPlace([b.locality, b.region]), b.phone ? `phone ${b.phone}` : null].filter(Boolean).join(" · "),
            evidence_type: "identity",
            supports: "identity",
            extraction_method: "stored_business_record",
            subject: entity_id,
          })],
        };
      }),
      meta: r.meta,
    };
  }
  if (spec.entity === "investor") {
    const sector = fieldOf(spec, "investor_sector") ?? industry;
    const stage = fieldOf(spec, "investor_stage");
    const check = fieldOf(spec, "investor_check");
    const r = await investors({
      sector: sector ?? undefined,
      stage: stage ?? undefined,
      check: check ?? undefined,
      location: location ?? undefined,
      limit,
    });
    return {
      rows: r.rows.map((v, i) => {
        const rowSectors = (v.sectors ?? []).join(" ");
        const rowStages = (v.stages ?? []).join(" ");
        const entity_id = `db:investor:${(v.name ?? "x").toLowerCase().replace(/\s+/g, "-").slice(0, 48)}:${i}`;
        return {
          kind: "investor" as const,
          key: entity_id,
          entity_id,
          entity_resolved: true,
          page_type: "entity_page" as const,
          title: `${v.name ?? "?"} — ${v.role ?? ""} @ ${v.firm ?? "?"}`,
          detail: [v.location_raw, rowSectors, v.website].filter(has).join(" · "),
          email: v.email,
          phone: null,
          sector: rowSectors || null,
          stage: rowStages || null,
          check:
            typeof v.check_min_usd === "number" || typeof v.check_max_usd === "number"
              ? [v.check_min_usd, v.check_max_usd].filter((x) => typeof x === "number").join("-")
              : rowStages || null,
          // Prefer the most specific place for Spec location gating (M6).
          // country alone cannot satisfy a city Spec (UK ⊭ London).
          location: v.location_city ?? v.location_raw ?? v.location_country,
          country: v.location_country,
          // A public profile is a usable investor contact route when a firm
          // site is absent; do not discard the 8k-row corpus on website alone.
          url: v.website ?? v.linkedin,
          website_url: v.website,
          profile_url: v.linkedin,
        };
      }),
      meta: r.meta,
    };
  }
  return { rows: [], meta: null };
}

export async function runSpecSearchCore(
  query: string,
  deps: SpecSearchDeps = {},
  limit = 25,
  answers: Record<string, string> = {},
  opts: {
    force?: boolean;
    offset?: number;
    /** M3 run identity — if omitted, a new run is minted. */
    search_run_id?: string;
    conversation_id?: string;
    turn_id?: string;
    request_id?: string;
  } = {},
): Promise<SpecSearchResult> {
  const { createSearchRun, finalizeSearchOutcome, throwIfAborted, searchAbortCode } = await import(
    "@/lib/search/search-run"
  );
  const runIds = createSearchRun({
    search_run_id: opts.search_run_id,
    conversation_id: opts.conversation_id,
    turn_id: opts.turn_id,
    request_id: opts.request_id,
  });
  const runStartedAt = Date.now();
  let understandingDoneAt = runStartedAt;
  let liveDoneAt = runStartedAt;
  let enrichDoneAt = runStartedAt;
  const routeDiagnostics: Array<{
    code: import("@/lib/search/canonical-contract").SearchOutcomeCode;
    source?: string;
    detail?: string;
  }> = [];
  const withRun = <T extends Record<string, unknown>>(
    partial: T,
    qualifiedCount = 0,
    cancelled = false,
  ): SpecSearchResult => {
    const fin = finalizeSearchOutcome(routeDiagnostics, {
      cancelled,
      qualifiedCount,
      unsupported: false,
    });
    return {
      questions: [],
      clarify: [],
      rows: [],
      dbMeta: [],
      rejected: 0,
      liveDiscovery: "not_required",
      pendingEnrichment: 0,
      moreAvailableMessage: null,
      offset: 0,
      limit,
      hasMore: false,
      totalAvailable: null,
      ...partial,
      ...runIds,
      outcome: cancelled ? "SEARCH_CANCELLED" : fin.outcome,
      diagnostics: fin.diagnostics,
      qualified_count: qualifiedCount,
    } as unknown as SpecSearchResult;
  };

  if (deps.signal?.aborted) {
    const { extractSearchSpec: extract } = await import("@/lib/search/search-spec-extract");
    return withRun(
      {
        spec: extract(query),
        questions: [],
        clarify: [],
        rows: [],
        dbMeta: [],
        rejected: 0,
        liveDiscovery: "not_required",
        offset: 0,
        limit,
        hasMore: false,
        totalAvailable: null,
      },
      0,
      true,
    );
  }
  const effOffset = Math.min(MAX_OFFSET, Math.max(0, Math.floor(opts.offset ?? 0)));
  // Fetch window: offset + one page + one probe row (hasMore exactness).
  // Capped by MAX_OFFSET above so deep pages stay bounded per request.
  const fetchWindow = effOffset + limit + 1;
  const pageInfo = {
    offset: effOffset,
    limit,
    hasMore: false,
    totalAvailable: null as number | null,
  };
  const { understandSearchSpec, isActionableFrame } = await import("@/lib/understanding/to-search-spec");
  const base = await understandSearchSpec(query, answers, deps.signal);
  understandingDoneAt = Date.now();
  if (deps.signal?.aborted) return withRun({ spec: base, ...pageInfo }, 0, true);
  // Merge prior answers as stated criteria (multi-turn without session store).
  const criteria = [...base.criteria];
  for (const [field, value] of Object.entries(answers)) {
    const v = (value ?? "").trim();
    if (!v) continue;
    const i = criteria.findIndex((c) => c.field === field);
    const stated = { field, value: v, stated: true, confidence: 1 };
    if (i >= 0) criteria[i] = stated;
    else criteria.push(stated);
  }
  const { buildSpec } = await import("@/lib/search/search-spec");
  // Structured entity answer (unknown-entity clarify round): the deterministic
  // understanding fallback cannot read prior-answer context, so the entity
  // pick types the spec here. Option-label and canonical forms both accepted.
  const entityAnswer = (answers["entity"] ?? "").trim().toLowerCase();
  const ENTITY_ANSWER_ALIASES: Record<string, SearchSpec["entity"]> = {
    people: "person",
    person: "person",
    companies: "company",
    company: "company",
    "local businesses": "business",
    "local-businesses": "business",
    business: "business",
    investors: "investor",
    investor: "investor",
    jobs: "job",
    job: "job",
  };
  const entityPick = ENTITY_ANSWER_ALIASES[entityAnswer];
  const spec: SearchSpec = {
    ...base,
    criteria,
    ...(entityPick && base.entity === "unknown" ? { entity: entityPick } : {}),
  };
  // Off-topic boundary: a clearly out-of-domain request ("what's the weather
  // in Paris") gets a one-line product boundary — never retrieval, never
  // Scrapy, never a clarification round about people vs companies.
  const OFF_TOPIC_RE =
    /\b(weather|forecast|temperature|recipe|recipes|horoscope|lyrics|translate|translation|showtimes?|stock (?:price|quote)|sports scores?)\b/i;
  const DOMAIN_NOUN_RE =
    /\b(investors?|founders?|startups?|companies|company|businesses|business|jobs?|leads?|hire|hiring|clients?|customers?|prospects?|vcs?|angels?|funds?)\b/i;
  if (OFF_TOPIC_RE.test(query) && !DOMAIN_NOUN_RE.test(query)) {
    routeDiagnostics.push({
      code: "UNSUPPORTED_CAPABILITY",
      source: "domain-router",
      detail:
        "Scrapivo is built for finding and researching people, companies, local businesses, jobs, and investors. Try one of those instead.",
    });
    return withRun({
      spec,
      questions: [],
      clarify: [],
      rows: [],
      ...pageInfo,
      boundary_message:
        "Scrapivo is built for finding and researching people, companies, local businesses, jobs, and investors. Try one of those instead.",
    } as SpecSearchResult, 0, false);
  }
  const { computeMissing } = await import("@/lib/search/search-spec");
  spec.missing = computeMissing(spec);
  spec.status = spec.missing.length ? "needs_clarification" : "ready_to_search";
  // Explicit user command ("Search" button): proceed with stated criteria even
  // when optional fields are still missing. Unknown entity still clarifies.
  const forcedReady = !!opts.force && spec.entity !== "unknown";
  if (forcedReady) spec.status = "ready_to_search";
  // Mode gate (Phase 1.3): directory hunts state browsing-vs-selling BEFORE
  // retrieval — never results first. Missing-field specs keep their panel;
  // once ready, an unstated mode blocks with exactly one question. The offer
  // question follows ONLY a selling answer, so just-looking never sees it.
  // Explicit "Search" (force) and investor/unknown entities bypass the gate.
  if (!opts.force && !isActionableFrame(spec) && isDirectoryEntity(spec.entity) && spec.status === "ready_to_search") {
    const modeCrit = criteria.find((c) => c.field === "mode");
    const offerCrit = criteria.find((c) => c.field === "offer");
    let mode = detectModeFromQuery(query);
    let gateOffer: string | undefined;
    if (modeCrit && modeCrit.value.trim()) {
      const interpreted = interpretModeAnswer(modeCrit.value);
      mode = interpreted.mode;
      gateOffer = interpreted.offer;
    }
    // Seller-side criteria stated by the understanding layer imply the mode:
    // consumers don't hunt "without a website" — prospectors do. Business and
    // company entities only; person hiring queries stay ambiguous (ask).
    if (
      !mode &&
      (spec.entity === "business" || spec.entity === "company") &&
      fieldOf(spec, "opportunity") === "no_website"
    ) {
      mode = "selling";
    }
    const gateReturn = (clarify: import("@/lib/search/clarifier").ClarifyQuestion[]) => {
      if (typeof console !== "undefined") {
        console.info(
          "[spec-run] " +
            JSON.stringify({
              query,
              entity: spec.entity,
              mode: mode ?? null,
              status: spec.status,
              outcome: "mode-gate",
              search_run_id: runIds.search_run_id,
            }),
        );
      }
      return withRun({
        spec,
        questions: questionsForMissing(spec),
        clarify,
        rows: [],
        dbMeta: [],
        rejected: 0,
        liveDiscovery: "not_required" as const,
        ...pageInfo,
        outcome: "NO_QUALIFIED_RESULTS",
      });
    };
    if (!mode) {
      return gateReturn([
        entityModeQuestion(
          spec.entity as "person" | "company" | "business",
          subjectFromQuery(query, spec.entity),
        ),
      ]);
    }
    // Free-text mode answer that already names the offering ("websites")
    // counts as the offer: no redundant offer round.
    if (mode === "selling" && !(offerCrit && offerCrit.value.trim()) && gateOffer) {
      criteria.push({ field: "offer", value: gateOffer, stated: true, confidence: 1 });
      spec.criteria = criteria;
    }
    // Query-stated offering (Phase 1.4): "…without a website", "web design
    // clients…" names the pitch, so selling + offer are both known with zero
    // questions. People entities are EXCLUDED (hiring ambiguity: "hire a web
    // designer" is looking, not selling).
    if (
      mode === "selling" &&
      spec.entity !== "person" &&
      !criteria.some((c) => c.field === "offer" && c.value.trim())
    ) {
      const inferredId = inferOfferingId(query);
      const inferred = inferredId ? offeringById(inferredId) : null;
      if (inferred) {
        criteria.push({ field: "offer", value: inferred.label, stated: true, confidence: 0.9 });
        spec.criteria = criteria;
      }
    }
    if (mode === "selling" && !criteria.some((c) => c.field === "offer" && c.value.trim())) {
      return gateReturn([entityOfferQuestion(subjectFromQuery(query, spec.entity))]);
    }
    if (
      isDirectoryEntity(spec.entity) &&
      !fieldOf(spec, "location") &&
      !fieldOf(spec, "geo_scope")
    ) {
      const locationQuestion = entityQuestionsForSpec({
        entity: spec.entity,
        missing: ["location"],
        raw_query: query,
        locationSuggestion: spec.locationSuggestion,
      })[0];
      if (locationQuestion) return gateReturn([locationQuestion]);
    }
    // ICP follow-up (Phase 1.4): exactly one question per round, only when
    // the answer can change retrieval or the pitch. Website offers ask site
    // preference (drives the no_website filter); marketing asks channel
    // (tailors the pitch, no row filter — stated honestly in the taxonomy).
    if (mode === "selling" && (spec.entity === "business" || spec.entity === "company")) {
      const offerText = criteria.find((c) => c.field === "offer")?.value ?? "";
      const def = offeringById(inferOfferingId(offerText) ?? "");
      if (def?.followUp) {
        const hasSite = criteria.some(
          (c) => (c.field === "opportunity" || c.field === "site") && c.value.trim(),
        );
        const hasChannel = criteria.some((c) => c.field === "channel" && c.value.trim());
        const needsFollowUp =
          ((def.id === "websites" || def.id === "design") && !hasSite) ||
          (def.id === "marketing" && !hasChannel);
        // An alternative non-website offer keeps this search actionable without
        // requiring the user to choose a website state first.
        if (needsFollowUp && !/\bor\b/i.test(offerText)) {
          const target = spec.entity === "company" ? "these companies" : "these businesses";
          return gateReturn([def.followUp(target, def.id === "design" ? "design" : "website")]);
        }
        // Redesign angle (design offering + has-site stated, no opportunity):
        // stale-site proxy filter. Derived server-side so a "with" answer can
        // never silently return unfiltered rows.
        {
          const offerText2 = criteria.find((c) => c.field === "offer")?.value ?? "";
          const def2 = offeringById(inferOfferingId(offerText2) ?? "");
          const siteVal = criteria.find((c) => c.field === "site")?.value.trim() ?? "";
          const hasOpp = criteria.some((c) => c.field === "opportunity" && c.value.trim());
          if (
            def2?.id === "design" &&
            siteVal === "with" &&
            !hasOpp &&
            (spec.entity === "business" || spec.entity === "company")
          ) {
            criteria.push({
              field: "opportunity",
              value: "stale_site",
              stated: true,
              confidence: 0.9,
            });
            spec.criteria = criteria;
          }
        }
      }
    }
  }
  if (spec.status === "needs_clarification") {
    if (typeof console !== "undefined") {
      console.info(
        "[spec-run] " +
          JSON.stringify({
            query,
            entity: spec.entity,
            criteria: spec.criteria,
            missing: spec.missing,
            status: spec.status,
            outcome: "clarify",
          }),
      );
    }
    return withRun({
      spec,
      questions: questionsForMissing(spec),
      clarify: await clarifyQuestionsForSpec(spec),
      rows: [],
      dbMeta: [],
      rejected: 0,
      liveDiscovery: "not_required",
      ...pageInfo,
      outcome: "NO_QUALIFIED_RESULTS",
    });
  }
  const people = deps.people ?? searchPeopleDB;
  const companies = deps.companies ?? searchCompaniesDB;
  const businesses = deps.businesses ?? searchBusinessesDB;
  const investors = deps.investors ?? searchInvestorsDB;
  const indexer = deps.index === null
    ? null
    : (deps.index ?? (useObjectSearchIndex() ? queryObjectIndexForSpec : queryIndexForSpec));
  const dbMeta: DbHitMeta[] = [];
  let rows: SpecRow[] = [];
  let liveCandidateCount = 0;
  let liveSpecMatchCount = 0;
  // Paging state (Phase 1.8): fetchedHitCap (a source hit its fetch window)
  // and pageBaseOffset (matches to skip) feed applyPage in the shared tail.
  let fetchedHitCap = false;
  let pageBaseOffset = 0;
  // Indexed cutover (USE_INDEXED_SEARCH, default OFF): Postgres serves
  // person/company/business when it can; ANY error falls back to S3 below.
  // Investor/unknown have no index table -> indexer returns null -> S3.
  // Job entities take the fleet tier above (flag on) or the legacy
  // people-placeholder below (flag off).
  // Slot reads hoisted above the retrieval branch: the legacy order, the
  // refuse guard, and the coverage-planned executor all need them.
  const role = fieldOf(spec, "role");
  const industry = fieldOf(spec, "industry");
  const location = fieldOf(spec, "location");
  const category = fieldOf(spec, "category");
  let indexedServed = false;
  // Coverage-planned retrieval (Phase 1.7, USE_COVERAGE_SELECTOR only):
  // bounded cheapest-first tiers (hot → s3 → provider-skipped) with early
  // stop at stopWhenRows and per-tier timeouts. Every stage is journaled so
  // parser / resolver / retrieval / provider / intent failures stay
  // distinguishable. Flag off, unplannable geography, or non-directory
  // entity → legacy order in the else branch, untouched.
  const locKey = (location ?? "").toLowerCase().trim();
  const planIso = location
    ? (COUNTRY_ISO[locKey]?.[0]?.toUpperCase() ?? countryHintForCity(location) ?? null)
    : null;
  const planCity = location && !COUNTRY_ISO[locKey] ? normCityLookup(location) : null;
  const usePlanned =
    useCoverageSelector() &&
    planIso !== null &&
    (spec.entity === "business" || spec.entity === "company" || spec.entity === "person");
  // Jobs fleet tier (fleet integration, USE_COVERAGE_SELECTOR only): job
  // entities query the real registry subset (keyless boards + FreeHire API)
  // instead of the legacy people-placeholder. Bounded by source subset +
  // tier timeout; feeds the same validating/paging tail as every engine.
  if (spec.entity === "job" && useCoverageSelector()) {
    // (Dynamic import: this module is client-reachable; the jobs chain
    // reaches node builtins which must not join the static browser graph.)
    const { fetchSpecJobs: fetchJobs, jobPostingToSpecRow } = await import(
      "@/lib/search/jobs-provider"
    );
    const runJobs = deps.providerJobs === null ? null : (deps.providerJobs ?? fetchJobs);
    if (runJobs) {
      try {
        // 60s tier budget (not 30s): the bounded ATS second phase alone may
        // take up to its 18s shared budget after the fast boards. The timeout
        // still caps wall-clock per query — never unbounded crawling.
        const j = await withTierTimeout(
          runJobs({
            query: role ?? category ?? industry ?? query,
            location: location ?? undefined,
            // Provider ranking is broad; inspect enough jobs before the strict
            // Spec filter so a relevant remote country match is not truncated.
            limit: Math.max(fetchWindow, 100),
            seniority: fieldOf(spec, "seniority") ?? undefined,
            employment: fieldOf(spec, "employment") ?? undefined,
          }),
          60000,
          "provider-jobs",
        );
        const okSources = j.sourceStatuses.filter((s) => s.status === "ok").length;
        dbMeta.push({
          dbHit: j.jobs.length > 0,
          engine: "provider-jobs",
          partitionsRead: [
            `jobs-fleet(${okSources}/${j.sourceStatuses.length} sources ok, ${j.droppedSeeker} seeker-filtered)`,
          ],
          rowsScanned: j.fetched,
          rowsReturned: j.jobs.length,
        });
        rows = j.jobs.map((p) => jobPostingToSpecRow(p, "job"));
        if (j.jobs.length >= fetchWindow) fetchedHitCap = true;
        pageBaseOffset = effOffset;
        console.info(
          "[coverage] tier-done " +
            JSON.stringify({ source: "provider-jobs", retrieved: j.jobs.length }),
        );
      } catch (e) {
        routeDiagnostics.push({
          code: "SOURCE_ERROR",
          source: "provider-jobs",
          detail: e instanceof Error ? e.message : String(e),
        });
        console.warn(
          "[coverage] tier-error " +
            JSON.stringify({
              source: "provider-jobs",
              error: e instanceof Error ? e.message : String(e),
            }),
        );
      }
    }
  } else if (usePlanned) {
    const entity = spec.entity as "business" | "company" | "person";
    const decision = selectCoverageSources(
      { entity, countryIso: planIso, cityNorm: planCity, pageSize: limit },
      await loadCoverageMatrix(),
    );
    console.info(
      "[coverage] decision " +
        JSON.stringify({
          query,
          entity,
          iso: planIso,
          terminal: decision.terminal,
          steps: decision.steps,
          stopWhenRows: decision.stopWhenRows,
          notes: decision.notes,
        }),
    );
    const seenKeys = new Set<string>();
    const rowKey = (r: SpecRow) => r.key ?? `${r.title}||${r.detail}`;
    let stopCount = 0;
    let hotKept = false;
    // Early stop (no fanout): halt once the page is fillable from validated
    // matches AND hasMore is already decidable (a tier hit its fetch cap),
    // or when no tiers remain. A full hot page therefore never triggers S3;
    // thin tiers still fall through, bounded by budgets.
    const pageNeed = effOffset + limit;
    for (let si = 0; si < decision.steps.length; si++) {
      const step = decision.steps[si];
      const tiersRemain = si < decision.steps.length - 1;
      if (stopCount >= pageNeed && (fetchedHitCap || !tiersRemain)) {
        console.info(
          "[coverage] early-stop " +
            JSON.stringify({ kept: stopCount, stopWhen: decision.stopWhenRows }),
        );
        break;
      }
      try {
        if (step.source === "provider") {
          // Live provider tier: free OSM businesses ONLY (the sole declared
          // live capability). Non-business entities and missing slots skip
          // with a journaled reason. Declared providers fan out IN PARALLEL
          // (Phase 5: uncapped count, shared step budget, failure-isolated) —
          // today a single OSM source, tomorrow N without re-plumbing.
          // (Dynamic import: this module is client-reachable; the OSM chain
          // must not join the static browser graph.)
          const { searchOsmLocalBusinesses: searchOsm } =
            await import("@/lib/search/osm-local-businesses.server");
          const provider =
            deps.providerBusinesses === null ? null : (deps.providerBusinesses ?? searchOsm);
          if (!provider || spec.entity !== "business" || !location || !category) {
            console.info(
              "[coverage] tier-skipped " +
                JSON.stringify({
                  source: "provider",
                  reason: !provider
                    ? "deps.providerBusinesses null"
                    : "no declared live capability for this entity/slots",
                }),
            );
            continue;
          }
          const { fanOutProviders } = await import("@/lib/search/provider-fanout");
          const fanout = await fanOutProviders(
            [
              {
                name: "provider-osm",
                run: () =>
                  provider(
                    {
                      raw: query,
                      skill: category,
                      role: "",
                      queryType: "skill",
                      relatedSkills: [],
                      buyerIntentQueries: [],
                      buyerPhrases: [],
                      jobBoardQueries: [],
                      jobBoardTerms: [],
                      socialQueries: [],
                      redditBuyerQueries: [],
                      booleanWebQueries: [],
                      customerPhrases: [],
                      subreddits: [],
                      negativePhrases: [],
                      negativeSignals: [],
                    },
                    location,
                  ),
              },
            ],
            { timeoutMs: step.timeoutMs },
          );
          for (const e of fanout.errors) {
            console.warn("[coverage] tier-error " + JSON.stringify({ source: e.name, error: e.error }));
          }
          const leads = fanout.rows;
          const mapped: SpecRow[] = leads.map((l, i) => {
            const tag = (l.match_reasons?.[0] ?? "").split(" near ")[0] || category;
            const slug =
              `${l.title ?? "?"}|${l.address ?? ""}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .slice(0, 48) || `row-${i}`;
            // Runtime-only contact fields (set by elementsToLeads, outside
            // the Lead type): read defensively, validate like any row.
            const contact = l as unknown as { phones?: string[]; emails?: string[] };
            const phone = checkPhone(contact.phones?.[0], planIso);
            const entity_id = `osm:${slug}`;
            return {
              kind: "business" as const,
              key: entity_id,
              entity_id,
              entity_resolved: true,
              page_type: "entity_page" as const,
              title: l.title ?? "?",
              detail: [l.address, location].filter(has).join(", "),
              email: contact.emails?.[0] ?? null,
              phone: phone.phone,
              phoneStatus: phone.status,
              url: null,
              source_url: l.full_post_url ?? null,
              category: normaliseOsmCraft(tag, category),
              location,
              country: planIso,
            };
          });
          dbMeta.push({
            dbHit: mapped.length > 0,
            engine: "provider-osm",
            partitionsRead: [`overpass(${location})`],
            rowsScanned: leads.length,
            rowsReturned: mapped.length,
          });
          rows.push(...mapped);
          // Provider is the terminal tier: no fetch-cap accounting (the loop
          // ends after it). Validation happens in the shared tail, idempotent.
          const kept = mapped.filter((x) => rowSatisfiesSpec(spec, x));
          stopCount += kept.length;
          console.info(
            "[coverage] tier-done " +
              JSON.stringify({
                source: "provider-osm",
                retrieved: mapped.length,
                kept: kept.length,
              }),
          );
          continue;
        }
        if (step.source === "hot-index") {
          if (!indexer || !useIndexedSearch()) {
            console.info(
              "[coverage] tier-skipped " +
                JSON.stringify({
                  source: "hot-index",
                  reason: "index engine disabled or deps.index null",
                }),
            );
            continue;
          }
          const r = await withTierTimeout(
            indexer(spec, fetchWindow, 0),
            step.timeoutMs,
            "hot-index",
          );
          if (!r) {
            console.info("[coverage] tier-empty " + JSON.stringify({ source: "hot-index" }));
            continue;
          }
          dbMeta.push(r.meta);
          rows.push(...r.rows);
          if (r.rows.length === fetchWindow) fetchedHitCap = true;
          const kept = r.rows.filter((x) => rowSatisfiesSpec(spec, x));
          stopCount += kept.length;
          if (kept.length > 0) hotKept = true;
          console.info(
            "[coverage] tier-done " +
              JSON.stringify({ source: "hot-index", retrieved: r.rows.length, kept: kept.length }),
          );
          continue;
        }
        const s3TimeoutMs = spec.entity === "company" && fieldOf(spec, "location_kind") === "city"
          ? Math.min(step.timeoutMs, 5_000)
          : step.timeoutMs;
        const t = await withTierTimeout(
          fetchS3Tier(
            spec,
            { people, companies, businesses, investors },
            { role, industry, location, category, limit: fetchWindow,
              signal: deps.signal, deadline: Date.now() + Math.min(15_000, Math.max(1, s3TimeoutMs - 50)) },
          ),
          s3TimeoutMs,
          "s3-parquet",
        );
        if (t.meta) dbMeta.push(t.meta);
        if (t.meta?.coverageIncomplete) routeDiagnostics.push({
          code: "SOURCE_UNAVAILABLE", source: "s3-parquet",
          detail: "Stored people scan reached its time budget; coverage is incomplete.",
        });
        rows.push(...t.rows);
        if (t.rows.length === fetchWindow) fetchedHitCap = true;
        const kept = t.rows.filter((x) => rowSatisfiesSpec(spec, x));
        stopCount += kept.length;
        console.info(
          "[coverage] tier-done " +
            JSON.stringify({ source: "s3-parquet", retrieved: t.rows.length, kept: kept.length }),
        );
      } catch (e) {
        routeDiagnostics.push({
          code: "SOURCE_ERROR",
          source: step.source,
          detail: e instanceof Error ? e.message : String(e),
        });
        console.warn(
          "[coverage] tier-error " +
            JSON.stringify({
              source: step.source,
              error: e instanceof Error ? e.message : String(e),
            }),
        );
        continue;
      }
    }
    // Cross-tier dedupe (planned path only; legacy paths serve one source so
    // never dedupe). The shared tail below validates once, idempotently.
    // Planned tiers fetch from zero, so paging slices post-validation matches.
    rows = rows.filter((r) => {
      const k = rowKey(r);
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });
    pageBaseOffset = effOffset;
    indexedServed = hotKept;
  } else {
    // Legacy pg-index: DB-side page (offset pre-applied by the index query);
    // +1 probe row makes hasMore exact without a count scan.
    if (indexer && useIndexedSearch()) {
      try {
        const r = await indexer(spec, limit + 1, effOffset);
        if (r) {
          dbMeta.push(r.meta);
          rows = r.rows;
          indexedServed = true;
          if (r.rows.length === limit + 1) fetchedHitCap = true;
        }
      } catch (e) {
        console.warn(
          "[index-fallback] pg-index failed, using S3:",
          e instanceof Error ? e.message : e,
        );
      }
    }
    // (role/industry/location/category hoisted above the retrieval branch.)
    // S3 guard parity with the index path + businesses reader: a spec with
    // NOTHING to filter on must refuse instead of trawling largest shards.
    // (Constrained-but-unindexed keeps legacy best-effort, meta-flagged.)
    const name = fieldOf(spec, "name") ?? fieldOf(spec, "company");
    const hasFilter =
      role ??
      industry ??
      location ??
      category ??
      name ??
      fieldOf(spec, "business_model") ??
      fieldOf(spec, "investor_sector") ??
      fieldOf(spec, "investor_stage") ??
      fieldOf(spec, "investor_check") ??
      null;
    // Signal-carrying intents are exempt: the intent itself is the requirement
    // (same rule as computeMissing's bare-entity gate).
    if (
      !indexedServed &&
      (spec.entity === "person" || spec.entity === "company") &&
      !hasFilter &&
      !spec.signal_required
    ) {
      dbMeta.push({
        dbHit: false,
        engine: "s3-parquet",
        partitionsRead: ["(refused: unconstrained spec, nothing to filter on)"],
        rowsScanned: 0,
        rowsReturned: 0,
      });
      return withRun({
        spec,
        questions: [],
        clarify: [],
        rows: [],
        dbMeta,
        rejected: 0,
        liveDiscovery: "db_thin_gapfill_pending",
        ...pageInfo,
        outcome: "NO_QUALIFIED_RESULTS",
      });
    }
    // Coverage honesty (T3): the index holds a slice, S3 the full corpus.
    // Index-empty + location present falls through to the gazetteer-routed
    // S3 readers instead of reporting empty. The index meta (0 rows) stays
    // logged; S3 appends its own. Unconstrained specs never reach here.
    if (indexedServed && rows.length === 0 && location) {
      indexedServed = false;
    }
    // S3 readers need credentials/network; if they throw here (e.g. local
    // scripts without AWS creds), keep the index result instead of 500ing —
    // an honest empty beats a crash. Partial S3 metas can't occur: every
    // branch pushes meta only after its await succeeds.
    try {
      // Legacy order: exactly one S3 branch runs (entity match), mirroring the
      // pre-extraction if/else chain — unknown entities leave rows untouched.
      if (
        !indexedServed &&
        ["person", "company", "business", "investor", "job"].includes(spec.entity)
      ) {
        const t = await fetchS3Tier(
          spec,
          { people, companies, businesses, investors },
          { role, industry, location, category, limit: fetchWindow, signal: deps.signal },
        );
        if (t.meta) dbMeta.push(t.meta);
        if (t.meta?.coverageIncomplete) routeDiagnostics.push({
          code: "SOURCE_UNAVAILABLE", source: "s3-parquet",
          detail: "Stored people scan reached its time budget; coverage is incomplete.",
        });
        rows = t.rows;
        if (t.rows.length === fetchWindow) fetchedHitCap = true;
        pageBaseOffset = effOffset;
      }
    } catch (e) {
      console.warn(
        "[s3-fallback] S3 readers failed, keeping index result:",
        e instanceof Error ? e.message : e,
      );
    }
  } // end legacy-order else (coverage selector off / unplannable)
  const kept = rows.filter((r) => rowSatisfiesSpec(spec, r));
  // Anti-hallucination boundary (Batch 1): on the indexed path every kept
  // row must carry the registry_key of its retrieved DB row. Keyless rows
  // (fabricated anywhere upstream of retrieval) are dropped and counted as
  // rejected — the AI layer explains verified rows, it never contributes
  // records. Content fit is enforced separately by rowSatisfiesSpec above.
  if (indexedServed) {
    const retrievedKeys = new Set(rows.map((r) => r.key));
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!kept[i].key || !retrievedKeys.has(kept[i].key)) kept.splice(i, 1);
    }
  }
  // Opportunity preference (Step 2.3, optional): business/company only.
  // Person/investor `url` fields hold LinkedIn profiles, not websites;
  // filtering them would silently drop valid people.
  // - no_website: keep rows without a site (exact null check, both engines;
  //   pg pushdown mirrors it in queryBusinesses).
  // - stale_site: keep rows WITH a site but no email AND no phone (thin web
  //   presence proxy for redesign angles). Tail-only: phone nullness differs
  //   between raw DB values and checked display values, so DB pushdown would
  //   silently diverge engine counts.
  const opp = fieldOf(spec, "opportunity");
  if (
    (opp === "no_website" || opp === "stale_site") &&
    (spec.entity === "business" || spec.entity === "company")
  ) {
    for (let i = kept.length - 1; i >= 0; i--) {
      const entitySite = sanitizeSpecRow(kept[i]).website_url;
      if (opp === "no_website") {
        if (entitySite) kept.splice(i, 1);
      } else if (!(entitySite && !kept[i].email && !kept[i].phone)) {
        kept.splice(i, 1);
      }
    }
  }

  // Phase A: sanitize (mojibake) + completeness split. Incomplete rows never
  // hit the first page as fake-complete; they go to the enrich queue.
  // Sanitize stamps the Spec opportunity first so no_website candidates are
  // judged by the no-site completeness rule from the very first split.
  let sanitized = kept.map((r) => sanitizeSpecRow(r, spec));
  let completeRows = sanitized.filter((r) => r.complete);
  let incompleteRows = sanitized.filter((r) => !r.complete);

  // Phase B: enrich incomplete (capped). deps.enrichFn=null skips.
  // Under vitest, undefined also skips so unit tests stay offline.
  const enrichOpt =
    deps.enrichFn !== undefined
      ? deps.enrichFn
      : process.env.VITEST
        ? null
        : undefined;
  if (incompleteRows.length && enrichOpt !== null) {
    try {
      const { enrichIncompleteRows } = await import("@/lib/search/enrich-incomplete");
      const enriched = await enrichIncompleteRows(incompleteRows, {
        enrichFn: enrichOpt ?? undefined,
        signal: deps.signal,
      });
      completeRows = [...completeRows, ...enriched.complete];
      incompleteRows = enriched.stillIncomplete;
    } catch (e) {
      console.warn(
        "[enrich] incomplete enrich failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Phase C: qualify the DB candidates before deciding whether the page is full.
  // deps.liveGapfill=null skips; under vitest undefined skips unless injected.
  const enrichedDbKeys = new Set<string>();
  // Research known candidates before spending discovery budget on replacements.
  try {
    throwIfAborted(deps.signal);
    const { enrichCandidatesForSpec } = await import("@/lib/search/enrichment-run");
    const known = mergeDuplicateCandidates([...completeRows, ...incompleteRows]);
    const enriched = await enrichCandidatesForSpec(known, spec, {
      signal: deps.signal,
      maxContactCandidates: process.env.VITEST ? 0 : 12,
      maxPaidCalls: 0,
      adapters: deps.enrichmentAdapters,
    });
    const checked = enriched.rows.map((r) => sanitizeSpecRow(r, spec));
    completeRows = checked.filter((row) => row.complete);
    incompleteRows = checked.filter((row) => !row.complete);
    checked.forEach((row) => enrichedDbKeys.add(row.entity_id ?? row.key ?? ""));
  } catch (error) {
    if (!deps.signal?.aborted) console.warn("[enrich-db]", error instanceof Error ? error.message : error);
  }
  let liveDiscovery: SpecSearchResult["liveDiscovery"] =
    completeRows.length === 0 ? "db_thin_gapfill_pending" : "not_required";
  const { applyWhyMatchGate } = await import("@/lib/search/live-gapfill");
  const qualifiedDbCount = applyWhyMatchGate(completeRows, spec, !!spec.signal_required).kept.length;
  const requestedTarget = pageBaseOffset + limit;
  // Volume engine (Phase 1): discovery should BROADLY oversample the request.
  // The user's N is the delivery bar, not the discovery bar — research/enrich
  // sits between broad discovery and strict qualification.
  // Volume engine: discovery BROADLY oversamples the request, per entity —
  // people/investors need deep identity research (higher oversample), local
  // businesses qualify cheaply from structured sources (lower). Hard cap keeps
  // cheap candidate collection bounded; deep research stays prioritized.
  const POOL_OVERFETCH: Record<SearchSpec["entity"], { mult: number; min: number }> = {
    business: { mult: 3, min: 30 },
    company: { mult: 5, min: 40 },
    person: { mult: 7, min: 50 },
    job: { mult: 6, min: 50 },
    investor: { mult: 6, min: 50 },
    unknown: { mult: 3, min: 20 },
  };
  const poolFor = POOL_OVERFETCH[spec.entity] ?? { mult: 3, min: 20 };
  const candidatePoolTarget = Math.min(250, Math.max(requestedTarget * poolFor.mult, poolFor.min));
  const storedSearchDoneAt = Date.now();
  const { buildSourcePlan } = await import("@/lib/search/source-plan");
  let executionPlan = buildSourcePlan(spec, undefined, { desiredCount: requestedTarget });
  let providerAttempts: import("@/lib/search/source-plan").ProviderDiagnostic[] = [];
  const forceLiveDiscovery = process.env.NODE_ENV !== "production" && process.env.FORCE_LIVE_DISCOVERY === "true";
  let liveIncompleteRows: SpecRow[] = [];
  // RC: the 120s hard deadline must finalize accumulated candidates, not
  // erase them. Only user cancellation / stale runs discard work.
  let deadlineHit = false;
  const deadlineNow = () => deps.signal?.aborted === true && searchAbortCode(deps.signal) === "SEARCH_DEADLINE";
  // User-visible activity events (no reasoning — actions and counts only).
  const emitProgress = (action: string, source?: string, detail?: string, count?: number | string) =>
    deps.browserProgress?.({ action, source, detail, count });
  if (forceLiveDiscovery) {
    console.info("[spec-run] forced live discovery", { search_run_id: runIds.search_run_id });
  }
  const liveOpt =
    deps.liveGapfill !== undefined
      ? deps.liveGapfill
      : process.env.VITEST
        ? null
        : {};
  if (liveOpt !== null && (forceLiveDiscovery || spec.signal_required || fieldOf(spec, "needs_live") === "true" || qualifiedDbCount < requestedTarget)) {
    emitProgress("Stored search complete", "database", undefined, kept.length);
    try {
      const { runLiveGapfill } = await import("@/lib/search/live-gapfill");
      const live = await runLiveGapfill(spec, {
        ...(liveOpt ?? {}),
        searchRunId: runIds.search_run_id,
        signal: deps.signal,
        onBrowserProgress: deps.browserProgress,
        desiredCount: Math.min(candidatePoolTarget, 30),
        initialCandidates: [...completeRows, ...incompleteRows],
        // Verification order fix: stamp the Spec opportunity BEFORE judging
        // completeness, so a no-site candidate with structured absence + two
        // exact checks counts as verified and stops burning browser budget.
        // Researchable spec match (hard contradictions only), not strict —
        // unknown facts are what research is resolving.
        isVerified: (row) => {
          const prepared = sanitizeSpecRow(row, spec);
          return rowCouldSatisfySpec(spec, prepared) && prepared.complete === true &&
            applyWhyMatchGate([prepared], spec, !!spec.signal_required).kept.length === 1;
        },
      });
      executionPlan = live.plan ?? executionPlan;
      providerAttempts = live.diagnostics ?? [];
      liveDiscovery = "completed";
      if (live.diagnostics?.length) {
        for (const d of live.diagnostics) {
          if (d.outcome === "SOURCE_UNAVAILABLE" || d.outcome === "SOURCE_ERROR") {
            routeDiagnostics.push({
              code: d.outcome,
              source: String(d.provider),
              detail: d.error ?? undefined,
            });
          }
        }
      }
      if (live.rows.length) {
        liveCandidateCount = live.rows.length;
        emitProgress("Live discovery complete", live.engine, undefined, live.rows.length);
        dbMeta.push({
          dbHit: true,
          engine: live.engine,
          partitionsRead: [`live-gapfill(${live.scanned})`],
          rowsScanned: live.scanned,
          rowsReturned: live.rows.length,
        });
        // Pre-research gate: drop only hard contradictions. Unknown
        // role/industry/location is researchable, not rejectable — the strict
        // rowSatisfiesSpec runs after enrichment, on the final split.
        const liveSanitized = live.rows
          .map((r) => sanitizeSpecRow(r, spec))
          .filter((r) => rowCouldSatisfySpec(spec, r));
        liveSpecMatchCount = liveSanitized.length;
        completeRows = [...completeRows, ...liveSanitized.filter((r) => r.complete !== false)];
        liveIncompleteRows = liveSanitized.filter((r) => r.complete === false);
        liveDiscovery = "completed";
      } else if (spec.signal_required) {
        liveDiscovery = "completed";
      }

      // Phase 1E: social provider on SPEC when signal_required (provider mandatory).
      if (spec.signal_required && !process.env.VITEST) {
        try {
          const { runSocialSignalGapfill } = await import("@/lib/search/social-signal");
          const social = await runSocialSignalGapfill(spec);
          if (social.rows.length) {
            dbMeta.push({
              dbHit: true,
              engine: `live-social:${social.provider}`,
              partitionsRead: [`social(${social.rows.length})`],
              rowsScanned: social.rows.length,
              rowsReturned: social.rows.length,
            });
            const socialSanitized = social.rows
              .map((r) => sanitizeSpecRow(r, spec))
              .filter((r) => rowCouldSatisfySpec(spec, r));
            completeRows = [
              ...completeRows,
              ...socialSanitized.filter((r) => r.complete !== false),
            ];
            liveDiscovery = "completed";
          } else if (social.error) {
            console.warn("[social-signal]", social.provider, social.error);
            if (social.failure_code) {
              routeDiagnostics.push({
                code:
                  social.failure_code === "PROVIDER_BLOCKED"
                    ? "SOURCE_UNAVAILABLE"
                    : social.failure_code,
                source: social.provider,
                detail: social.error,
              });
            }
          }
        } catch (se) {
          console.warn(
            "[social-signal] failed:",
            se instanceof Error ? se.message : se,
          );
        }
      }
    } catch (e) {
      if (deadlineNow()) {
        deadlineHit = true;
        console.warn(
          "[deadline] live gapfill stopped at hard deadline; finalizing accumulated candidates",
        );
      } else if (e instanceof Error && e.message === "SEARCH_CANCELLED") {
        return withRun(
          {
            spec,
            questions: [],
            clarify: [],
            rows: [],
            dbMeta,
            rejected: rows.length - kept.length,
            liveDiscovery,
            ...pageInfo,
          },
          0,
          true,
        );
      } else {
        console.warn("[live-gapfill] failed:", e instanceof Error ? e.message : e);
        if (spec.signal_required) liveDiscovery = "required_pending_phase7";
      }
    }
  }

  liveDoneAt = Date.now();
  // Browser candidates may need the same completeness enrichment as DB rows.
  // A deadline that fired mid-browser (which returned its rows anyway) must
  // not re-enter research phases here.
  if (deadlineNow()) deadlineHit = true;
  if (!deadlineHit && liveIncompleteRows.length && enrichOpt !== null) {
    try {
      const { enrichIncompleteRows } = await import("@/lib/search/enrich-incomplete");
      const enriched = await enrichIncompleteRows(liveIncompleteRows, { enrichFn: enrichOpt ?? undefined, signal: deps.signal });
      completeRows = [...completeRows, ...enriched.complete];
      liveIncompleteRows = enriched.stillIncomplete;
    } catch (e) {
      console.warn("[enrich] live incomplete enrich failed:", e instanceof Error ? e.message : e);
    }
  }
  incompleteRows = [...incompleteRows, ...liveIncompleteRows];

  // DB and live providers can discover the same canonical entity.
  completeRows = mergeDuplicateCandidates(completeRows).map((r) => sanitizeSpecRow(r, spec));

  // M8: query-aware enrichment BEFORE qualification when required fields
  // are missing. Never: qualify → deliver → enrich later for blocking fields.
  // Non-blocking failures stay diagnostics; absence alone does not reject.
  //
  // Researchable pool: incomplete-but-identity-resolved candidates run the
  // SAME query-aware enrichment as complete ones — a partial candidate often
  // needs exactly this research (site resolution, contacts) to become
  // complete. Completeness is recomputed after enrichment, then the final
  // strict split happens: complete → qualification, incomplete → pending.
  let researchableCount = 0;
  let researchedCount = 0;
  if (!deadlineHit) {
    try {
      throwIfAborted(deps.signal);
      const { enrichCandidatesForSpec } = await import("@/lib/search/enrichment-run");
      const knownRows = completeRows.filter((row) => enrichedDbKeys.has(row.entity_id ?? row.key ?? ""));
      const researchable = mergeDuplicateCandidates([...completeRows, ...incompleteRows]).filter(
        (row) => !enrichedDbKeys.has(row.entity_id ?? row.key ?? ""),
      );
      researchableCount = researchable.length;
      const enriched = await enrichCandidatesForSpec(researchable, spec, {
        signal: deps.signal,
        maxContactCandidates: process.env.VITEST ? 0 : Math.min(14, Math.max(8, Math.ceil(candidatePoolTarget / 4))),
        maxPaidCalls: 0,
        adapters: deps.enrichmentAdapters,
      });
      researchedCount = enriched.rows.length;
      emitProgress("Enrichment pass complete", "enrich", undefined, `${researchedCount} candidates`);
      const checked = [...knownRows, ...enriched.rows].map((r) => sanitizeSpecRow(r, spec));
      completeRows = checked.filter((r) => r.complete);
      incompleteRows = checked.filter((r) => !r.complete);
      for (const d of enriched.diagnostics) {
        if (d.error && (d.error.includes("unavailable") || d.error === "adapter_not_wired")) {
          routeDiagnostics.push({
            code: "SOURCE_UNAVAILABLE",
            source: `enrich:${d.provider}`,
            detail: d.error,
          });
        }
      }
    } catch (e) {
      if (deadlineNow()) {
        deadlineHit = true;
        console.warn(
          "[deadline] query-aware enrichment stopped at hard deadline; finalizing accumulated candidates",
        );
      } else if (e instanceof Error && e.message === "SEARCH_CANCELLED") {
        return withRun(
          {
            spec,
            questions: [],
            clarify: [],
            rows: [],
            dbMeta,
            rejected: rows.length - kept.length,
            liveDiscovery,
            ...pageInfo,
          },
          0,
          true,
        );
      } else {
        console.warn("[enrich-m8] failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  enrichDoneAt = Date.now();
  const qualificationInputCount = completeRows.length;
  const { qualifyLead } = await import("@/lib/search/qualify");
  const rejectionSummary = completeRows.map((row) => ({ row, decision: qualifyLead(row, spec, row.evidence) }))
    .filter(({ decision }) => decision.disposition !== "qualified")
    .slice(0, 8).map(({ row, decision }) => ({ name: row.title, code: decision.reject_code, reason: decision.label }));
  if (rejectionSummary.length) console.info("[qualification-rejected]", JSON.stringify({ search_run_id: runIds.search_run_id, candidates: rejectionSummary }));
  // Always apply qualification / why-match — including when live was skipped
  // (vitest) so signal_required still drops directory contamination.
  // M1: this is the ONLY path into delivery — no alternate qualification.
  // On the hard deadline the gate still runs: it is synchronous, and only
  // theorem-qualified rows may ever be delivered. User cancellation discards.
  if (deps.signal?.aborted && !deadlineNow()) {
    return withRun(
      {
        spec,
        questions: [],
        clarify: [],
        rows: [],
        dbMeta,
        rejected: rows.length - kept.length,
        liveDiscovery,
        ...pageInfo,
      },
      0,
      true,
    );
  }
  try {
    const { applyWhyMatchGate } = await import("@/lib/search/live-gapfill");
    completeRows = applyWhyMatchGate(completeRows, spec, !!spec.signal_required).kept;
    // Belt-and-suspenders: only theorem-qualified rows may be delivered.
    completeRows = completeRows.filter((r) => r.disposition === "qualified");
    if (completeRows.length) {
      emitProgress("Leads qualified", "verification", undefined, completeRows.length);
    }
  } catch (e) {
    if (!deadlineNow()) {
      if (e instanceof Error && e.message === "SEARCH_CANCELLED") {
        return withRun(
          {
            spec,
            questions: [],
            clarify: [],
            rows: [],
            dbMeta,
            rejected: rows.length - kept.length,
            liveDiscovery,
            ...pageInfo,
          },
          0,
          true,
        );
      }
      // optional import failure — do not deliver ungated rows
      completeRows = [];
    }
  }

  // Phase 1D: stamp VERIFIED + best-effort write-back (never blocks UI).
  if (!process.env.VITEST && completeRows.length) {
    try {
      const { stampVerified, persistVerifiedLiveRows } = await import(
        "@/lib/canonical/persist-live.server"
      );
      completeRows = stampVerified(completeRows);
      const liveOnly = completeRows.filter(
        (r) =>
          (r.key ?? "").startsWith("live-web:") ||
          (r.key ?? "").startsWith("live-social:") ||
          (r.key ?? "").startsWith("live-osm:"),
      );
      if (liveOnly.some((r) => r.verification_status === "verified")) {
        const logPersist = (pr: {
          attempted: number;
          persisted: number;
          skipped: number;
          error?: string;
          via?: string;
        }) => {
          if (pr.persisted || pr.error) {
            console.info(
              "[persist-live] " +
                JSON.stringify({
                  attempted: pr.attempted,
                  persisted: pr.persisted,
                  skipped: pr.skipped,
                  via: pr.via ?? null,
                  error: pr.error ?? null,
                }),
            );
          }
        };
        // Scripts set AWAIT_PERSIST_LIVE=1 to exercise write-back synchronously.
        if (process.env.AWAIT_PERSIST_LIVE === "1") {
          logPersist(await persistVerifiedLiveRows(liveOnly));
        } else {
          void persistVerifiedLiveRows(liveOnly).then(logPersist);
        }
      }
    } catch (pe) {
      console.warn("[persist-live] skipped:", pe instanceof Error ? pe.message : pe);
    }
  }

  if (completeRows.length === 0 && liveDiscovery === "not_required") {
    liveDiscovery = "db_thin_gapfill_pending";
  }

  completeRows = markSoftDuplicates(completeRows);

  // Paging (Phase 1.8): the window above fetched offset+limit+1 matches;
  // slice the page here, after validation + opportunity + key filters, so
  // every page holds verified matches only. hasMore is exact (fetch-cap hit
  // or validated overflow) — the result set itself has no ceiling.
  const { page, hasMore } = applyPage(completeRows, {
    offset: pageBaseOffset,
    limit,
    fetchedHitCap,
  });
  const moreAvailableMessage =
    hasMore || incompleteRows.length > 0
      ? "There are more verified leads — want to see them?"
      : null;
  // Thin-ask (Phase 3 jobs, Phase 5 general): a ready spec whose retrieval
  // came back empty offers refinement questions instead of a dead empty
  // state. Non-blocking — status stays ready_to_search, rows stay honest
  // empty. Jobs ask location/seniority/employment; companies/persons ask
  // their unstated optional slots; investors have none (all slots required).
  let thinQuestions: string[] = [];
  let thinClarify: import("@/lib/search/clarifier").ClarifyQuestion[] = [];
  if (
    spec.status === "ready_to_search" &&
    completeRows.length === 0 &&
    (liveDiscovery === "db_thin_gapfill_pending" || liveDiscovery === "completed")
  ) {
    const { thinClarifyForSpec } = await import("@/lib/search/clarifier");
    thinClarify = thinClarifyForSpec(spec);
    thinQuestions = thinClarify.map((q) => q.question);
  }
  // Permanent run journal (locked observability): one JSON line per search —
  // query, spec, per-source hit meta, validation rejects, final count.
  if (page.length === 0 && spec.criteria.some((criterion) => criterion.field === "opportunity" && criterion.value === "no_website")) {
    routeDiagnostics.push({
      code: "NO_QUALIFIED_RESULTS",
      source: "no-website-verification",
      detail: "No business completed structured-source and exact-name website-absence verification. A missing website field alone is not evidence that no official site exists.",
    });
  }
  const fin = finalizeSearchOutcome(routeDiagnostics, {
    qualifiedCount: page.length,
    // The hard deadline is not a cancellation: accumulated qualified rows
    // finalize normally instead of being reported as SEARCH_CANCELLED.
    cancelled: deps.signal?.aborted === true && !deadlineNow(),
  });
  const rawCandidateCount = rows.length + liveCandidateCount;
  const postSpecFilterCount = kept.length + liveSpecMatchCount;
  const zeroReason: NonNullable<SpecSearchResult["retrievalTrace"]>["reason"] =
    page.length > 0
      ? "RESULTS"
      : rawCandidateCount === 0 && routeDiagnostics.some((d) => /timeout/i.test(d.detail ?? ""))
        ? "TIMEOUT"
        : rawCandidateCount === 0 && routeDiagnostics.some((d) => d.code === "SOURCE_UNAVAILABLE")
          ? "SOURCE_UNAVAILABLE"
      : rawCandidateCount === 0
        ? dbMeta.some((m) => m.partitionsRead.some((p) => /no gazetteer hit/i.test(p)))
          ? "NO_LOCATION_ROUTE"
          : dbMeta.some((m) => m.partitionsRead.some((p) => /resolved shards.*0 file|refused|stored_source_unavailable/i.test(p)))
            ? "NO_PARTITION"
            : dbMeta.some((m) => m.engine === "pg-index" && m.rowsReturned === 0) &&
                !dbMeta.some((m) => m.engine === "s3-parquet")
              ? "NO_INDEX_COVERAGE"
              : role && spec.entity === "person"
                ? "NO_ROLE_MATCH"
                : (category || industry || fieldOf(spec, "investor_sector"))
                  ? "NO_CATEGORY_MATCH"
                  : "NO_DATA"
        : postSpecFilterCount === 0
          ? "FILTERED_BY_SPEC"
          : incompleteRows.length > 0 && qualificationInputCount === 0
            ? "INCOMPLETE"
            : "FAILED_QUALIFICATION";
  const retrievalTrace: NonNullable<SpecSearchResult["retrievalTrace"]> = {
    sources: dbMeta.map((m) => ({
      source: m.engine,
      partitions: m.partitionsRead,
      scanned: m.rowsScanned,
      matched: m.rowsReturned,
    })),
    rawCandidates: rawCandidateCount,
    postSpecFilter: postSpecFilterCount,
    timings: {
      understanding_ms: understandingDoneAt - runStartedAt,
      stored_search_ms: storedSearchDoneAt - understandingDoneAt,
      research_ms: liveDoneAt - storedSearchDoneAt,
      enrichment_ms: enrichDoneAt - liveDoneAt,
      qualification_ms: Date.now() - enrichDoneAt,
      total_ms: Date.now() - runStartedAt,
    },
    researchable: researchableCount || qualificationInputCount,
    researched: researchedCount || undefined,
    complete: qualificationInputCount,
    pendingEnrichment: incompleteRows.length,
    qualificationRejected: Math.max(0, qualificationInputCount - completeRows.length),
    qualified: completeRows.length,
    returned: page.length,
    reason: zeroReason,
  };
  if (typeof console !== "undefined") {
    console.info(
      "[spec-run] " +
        JSON.stringify({
          query,
          entity: spec.entity,
          criteria: spec.criteria,
          missing: spec.missing,
          status: spec.status,
          signal_required: spec.signal_required,
          dbMeta,
          retrieved: rawCandidateCount,
          rejected: rawCandidateCount - postSpecFilterCount,
          returned: page.length,
          qualified_count: page.length,
          pendingEnrichment: incompleteRows.length,
          offset: effOffset,
          hasMore,
          liveDiscovery,
          deadline: deadlineHit || undefined,
          retrievalTrace,
          search_run_id: runIds.search_run_id,
          outcome: fin.outcome,
        }),
    );
  }
  return withRun(
    {
      spec,
      questions: thinQuestions,
      clarify: thinClarify,
      rows: page,
      dbMeta,
      rejected: rawCandidateCount - postSpecFilterCount,
      liveDiscovery,
      pendingEnrichment: incompleteRows.length,
      moreAvailableMessage,
      offset: effOffset,
      limit,
      hasMore,
      totalAvailable: null,
      outcome: fin.outcome,
      diagnostics: fin.diagnostics,
      retrievalTrace,
      executionPlan,
      providerAttempts,
    },
    page.length,
    deps.signal?.aborted === true && !deadlineNow(),
  );
}

export const getSpecFlag = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(
    async (): Promise<{
      enabled: boolean;
      stamp: { hash: string; builtAt: string };
    }> => {
      const { useSpecPath } = await import("@/lib/search/flag");
      const { buildStamp } = await import("@/lib/build-stamp.server");
      return { enabled: useSpecPath(), stamp: buildStamp() };
    },
  );

export const runSpecSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        query: z.string().max(500),
        limit: z.number().int().min(1).max(100).optional().default(25),
        offset: z.number().int().min(0).optional().default(0),
        answers: z.record(z.string(), z.string()).optional().default({}),
        force: z.boolean().optional().default(false),
        search_run_id: z.string().max(80).optional(),
        conversation_id: z.string().max(80).optional(),
        turn_id: z.string().max(80).optional(),
        request_id: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SpecSearchResult> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const runId = data.search_run_id;
    const ownerId = context.userId;
    const { beginRegisteredSearchRun } = await import("@/lib/search/search-run.server");
    const registered = runId ? beginRegisteredSearchRun({ ownerId, runId, conversationId: data.conversation_id, signal: getRequest().signal }) : undefined;
    const { beginSearchBrowserProgress, publishSearchBrowserProgress, finishSearchBrowserProgress } = await import("@/lib/search/search-browser-progress.server");
    if (runId) beginSearchBrowserProgress(runId, ownerId);
    try {
      return await runSpecSearchCore(data.query, {
        signal: registered?.signal ?? getRequest().signal,
        browserProgress: runId ? (event) => publishSearchBrowserProgress(runId, ownerId, event) : undefined,
      }, data.limit, data.answers, {
        force: data.force,
        offset: data.offset,
        search_run_id: runId,
        conversation_id: data.conversation_id,
        turn_id: data.turn_id,
        request_id: data.request_id,
      });
    } finally {
      registered?.finish();
      if (runId) finishSearchBrowserProgress(runId, ownerId);
    }
  });

export const getSearchBrowserProgress = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((data: unknown) => z.object({ search_run_id: z.string().min(1).max(80), after: z.number().int().min(0).default(0) }).parse(data))
  .handler(async ({ data, context }) => {
    const { readSearchBrowserProgress } = await import("@/lib/search/search-browser-progress.server");
    return readSearchBrowserProgress(data.search_run_id, context.userId, data.after);
  });
