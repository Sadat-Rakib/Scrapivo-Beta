/**
 * Coverage-aware source selector (Phase 1.2).
 *
 * Separation enforced by design:
 *   Search understanding (SearchSpec) → Coverage-aware retrieval (THIS module
 *   only ORDERS sources) → Evidence-backed qualification (later, separate).
 * This module never retrieves, never ranks, never calls AI. It answers one
 * question: "in which order, with what budgets, should existing sources be
 * consulted for this entity + geography?"
 *
 * Source order is always cheapest-first and SEQUENTIAL with early stop:
 *   hot-index → s3-parquet → live provider
 * Steps after the first run ONLY if rows so far are insufficient
 * (`if-insufficient`). No parallel fan-out: a single query can never trigger
 * uncontrolled multi-provider crawling. Total sources ≤ budget.maxSources.
 *
 * Grain honesty: the matrix is country-grain (businesses) or pool-grain
 * (companies by-initial, people by-slug — both mix geographies per file, so
 * presence is pool-wide, not per-country). City-level thinness is therefore
 * UNKNOWN at plan time → city queries always keep the next tier as an
 * if-insufficient contingency, and the decision says so in `notes`.
 *
 * NOT wired into any retrieval path yet (Phase 1.2 constraint). Unit-tested
 * standalone with fixture matrices. Guarded by USE_COVERAGE_SELECTOR
 * (default false) for the future wiring step.
 */

export type CoverageEntity = "business" | "company" | "person";
export type CoverageSource = "hot-index" | "s3-parquet" | "provider";
export type CoverageTerminal = "covered" | "partial" | "uncovered" | "exhausted";

export interface CoverageMatrixEntity {
  /** Per-ISO hot-index row counts (absent key = 0/unknown). */
  hotIndexByIso?: Record<string, number>;
  /** Businesses: per-ISO S3 presence. */
  byGeo?: Record<string, { s3Files?: number; s3Rows?: number | null }>;
  /** Companies/people: worldwide pool presence (files mix geographies). */
  s3Pool?: { files: number };
  /** Generated matrices also expose the pool count at entity level. */
  s3Files?: number;
  /** Declared (not measured) live-provider capability. */
  declaredProviders?: string[];
}

export interface CoverageMatrix {
  entities: Partial<Record<string, CoverageMatrixEntity>>;
}

export interface CoverageBudget {
  /** Rows that make a tier sufficient (default max(20, pageSize)). */
  minSufficientRows?: number;
  perSourceTimeoutMs?: Partial<Record<CoverageSource, number>>;
  /** Hard cap on planned sources (default 3). */
  maxSources?: number;
}

export interface CoverageStep {
  source: CoverageSource;
  /** Run always, or only when rows so far < stopWhenRows. */
  condition: "always" | "if-insufficient";
  timeoutMs: number;
  reason: string;
}

export interface CoverageDecision {
  steps: CoverageStep[];
  stopWhenRows: number;
  terminal: CoverageTerminal;
  notes: string[];
}

const DEFAULT_TIMEOUTS: Record<CoverageSource, number> = {
  "hot-index": 4000,
  // Cold S3 parquet scans (10–250MB files, two-pass city search) routinely
  // exceed 15s: 60s keeps the bound honest instead of killing live fallbacks.
  // (Acceptance-proven: bd.parquet dentist scan timed out at 15s.)
  "s3-parquet": 60000,
  provider: 20000,
};

const MATRIX_ENTITY: Record<CoverageEntity, string> = {
  business: "businesses",
  company: "companies",
  person: "people",
};

export function selectCoverageSources(
  input: {
    entity: CoverageEntity;
    /** ISO2 uppercase preferred; anything else → uncovered path. */
    countryIso: string;
    cityNorm?: string | null;
    pageSize?: number;
  },
  matrix: CoverageMatrix,
  budget: CoverageBudget = {},
): CoverageDecision {
  const notes: string[] = [];
  const iso = (input.countryIso ?? "").trim().toUpperCase();
  const isoKnown = /^[A-Z]{2}$/.test(iso);
  const pageSize = Math.max(1, input.pageSize ?? 20);
  const stopWhenRows = budget.minSufficientRows ?? Math.max(20, pageSize);
  const timeouts = { ...DEFAULT_TIMEOUTS, ...budget.perSourceTimeoutMs };
  const maxSources = Math.max(1, budget.maxSources ?? 3);

  const ent = matrix.entities[MATRIX_ENTITY[input.entity]] ?? {};
  const hotRows = isoKnown ? (ent.hotIndexByIso?.[iso] ?? 0) : 0;
  if (!isoKnown)
    notes.push(`unparseable country ${JSON.stringify(input.countryIso)}: hot-index treated as 0`);
  if (ent.hotIndexByIso === undefined)
    notes.push(
      "hot-index unmeasured in matrix: trying hot-index first anyway (cheapest when populated)",
    );

  // S3 presence: businesses resolve per-ISO file; companies/people are
  // pool-grain (files mix geographies) → pool presence only. s3Rows null
  // means "present, row count unmeasured" — still plans the tier.
  let s3Present = false;
  let s3Detail = "";
  if (input.entity === "business") {
    const g = isoKnown ? ent.byGeo?.[iso] : undefined;
    s3Present = (g?.s3Files ?? 0) > 0;
    s3Detail = s3Present
      ? `S3 file present (${g!.s3Rows ?? "unmeasured"} rows)`
      : "no S3 file for ISO";
  } else {
    // Older/generated people matrices expose `s3Files` without `s3Pool`.
    // Treat both shapes identically; otherwise a populated people corpus is
    // incorrectly classified as exhausted and no source is called.
    const files = ent.s3Pool?.files ?? ent.s3Files ?? 0;
    s3Present = files > 0;
    s3Detail = s3Present
      ? `S3 pool present (${files} files, mixed geographies — slug/initial grain unresolved)`
      : "S3 pool empty";
  }

  const providers = ent.declaredProviders ?? [];
  const providerCapable = providers.length > 0;

  let terminal: CoverageTerminal;
  if (!isoKnown && !s3Present && !providerCapable) terminal = "exhausted";
  else if (hotRows >= stopWhenRows) terminal = "covered";
  else if (hotRows > 0) terminal = "partial";
  else if (s3Present || providerCapable) terminal = "uncovered";
  else terminal = "exhausted";

  if (input.cityNorm && terminal !== "exhausted")
    notes.push(
      "city-grain unknown at plan time (matrix is country/pool grain): next tier kept as if-insufficient contingency",
    );

  const steps: CoverageStep[] = [];
  if (terminal !== "exhausted") {
    steps.push({
      source: "hot-index",
      condition: "always",
      timeoutMs: timeouts["hot-index"],
      reason:
        hotRows > 0
          ? `hot-index holds ~${hotRows} rows for ${iso || "?"}`
          : "hot-index cheapest when populated",
    });
    if (s3Present)
      steps.push({
        source: "s3-parquet",
        condition: "if-insufficient",
        timeoutMs: timeouts["s3-parquet"],
        reason: s3Detail,
      });
    if (providerCapable)
      steps.push({
        source: "provider",
        condition: "if-insufficient",
        timeoutMs: timeouts.provider,
        reason: `declared live capability: ${providers.join(", ")} (bounded, last resort)`,
      });
  } else {
    notes.push("no source covers this geography: honest empty state after zero calls");
  }

  const capped = steps.slice(0, maxSources);
  if (capped.length < steps.length)
    notes.push(
      `budget maxSources=${maxSources} dropped ${steps.length - capped.length} trailing tier(s)`,
    );
  return { steps: capped, stopWhenRows, terminal, notes };
}
