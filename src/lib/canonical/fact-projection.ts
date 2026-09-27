/**
 * Canonical-facts-only projection (Workstream 4).
 *
 * Hard split of the research pipeline:
 *   Canonical Research Graph → Project/Job Evaluation → Opportunity Packet.
 *
 * Canonical storage (idx_* tables, parquet canonical datasets) holds globally
 * reusable FACTS only: identity, public contact, location, description,
 * employment relations, funding/job events, source URLs + observation
 * timestamps. Thesis-specific JUDGMENTS (why_match, fit/intent scores,
 * disposition, outreach angles, "good prospect" flags) belong to the
 * Project/Job Evaluation layer and must NEVER reach canonical storage —
 * this module is the gate the write-back path runs through.
 */

// ---------------------------------------------------------------------------
// Allowlist — globally reusable fact keys
// ---------------------------------------------------------------------------

/**
 * Fact fields that may reach idx_* / canonical storage. Derived from what
 * persist-live actually writes for idx_* rows (identity/contact/location/
 * description/employment) plus the canonical graph's event nouns
 * (funding_event, job_posting) and their evidence/timestamps.
 */
export const CANONICAL_FACT_FIELDS: readonly string[] = [
  // identity
  "name",
  "title",
  "kind",
  "entity_type",
  "entity_id",
  "entity_resolved",
  "key",
  "registry_key",
  "page_type",
  "source_page_type",
  "identity_confidence",
  "resolution_method",
  // public contact facts
  "email",
  "phone",
  "phone_status",
  "phoneStatus",
  // location
  "location",
  "city",
  "city_norm",
  "region",
  "country",
  "address",
  "postal_code",
  // classification + description
  "category",
  "category_raw",
  "industry",
  "sector",
  "detail",
  "description",
  // employment / works_at relations
  "role",
  "role_norm",
  "company",
  "company_domain",
  "employer",
  // web presence + source URLs (canonical destination, contact/profile page,
  // and the observation page the facts came from)
  "url",
  "website",
  "website_url",
  "domain",
  "contact_page_url",
  "profile_url",
  "linkedin",
  "apply_url",
  "source_url",
  // bounded structural absence verification (fact about the record)
  "no_website_verification",
  // job_posting facts
  "salary",
  "posted_at",
  // funding_event facts
  "funding_event",
  // evidence + field-level provenance ride with the facts (timestamps)
  "evidence",
  "field_provenance",
  // observation timestamps
  "last_seen",
  "observed_at",
  "event_at",
  "field_observed_at",
] as const;

/**
 * Index bookkeeping columns the write-back stores alongside facts. They are
 * stored but are never enrichment targets nor staleness candidates.
 */
export const CANONICAL_BOOKKEEPING_FIELDS: readonly string[] = [
  "source",
  "content_hash",
  "quality_score",
  "junk_flag",
] as const;

/** Fields that are stored but must never be counted/checked as fresh facts. */
export const NON_ENRICHABLE_FIELDS: readonly string[] = [
  ...CANONICAL_BOOKKEEPING_FIELDS,
  "evidence",
  "field_provenance",
] as const;

// ---------------------------------------------------------------------------
// Judgment detection — thesis-specific keys
// ---------------------------------------------------------------------------

/**
 * Explicit thesis-specific (Project/Job Evaluation) fields. Anything here was
 * computed FOR this run's request — ranking/outreach/fit judgments are not
 * properties of the entity and must not leak into the canonical graph.
 */
export const JUDGMENT_FIELDS: readonly string[] = [
  "why_match",
  "fit_score",
  "match_score",
  "fit_reason",
  "thesis_fit",
  "relevance_score",
  "intent_score",
  "intent_relevance",
  "ranking",
  "rank",
  "rank_score",
  "lead_score",
  "priority_score",
  "outreach",
  "outreach_angle",
  "outreach_priority",
  "outreach_message",
  "good_prospect",
  "prospect_fit",
  "disposition",
  "disposition_label",
] as const;

/** Underscore-bounded token match for judgment-style keys not in the list. */
const JUDGMENT_KEY_RE =
  /(^|_)(outreach|prospect|rank|ranking|intent|relevance|disposition|fit)($|_)/;

/**
 * Which thesis-specific judgment keys does this record carry?
 * Returns the offending key names (explicit list + pattern matches), so the
 * caller can report and the projector can strip them.
 */
export function rejectJudgmentFields(row: object): string[] {
  const rec = row as Record<string, unknown>;
  const offenders: string[] = [];
  for (const key of Object.keys(rec)) {
    if ((JUDGMENT_FIELDS as readonly string[]).includes(key)) {
      offenders.push(key);
      continue;
    }
    if (JUDGMENT_KEY_RE.test(key)) offenders.push(key);
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const FACT_FIELD_SET: ReadonlySet<string> = new Set(CANONICAL_FACT_FIELDS);

/**
 * Project a record down to ONLY the canonical fact allowlist (plus the
 * evidence/timestamps fields those facts carry). Judgment fields and any
 * unknown key are dropped; allowlisted keys pass through untouched (values
 * are never rewritten — no weakening of verification artifacts).
 */
export function canonicalFactProjection<T extends object>(row: T): T {
  const rec = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rec)) {
    if (!FACT_FIELD_SET.has(key)) continue;
    out[key] = rec[key];
  }
  return out as T;
}
