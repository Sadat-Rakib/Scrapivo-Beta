/**
 * Field-level freshness (Workstream 4).
 *
 * Freshness is per FIELD, not per record: a company's domain is stable for
 * months while its job postings rot in days. Stale records are never dropped
 * — they are MARKED (staleFields) so consumers can target-enrich exactly the
 * rotten fields instead of re-researching the whole entity.
 *
 * Classes:
 *   stable        90d — website/domain, identity, canonical urls
 *   medium        30d — description, employment/works_at, phone, employee
 *                       count, role, classification
 *   volatile       7d — job postings listings
 *   event         —   — funding_event / public posts: dated by their own
 *                       event observed_at, no TTL
 *   very-volatile  2d — intent signals
 *
 * Unknown fields default to "medium" (conservative middle). A field with no
 * observation timestamp is UNKNOWABLE, not stale — staleFields never marks it.
 */
import { NON_ENRICHABLE_FIELDS } from "./fact-projection";

export type FreshnessClass = "stable" | "medium" | "volatile" | "event" | "very-volatile";

export const FRESHNESS_TTL_DAYS: Record<Exclude<FreshnessClass, "event">, number> = {
  stable: 90,
  medium: 30,
  volatile: 7,
  "very-volatile": 2,
};

const DAY_MS = 86_400_000;

/**
 * Class → TTL + member fields. Event-timestamped fields have ttlDays null:
 * their own event observed_at is authoritative and they never go stale.
 */
export const FIELD_FRESHNESS: Record<
  FreshnessClass,
  { ttlDays: number | null; fields: readonly string[] }
> = {
  stable: {
    ttlDays: 90,
    fields: [
      // identity
      "name", "title", "kind", "entity_type", "entity_id", "entity_resolved",
      "key", "registry_key", "identity_confidence", "resolution_method",
      // canonical urls + web presence
      "url", "website", "website_url", "domain", "profile_url", "linkedin",
      "contact_page_url", "source_url", "no_website_verification",
      // location (identity-adjacent; businesses rarely move)
      "location", "city", "city_norm", "region", "country", "address", "postal_code",
    ],
  },
  medium: {
    ttlDays: 30,
    fields: [
      // description
      "detail", "description",
      // classification
      "category", "category_raw", "industry", "sector",
      // employment / works_at relations
      "role", "role_norm", "company", "company_domain", "employer",
      // contact facts decay with the org
      "phone", "phone_status", "phoneStatus", "email",
    ],
  },
  volatile: {
    ttlDays: 7,
    fields: ["apply_url", "salary", "posted_at"],
  },
  event: {
    // Funding events and public posts carry their own event observed_at.
    ttlDays: null,
    fields: ["funding_event", "public_post", "post", "social_post"],
  },
  "very-volatile": {
    ttlDays: 2,
    fields: [
      // Judgment-layer fields (never persist, classified for completeness)
      "intent_score", "relevance_score", "why_match", "fit_score",
      "intent_relevance", "opportunity",
    ],
  },
};

const CLASS_OF_FIELD: ReadonlyMap<string, FreshnessClass> = (() => {
  const m = new Map<string, FreshnessClass>();
  for (const [cls, def] of Object.entries(FIELD_FRESHNESS) as [FreshnessClass, { fields: readonly string[] }][]) {
    for (const f of def.fields) if (!m.has(f)) m.set(f, cls);
  }
  return m;
})();

/** Freshness class for a field; unknown fields default to "medium". */
export function fieldFreshnessClass(field: string): FreshnessClass {
  return CLASS_OF_FIELD.get(field) ?? "medium";
}

type Timestampish = string | Date | null | undefined;

