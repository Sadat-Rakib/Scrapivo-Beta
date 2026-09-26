/**
 * Structured search spec — the single source of truth for the conversational
 * search state machine (Phase 1).
 *
 * Every user message is extracted into a SearchSpec BEFORE any retrieval.
 * Downstream components (clarifier, playbook, DB readers, live fan-out) consume
 * THIS object — never re-infer intent from raw text.
 *
 * Anti-theater rules (locked):
 * - Inferred fields are NEVER silently treated as stated (stated flag + confidence).
 * - missing[] drives clarification 1:1 — a question must map to an actually
 *   missing field, proven per prompt in E2E verification.
 * - status=ready_to_search requires zero materially-missing fields.
 */

import type { UnderstandingFrame } from '../understanding/frame';

export type SpecEntity = "person" | "company" | "business" | "investor" | "job" | "unknown";

export type SpecStatus =
  | "needs_clarification"
  | "ready_to_search"
  | "searching"
  | "complete";

export interface SpecField {
  /** Canonical field name, e.g. "industry", "location", "role". */
  field: string;
  value: string;
  /** True only when the user explicitly stated it. */
  stated: boolean;
  /** 0..1 — meaningful only when stated=false. */
  confidence: number;
}

/** A fuzzy location guess awaiting user confirmation — never searched. */
export interface LocationSuggestion {
  /** What the user typed, e.g. "Daaka". */
  typed: string;
  /** Canonical suggestion, e.g. "Dhaka". */
  suggestion: string;
  /** Similarity 0..1 (informational; policy is always-ask). */
  confidence: number;
}

export interface SearchSpec {
  entity: SpecEntity;
  /** Extracted criteria (stated + inferred). */
  criteria: SpecField[];
  /** Fields materially missing for this entity+intent (drives questions). */
  missing: string[];
  signal_required: boolean;
  signal_types: string[];
  /** e.g. "7d", "90d", null when unknown. */
  signal_recency: string | null;
  status: SpecStatus;
  /** Verbatim user wording for audit. */
  raw_query: string;
  /** Authoritative interpretation, including raw spans and extraction telemetry. */
  understanding?: UnderstandingFrame;
  /** Fuzzy location guess (location stays missing until confirmed). */
  locationSuggestion?: LocationSuggestion | null;
}

const stated = (field: string, value: string): SpecField => ({
  field,
  value,
  stated: true,
  confidence: 1,
});

/** Required-field matrices per entity (Phase 1; thresholds stay configurable). */
const REQUIRED: Record<Exclude<SpecEntity, "unknown">, string[]> = {
  person: ["role"],
  company: [],
  business: ["location"],
  investor: ["investor_stage", "investor_sector", "investor_check", "location"],
  job: ["role"],
};

export function getField(spec: SearchSpec, field: string): SpecField | undefined {
  return spec.criteria.find((c) => c.field === field);
}

export function hasField(spec: SearchSpec, field: string): boolean {
  const f = getField(spec, field);
  return !!f && f.value.trim().length > 0;
}

/**
 * Compute materially-missing fields for a spec. Location/industry are optional
 * for broad person searches; location scopes business directory searches.
 * Bare-entity rule (locked): an entity with ZERO stated criteria and no
 * signal intent must ask (company → industry + location) instead of running
 * a worldwide trawl. Signal-carrying intents ("looking for X developers")
 * proceed — the intent itself is the requirement.
 */
/**
 * Criteria fields that never satisfy a requirement on their own: display
 * metadata (seniority), intent mode/offer, and opportunity preference.
 * Counting them as "stated" let bare-entity queries bypass the gate.
 */
const NON_SUBSTANTIVE = new Set([
  "mode",
  "offer",
  "seniority",
  "geo_scope",
  "opportunity",
  "location_id",
  "location_kind",
  "location_country",
  "location_scope",
  "location_parents",
  "temporal_relation",
  "temporal_year",
  "technology",
  "company_stage",
]);

/** Need/request fields are substantive for bare-entity gates but are not identity. */
const NEED_FIELDS = new Set([
  "requested_service",
  "requested_role",
  "requested_product",
  "funding_status",
]);

export function computeMissing(spec: SearchSpec): string[] {
  if (spec.entity === "unknown") return ["entity"];
  const worldwide = hasField(spec, "geo_scope") && getField(spec, "geo_scope")?.value === "worldwide";
  const hasNeed =
    spec.signal_required ||
    spec.criteria.some((c) => NEED_FIELDS.has(c.field) && c.value.trim());
  if (
    spec.entity === "company" &&
    spec.criteria.filter((c) => !NON_SUBSTANTIVE.has(c.field)).length === 0 &&
    !hasNeed
  ) {
    return worldwide ? ["industry"] : ["industry", "location"];
  }
  const required = (REQUIRED[spec.entity] ?? []).filter((f) => {
    if (f === "location" && worldwide) return false;
    // Phase 1A: person role identity is optional when the need phrase carries
    // requested_role/service (demand hunt) or signal_required.
    if (
      f === "role" &&
      spec.entity === "person" &&
      (spec.signal_required ||
        hasField(spec, "requested_role") ||
        hasField(spec, "requested_service") ||
        hasField(spec, "requested_product"))
    ) {
      return false;
    }
    return true;
  });
  return required.filter((f) => !hasField(spec, f));
}

export function buildSpec(args: {
  entity: SpecEntity;
  criteria: SpecField[];
  signal_required?: boolean;
  signal_types?: string[];
  signal_recency?: string | null;
  raw_query: string;
  locationSuggestion?: LocationSuggestion | null;
}): SearchSpec {
  const spec: SearchSpec = {
    entity: args.entity,
    criteria: args.criteria,
    missing: [],
    signal_required: args.signal_required ?? false,
    signal_types: args.signal_types ?? [],
    signal_recency: args.signal_recency ?? null,
    status: "ready_to_search",
    raw_query: args.raw_query,
    locationSuggestion: args.locationSuggestion ?? null,
  };
  spec.missing = computeMissing(spec);
  spec.status = spec.missing.length ? "needs_clarification" : "ready_to_search";
  return spec;
}

export { stated };
