/**
 * Signal layer types — separate from static lead facts (locked architecture).
 *
 * Lifecycle: raw → candidates → verified. `rejected` is terminal but preserved.
 * Insufficient evidence stays `candidate`, never `verified`. LLMs may
 * summarize/classify evidence but never invent facts. Conflicts are preserved
 * with lowered confidence, never silently resolved.
 */

export type SignalType =
  | "service_request"
  | "buying_intent"
  | "hiring"
  | "job_change"
  | "funding"
  | "launch"
  | "expansion"
  | "technology_change"
  | "discussion"
  | "question"
  | "announcement";

export type SignalState = "candidate" | "verified" | "rejected";

export type EntityMatchMethod =
  | "exact_profile_url"
  | "exact_email"
  | "verified_phone"
  | "domain"
  | "registry_id"
  | "name_company"
  | "fuzzy_candidate";

export interface LeadSignal {
  signal_id: string;
  /** Canonical entity id this signal attaches to (null while candidate). */
  entity_id: string | null;
  signal_type: SignalType;
  topic: string;
  /** Extractive summary of the source — never invented. */
  text_summary: string;
  platform: string;
  source_url: string;
  published_at: string | null;
  discovered_at: string;
  /** Days since published_at (null when unpublished/unknown). */
  recency_days: number | null;
  /** 0..1 confidence in the signal content itself. */
  confidence: number;
  /** Verbatim evidence spans / structured observations backing the signal. */
  evidence: string[];
  /** How it was found: "searxng" | "rss" | "campaign_engagement" | ... */
  method: string;
  state: SignalState;
  entity_match_method: EntityMatchMethod | null;
  /** 0..1 confidence in the entity linkage. Below threshold ⇒ stays candidate. */
  entity_match_confidence: number | null;
  matched_entity_id: string | null;
}

export interface RelevanceInput {
  /** Structured user intent (entity, filters, signal_required, ...). */
  intent: Record<string, unknown>;
  /** Canonical lead facts. */
  facts: Record<string, unknown>;
  /** Verified signals attached to the lead (empty for static queries). */
  signals: LeadSignal[];
}

export interface RelevanceResult {
  relevance_score: number;
  matched_criteria: string[];
  /** Grounded ONLY in supplied facts/signals. Empty string when evidence thin. */
  why_relevant: string;
}