function toMs(at: Timestampish): number | null {
  if (!at) return null;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Is `field` fresh as of `now`, given when it was observed?
 * - No/invalid observedAt → false (no evidence of freshness).
 * - Event-timestamped fields are always fresh (their own clock rules).
 * - Otherwise fresh iff age < class TTL (exactly-at-TTL is stale).
 */
export function isFieldFresh(
  field: string,
  observedAt: Timestampish,
  now?: Date,
): boolean {
  const observed = toMs(observedAt);
  if (observed === null) return false;
  const cls = fieldFreshnessClass(field);
  if (cls === "event") return true;
  const asOf = (now ?? new Date()).getTime();
  return asOf - observed < FRESHNESS_TTL_DAYS[cls] * DAY_MS;
}

const NON_ENRICHABLE: ReadonlySet<string> = new Set(NON_ENRICHABLE_FIELDS);

/**
 * Fields that are stored (allowlisted) but are observation metadata, never
 * enrichment targets: evidence/provenance, index bookkeeping, and the
 * timestamps themselves. Excluded from staleness marking and reuse counting.
 */
export const STALE_SKIP_FIELDS: ReadonlySet<string> = new Set([
  ...NON_ENRICHABLE_FIELDS,
  "last_seen",
  "observed_at",
  "event_at",
  "field_observed_at",
]);

/** A record value counts as present when non-null and not an empty string. */
function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

interface ObservedLookup {
  map: Map<string, number>;
  hasAny: boolean;
}

/**
 * Per-field observation timestamps for a record:
 *   field_observed_at map > field_provenance[].observed_at > record-level
 *   observed_at/last_seen > caller fallback.
 */
function observedLookup(
  record: Record<string, unknown>,
  fallback?: Timestampish,
): ObservedLookup {
  const map = new Map<string, number>();
  const existing = record.field_observed_at as Record<string, Timestampish> | undefined;
  const provenance = record.field_provenance as
    | Record<string, { observed_at?: Timestampish }>
    | undefined;
  const recordLevel = toMs((record.observed_at ?? record.last_seen) as Timestampish) ??
    toMs(fallback);
  for (const field of Object.keys(record)) {
    if (STALE_SKIP_FIELDS.has(field)) continue;
    if (!hasValue(record[field])) continue;
    const at = toMs(existing?.[field]) ??
      toMs(provenance?.[field]?.observed_at) ??
      recordLevel;
    if (at !== null) map.set(field, at);
  }
  return { map, hasAny: map.size > 0 };
}

/**
 * Which present fact fields are stale as of `now`?
 * Untimestamped fields are unknowable — never marked. Event-timestamped
 * fields never expire. Returns [] for records with no observation metadata.
 */
export function staleFields(record: object, now?: Date): string[] {
  const rec = record as Record<string, unknown>;
  const { map, hasAny } = observedLookup(rec);
  if (!hasAny) return [];
  const asOf = now ?? new Date();
  const out: string[] = [];
  for (const field of Object.keys(rec)) {
    if (STALE_SKIP_FIELDS.has(field)) continue;
    const at = map.get(field);
    if (at === undefined) continue; // unknowable
    if (!isFieldFresh(field, new Date(at), asOf)) out.push(field);
  }
  return out;
}

export interface FreshnessStamp {
  /** Per-field observation timestamps (ISO) for the fact fields present. */
  field_observed_at?: Record<string, string>;
  /** Fields past their freshness TTL — target-enrich these, don't drop. */
  staleFields?: string[];
}

export interface StampFreshnessOpts {
  now?: Date;
  /** Record-level observation time (e.g. idx_* last_seen read from the DB). */
  observedAtFallback?: Timestampish;
}

/**
 * Attach freshness metadata to a read-back record: field_observed_at
 * passthrough (built from field_provenance / record timestamps when absent)
 * plus staleFields. Pure — returns a new object; the record is not dropped
 * or rewritten.
 */
export function stampFreshness<T extends object>(
  record: T,
  opts?: StampFreshnessOpts,
): T & FreshnessStamp {
  const rec = record as Record<string, unknown>;
  const { map } = observedLookup(rec, opts?.observedAtFallback);
  const fieldObservedAt: Record<string, string> = {};
  for (const [field, ms] of map) fieldObservedAt[field] = new Date(ms).toISOString();
  return {
    ...rec,
    field_observed_at: fieldObservedAt,
    staleFields: staleFields(rec, opts?.now),
  } as T & FreshnessStamp;
}
