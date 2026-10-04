/**
 * Understanding Engine — the canonical UnderstandingFrame.
 *
 * One structure that says what the user meant, independent of how it will be
 * retrieved. Gate 1 produces this and nothing else: no DB, no SearXNG, no OSM,
 * no browser, no enrichment.
 *
 * Three properties the old SearchSpec did not have, and the reasons:
 *
 * 1. DIRECTION IS FIRST CLASS. "marketing agencies in Bristol" and "companies
 *    in Bristol needing marketing" are opposite commercial positions that the
 *    old layer flattened into near-identical specs. SUBJECT -> RELATION ->
 *    OBJECT with an explicit direction is the whole point of this rewrite.
 *
 * 2. PROVENANCE ON EVERY NORMALIZED VALUE. `Traced`/`OpenValue` keep the raw
 *    span beside the normalized value, so "tryna bring on" -> hiring is
 *    inspectable instead of mysterious.
 *
 * 3. OPEN DESCRIPTORS. role / industry / category / service / product /
 *    technology / niche / job_title / business_type are open strings. A
 *    request must never fail because a word was missing from vocab.ts.
 */

import { z } from "zod";
import { SourceFactSchema } from "./input-envelope";
import {
  CLARIFICATION_REASONS,
  DIRECTIONS,
  ENTITY_TYPES,
  LOCATION_SCOPES,
  OPERATORS,
  OUTPUT_KINDS,
  PROSPECTING_MODES,
  RELATION_TYPES,
  TASK_TYPES,
  TEMPORAL_RELATIONS,
  VERIFICATION_KINDS,
} from "./vocab";

export const FRAME_VERSION = "u1" as const;

// ── Provenance primitives ─────────────────────────────────────────────────

/** A closed-enum value with the span it came from. */
export const TracedEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.object({
    value: z.enum(values),
    raw: z.string().max(400).nullable().default(null),
    confidence: z.number().min(0).max(1).default(0.5),
  });

/**
 * An OPEN descriptor. `value` is always the user's own meaning, cleaned;
 * `normalized` is a canonical form only when one happened to be known.
 * An unrecognized descriptor has `normalized: null` and is completely valid.
 */
export const OpenValueSchema = z.object({
  value: z.string().min(1).max(200),
  raw: z.string().max(400).nullable().default(null),
  normalized: z.string().max(200).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type OpenValue = z.infer<typeof OpenValueSchema>;

// ── Constraints: operators and negation, never prose ──────────────────────

/**
 * "not agencies", "excluding Toronto", "at least 100 employees",
 * "under $150/hour", "more than 4 stars", "no website", "within 30 miles",
 * "either dentists or orthodontists".
 *
 * These are structural, because retrieval will dispatch on the operator. Left
 * in a raw_constraints string bag they would have to be re-parsed later by
 * whatever reads them, which is how the last layer rotted. `field` is OPEN
 * (an unrecognized field is kept verbatim); `operator` is closed.
 */
export const ConstraintSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.enum(OPERATORS),
  value: z
    .union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(200)).max(20)])
    .nullable()
    .default(null),
  unit: z.string().max(40).nullable().default(null),
  /** True for "not", "excluding", "without", "no". Kept separate from the
   *  operator so `exists + negated` and `eq + negated` read the same way. */
  negated: z.boolean().default(false),
  raw: z.string().max(400).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

// ── Labelled kinds (extensible vocabularies) ──────────────────────────────

export const VerificationItemSchema = z.object({
  kind: z.enum(VERIFICATION_KINDS),
  /** Required when kind === "other"; the user's own words. */
  label: z.string().max(200).nullable().default(null),
  raw: z.string().max(400).nullable().default(null),
});
export type VerificationItem = z.infer<typeof VerificationItemSchema>;

export const OutputItemSchema = z.object({
  kind: z.enum(OUTPUT_KINDS),
  label: z.string().max(200).nullable().default(null),
  raw: z.string().max(400).nullable().default(null),
});
export type OutputItem = z.infer<typeof OutputItemSchema>;

// ── Target / relation / context ───────────────────────────────────────────

