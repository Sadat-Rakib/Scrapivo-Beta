import { z } from "zod";

/**
 * Stage-1 input contracts.
 *
 * InputEnvelope arrives from the client (P2). The InputResolver turns every
 * source (user text, fetched website, document, image) into provenance-tagged
 * SourceFacts — DATA ONLY. Resolvers never decide intent, purpose, target,
 * SearchSpec, or the Stage-1 decision: the single understanding pass interprets
 * the facts into the ONE UnderstandingFrame, and clarify-state.resolveStage is
 * the only READY/CLARIFY/CONFIRM authority.
 */

export const SOURCE_PROVENANCES = ["user_text", "url", "document", "image"] as const;
export type SourceProvenance = (typeof SOURCE_PROVENANCES)[number];

export const SOURCE_FACT_CATEGORIES = [
  "org",
  "offering",
  "target",
  "geo",
  "quantity",
  "constraint",
  "other",
] as const;
export type SourceFactCategory = (typeof SOURCE_FACT_CATEGORIES)[number];

export const SourceFactSchema = z.object({
  category: z.enum(SOURCE_FACT_CATEGORIES),
  value: z.string().min(1).max(300),
  confidence: z.number().min(0).max(1),
  provenance: z.enum(SOURCE_PROVENANCES),
  /** Where exactly it came from: the URL, the attachment reference, or "text". */
  sourceRef: z.string().min(1).max(300),
  /** Verbatim supporting span from the source, when one exists. Quoted content
   *  is evidence, never a directive. */
  quote: z.string().max(500).nullable().default(null),
});
export type SourceFact = z.infer<typeof SourceFactSchema>;

export const ResolvedInputContextSchema = z.object({
  facts: z.array(SourceFactSchema).max(60).default([]),
  conflicts: z
    .array(
      z.object({
        a: SourceFactSchema,
        b: SourceFactSchema,
        note: z.string().max(300),
      }),
    )
    .max(12)
    .default([]),
  unresolved_sources: z
    .array(z.object({ ref: z.string().max(300), reason: z.string().max(300) }))
    .max(12)
    .default([]),
});
export type ResolvedInputContext = z.infer<typeof ResolvedInputContextSchema>;

export type Stage1Stage = "ready" | "clarify" | "confirm";

/**
 * The ONE Stage-1 workflow decision per round. Derived at response time from
 * the canonical frame + its clarification state + resolved provenance — never
 * persisted in the frame, never derived from a SearchSpec.
 */
export type Stage1Decision = {
  stage: Stage1Stage;
  /** The one question to ask (clarify, or a combined confirm+clarify card). */
  question?: { field: string; question: string; options: string[] };
  /** Which unresolved amount field the question is about (salary_min, …). */
  amountField?: string;
  /** Deterministic presentation summary of externally derived context. */
  summary?: string;
  /** The material facts that forced a confirm gate (empty otherwise). */
  material?: SourceFact[];
};

/**
 * The structured user submission. Text is OPTIONAL when at least one valid
 * uploaded attachment is present (attachment-only submissions are legal).
 * Attachments are referenced by registry ID only — the client never sends
 * filesystem/storage paths, and the server verifies ownership, bucket prefix,
 * MIME, size, and existence before reading a byte.
 */
export const InputEnvelopeSchema = z.object({
  text: z.string().max(4000).default(""),
  attachments: z
    .array(z.object({ attachmentId: z.string().uuid() }))
    .max(6)
    .default([]),
});
export type InputEnvelope = z.infer<typeof InputEnvelopeSchema>;