export const TargetSchema = z.object({
  entity_type: TracedEnum(ENTITY_TYPES),
  /**
   * The noun names a kind of thing that is legitimately BOTH a person and an
   * organization — "orthodontists", "luthiers", "veterinary orthopaedic
   * specialists". `entity_type` still carries the reading we went with (asking
   * would be noise), and this says out loud that the other reading is equally
   * defensible, so a reviewer — and the grader — can accept either instead of
   * treating one of them as an error.
   */
  entity_ambiguous: z.boolean().default(false),
  /** Open: "nonprofit", "clinic", "school", "municipality", "co-op". */
  entity_subtype: OpenValueSchema.nullable().default(null),
  role: OpenValueSchema.nullable().default(null),
  job_title: OpenValueSchema.nullable().default(null),
  industry: OpenValueSchema.nullable().default(null),
  category: OpenValueSchema.nullable().default(null),
  business_type: OpenValueSchema.nullable().default(null),
  niche: OpenValueSchema.nullable().default(null),
  company_stage: OpenValueSchema.nullable().default(null),
  technologies: z.array(OpenValueSchema).max(20).default([]),
  /** Anything descriptive we understood but that fits no named slot. */
  descriptors: z.array(OpenValueSchema).max(20).default([]),
});
export type Target = z.infer<typeof TargetSchema>;

export const RelationSchema = z.object({
  type: TracedEnum(RELATION_TYPES),
  /** Required when type === "custom": "using Shopify", "attending Web Summit". */
  label: z.string().max(200).nullable().default(null),
  /** What the relation acts on. Open — "developer", "website", "seo", "Stripe". */
  object: OpenValueSchema.nullable().default(null),
  direction: TracedEnum(DIRECTIONS),
});
export type Relation = z.infer<typeof RelationSchema>;

/**
 * A person can be the actor of a company-level relation — a founder hires on
 * behalf of their company. The target stays `person`; the company relationship
 * is recorded here rather than by forcing entity_type to "company", which
 * would break "founders in SF hiring developers" before retrieval even starts.
 */
export const OrganizationContextSchema = z.object({
  on_behalf_of_company: z.enum(["yes", "no", "unknown"]).default("unknown"),
  company: OpenValueSchema.nullable().default(null),
});

/**
 * What the USER told us about themselves — and the reason this block is
 * separate from everything else in the frame.
 *
 * "I sell website design. Find me 100 local businesses in Alberta" does NOT
 * mean each business needs website design. It means the searcher sells website
 * design and wants local businesses. Folding that into
 * `relation = needs_service(website design)` asserts a proven need that nobody
 * demonstrated, and every downstream qualification step would then look for
 * evidence of it and find none.
 *
 * The same sentence with "...that don't have a website" DOES carry a relation —
 * but it comes from the observable gap, not from the sales pitch.
 */
export const UserContextSchema = z.object({
  selling: z
    .object({
      service: OpenValueSchema.nullable().default(null),
      product: OpenValueSchema.nullable().default(null),
    })
    .nullable()
    .default(null),
  objective: OpenValueSchema.nullable().default(null),
  notes: z.array(OpenValueSchema).max(10).default([]),
});
export type UserContext = z.infer<typeof UserContextSchema>;

export const LocationSchema = z.object({
  value: z.string().min(1).max(160),
  raw: z.string().max(400).nullable().default(null),
  scope: z.enum(LOCATION_SCOPES).default("in"),
  /** Required when scope === "within_radius". */
  radius: z.number().positive().nullable().default(null),
  radius_unit: z.enum(["km", "miles"]).nullable().default(null),
  country_code: z.string().length(2).nullable().default(null),
  /** Set when the resolver recognized the place; null is normal for obscure
   *  towns and must never block understanding. */
  canonical: z.string().max(160).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type FrameLocation = z.infer<typeof LocationSchema>;

export const TemporalSchema = z.object({
  relation: z.enum(TEMPORAL_RELATIONS).default("any"),
  /** Trailing duration for relation=within_last: "30d" / "6w" / "3m". */
  window: z.string().max(12).nullable().default(null),
  year: z.string().length(4).nullable().default(null),
  raw: z.string().max(200).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});

/**
 * The two questions the old single `signal_required` boolean conflated.
 *
 *   "marketing agencies in Bristol"          claim: yes   intent: no
 *   "companies in Bristol needing marketing" claim: yes   intent: yes
 *
 * Claim evidence proves the stated attribute is true of the entity. Intent
 * signal proves they currently want something. Different evidence, different
 * sources, different freshness — one boolean could not carry both.
 */
export const EvidenceRequirementsSchema = z.object({
  claim_evidence_required: z.boolean().default(true),
  intent_signal_required: z.boolean().default(false),
  reasons: z.array(z.string().max(200)).max(10).default([]),
});

/**
 * "50" and "at least 50" and "up to 50" are three different asks and the
 * difference decides when retrieval may stop. `requested` is a target,
 * `minimum` is a floor the caller will judge the run by, `maximum` is a
 * ceiling, and `unlimited` is "as many as possible" — which is not a number
 * and must not be stored as a very large one.
 */
export const QuantitySchema = z.object({
  requested: z.number().int().positive().nullable().default(null),
  minimum: z.number().int().positive().nullable().default(null),
  maximum: z.number().int().positive().nullable().default(null),
  unlimited: z.boolean().default(false),
  /** "around 20" — the number is a target, not a contract. */
  approximate: z.boolean().default(false),
  raw: z.string().max(120).nullable().default(null),
});
export type Quantity = z.infer<typeof QuantitySchema>;

// ── Compound requests ─────────────────────────────────────────────────────

/**
 * "Find startups in Helsinki hiring Rust developers and also find founders
 * asking for design help" is two searches. Gate 1 does not execute either, but
 * it must never quietly keep one half — the frame says so out loud and the
 * clarifier asks which to run (or to split).
 *
 * A subgoal is the semantic core only, not a nested frame: nesting the
 * long-form output/verification fields would imply per-subgoal deliverables
 * that nobody has asked for yet.
 */
export const SubgoalSchema = z.object({
  /**
   * The span of the request this subgoal came from, when the extractor can
   * name it.
   *
   * Nullable like every other provenance field in this file, and that
   * consistency is load-bearing rather than cosmetic: as a required string it
   * was the one place where missing PROVENANCE discarded a correct MEANING.
   * A model that split "find X in Oslo and also find Y in Bergen" into two
   * perfectly good subgoals and omitted this one string lost the whole frame
   * to the deterministic fallback — the compound reading it alone had produced.
   */
  raw: z.string().max(600).nullable().default(null),
  target: TargetSchema,
  relation: RelationSchema,
  location: LocationSchema.nullable().default(null),
  temporal: TemporalSchema.nullable().default(null),
  constraints: z.array(ConstraintSchema).max(30).default([]),
});
export type Subgoal = z.infer<typeof SubgoalSchema>;

// ── Clarification + meta ──────────────────────────────────────────────────

export const ClarificationSchema = z.object({
  needed: z.boolean().default(false),
  /** Field ids only — the question copy is generated, never stored here. */
  fields: z.array(z.string().max(60)).max(10).default([]),
  /** Why we are asking. A reviewer reads this before the question copy: it is
   *  what distinguishes a real blocker from the layer failing to read plain
   *  English. */
  reason: z.enum(CLARIFICATION_REASONS).nullable().default(null),
  question: z.string().max(300).nullable().default(null),
  /** Answers already given this conversation (field id -> answer text). Travels
   *  inside the frame so the state machine keeps its memory across the HTTP
   *  boundary instead of re-deriving it (and re-asking) every round. */
  answered: z.record(z.string().max(300)).optional(),
  /** Every field ever asked — an asked field is never re-asked, even when the
   *  answer could not be mapped onto the frame. */
  asked: z.array(z.string().max(60)).max(20).optional(),
});

/** Stage-1 provenance: where non-text facts came from (website / document /
 *  image resolver). Data only — provenance never carries instructions.
 *  Reuses the canonical SourceFact schema (input-envelope) so the frame and
 *  the resolver share one contract. */
const SourceFactOnFrame = SourceFactSchema;

export const RepairMetadataSchema = z.object({
  initial_parse_status: z.enum(["not_attempted", "valid_json", "invalid_json"]),
  initial_failure_class: z
    .enum(["malformed_json", "truncated_json", "non_json_response", "schema_invalid", "transport_error"])
    .nullable(),
  repair_attempted: z.boolean(),
  repair_reason: z
    .enum(["malformed_json", "truncated_json", "non_json_response", "schema_invalid"])
    .nullable(),
  repair_success: z.boolean().nullable(),
});

export const FrameMetaSchema = z.object({
  extractor: z.enum(["llm", "deterministic"]).default("deterministic"),
  /** Which provider answered, for latency attribution in the inspector. */
  provider: z.string().max(80).nullable().default(null),
  model: z.string().max(120).nullable().default(null),
  prompt_version: z.string().max(40).nullable().default(null),
  latency_ms: z.number().nonnegative().default(0),
  /** True when the LLM path was attempted and we fell back. */
  fallback_used: z.boolean().default(false),
  cached: z.boolean().default(false),
  /** Safe first-attempt repair telemetry; never contains raw provider output. */
  repair: RepairMetadataSchema.nullable().default(null),
  notes: z.array(z.string().max(300)).max(20).default([]),
});
export type FrameMeta = z.infer<typeof FrameMetaSchema>;

// ── The frame ─────────────────────────────────────────────────────────────

export const UnderstandingFrameSchema = z.object({
  version: z.literal(FRAME_VERSION).default(FRAME_VERSION),
  input: z.object({
    raw: z.string().max(4000),
    normalized: z.string().max(4000).nullable().default(null),
  }),

  task_type: TracedEnum(TASK_TYPES),
  /** Which kind of prospecting this is. Required on every valid frame: it is
   *  what makes this a lead engine rather than a search box. */
  prospecting_mode: TracedEnum(PROSPECTING_MODES),
  target: TargetSchema,
  relation: RelationSchema,
  organization_context: OrganizationContextSchema.default({
    on_behalf_of_company: "unknown",
    company: null,
  }),
  /** What the SEARCHER told us about themselves — never read as prospect
   *  qualification. See UserContextSchema. */
  user_context: UserContextSchema.default({ selling: null, objective: null, notes: [] }),

  location: LocationSchema.nullable().default(null),
  /** Alternative search areas joined by OR; the primary area remains location. */
  locations: z.array(LocationSchema).max(10).default([]),
  /** Explicit values the user referred to but did not supply. */
  unresolved: z.array(z.object({ field: z.string().max(80), raw: z.string().max(200) })).max(10).default([]),
  temporal: TemporalSchema.nullable().default(null),
  constraints: z.array(ConstraintSchema).max(40).default([]),
  evidence: EvidenceRequirementsSchema.default({
    claim_evidence_required: true,
    intent_signal_required: false,
    reasons: [],
  }),

  // Long-form requests carry real deliverables. "phone required, socials if
  // possible" is a required-vs-preferred distinction that decides what counts
  // as a usable row later, so it cannot live in a prose bag.
  quantity: QuantitySchema.nullable().default(null),
  required_fields: z.array(OpenValueSchema).max(30).default([]),
  preferred_fields: z.array(OpenValueSchema).max(30).default([]),
  contact_requirements: z.array(OpenValueSchema).max(20).default([]),
  verification: z.array(VerificationItemSchema).max(20).default([]),
  output: z.array(OutputItemSchema).max(10).default([]),
  source_preferences: z.array(OpenValueSchema).max(20).default([]),
  enrichment_requirements: z.array(OpenValueSchema).max(20).default([]),

  compound: z
    .object({
      is_compound: z.boolean().default(false),
      subgoals: z.array(SubgoalSchema).max(6).default([]),
    })
    .default({ is_compound: false, subgoals: [] }),

  clarification: ClarificationSchema.default({
    needed: false,
    fields: [],
    reason: null,
    question: null,
  }),
  /** Stage-1 provenance: non-text facts the resolver derived (website /
   *  document / image). Data with provenance — never instructions. Additive
   *  + optional so frames from older clients keep parsing. */
  sources: z.array(SourceFactOnFrame).max(60).optional(),
  /** Minimal monotonic confirm marker: the user accepted (or edited) the
   *  externally derived context, so the confirm gate never re-fires. */
  confirmation: z.object({ resolved: z.boolean() }).nullish(),
  meta: FrameMetaSchema.default({
    extractor: "deterministic",
    provider: null,
    model: null,
    prompt_version: null,
    latency_ms: 0,
    fallback_used: false,
    cached: false,
    notes: [],
  }),
});

export type UnderstandingFrame = z.infer<typeof UnderstandingFrameSchema>;

// ── Constructors ──────────────────────────────────────────────────────────

/**
 * Clamp a string to a schema ceiling. The constructors call this so that no
 * producer can build a frame the schema then rejects: a 500-character run of
 * one word is a legitimate thing for someone to type, and it must come back as
 * a truncated descriptor, not as a 500 from the inspector.
 */
export function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max);
}

/** The ceiling on a `raw` span, matching `TracedEnumSchema`/`OpenValueSchema`. */
export const RAW_MAX = 400;

export function openValue(
  value: string,
  raw?: string | null,
  normalized?: string | null,
  confidence = 0.6,
): OpenValue {
  return {
    value: clamp(value, 200),
    raw: clamp(raw ?? value, RAW_MAX),
    normalized: normalized == null ? null : clamp(normalized, 200),
    confidence,
  };
}

/**
 * A frame that admits it knows nothing. The deterministic fallback starts from
 * this and fills in only what it can actually justify — an honest "unknown" is
 * always better than an inherited guess.
 */
export function emptyFrame(raw: string): UnderstandingFrame {
  return UnderstandingFrameSchema.parse({
    input: { raw, normalized: null },
    task_type: { value: "unknown", raw: null, confidence: 0.2 },
    prospecting_mode: { value: "unknown", raw: null, confidence: 0.2 },
    target: {
      entity_type: { value: "unknown", raw: null, confidence: 0.2 },
    },
    relation: {
      type: { value: "unknown", raw: null, confidence: 0.2 },
      direction: { value: "unknown", raw: null, confidence: 0.2 },
    },
  });
}
