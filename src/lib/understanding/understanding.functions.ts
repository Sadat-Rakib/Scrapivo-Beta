/**
 * Understanding Engine — the Gate 1 server surface.
 *
 * This is the ONLY entry point, and it does exactly one thing: turn text into
 * an inspected UnderstandingFrame. It touches no database, no SearXNG, no OSM,
 * no browser and no enrichment — not because those are unfinished, but because
 * a layer that can reach retrieval will eventually be judged by retrieval
 * results instead of by whether it understood the sentence.
 *
 * Pipeline:
 *   text -> LLM extraction -> deterministic validation -> clarification sync
 *
 * The validator runs AFTER the model and cannot be talked out of its rules;
 * the clarification sync makes the frame's own account of what is missing
 * agree with the state machine's.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import {
  patchFrame,
  syncClarification,
  unresolvedFields,
  nextQuestion,
  type BlockingField,
  type ClarificationState,
} from "./clarify-state";
import { UnderstandingFrameSchema, type UnderstandingFrame } from "./frame";
import { hasBlockingViolation, validateFrame, type Repair, type Violation } from "./validate";
import { BLOCKING_FIELDS } from "./clarify-state";

const UnderstandInput = z.object({
  query: z.string().min(1).max(4000),
  /** Inspector and grader pass true: they must measure the live prompt, not a
   *  stored answer from before the last prompt edit. */
  bypassCache: z.boolean().optional(),
  /** Previously answered clarification fields, as context for the extractor.
   *  They are NOT re-parsed into the frame — `patchFrame` owns that. */
  context: z.record(z.string().max(60), z.string().max(400)).optional(),
});

const PatchInput = z.object({
  frame: z.unknown(),
  answered: z.record(z.string().max(60), z.string().max(400)).default({}),
  asked: z.array(z.string().max(60)).max(20).default([]),
  turns: z.number().int().nonnegative().default(0),
  field: z.enum(BLOCKING_FIELDS),
  answer: z.string().max(400),
});

export type UnderstandResult = {
  frame: UnderstandingFrame;
  violations: Violation[];
  repairs: Repair[];
  blocked: boolean;
  question: { field: BlockingField; question: string; options: string[] } | null;
  /** Present only when extraction failed and the deterministic path answered. */
  extractionError: string | null;
  /** The model's own text, for the inspector when the shape was wrong. */
  rawResponse: string | null;
};

/**
 * Understand a query. Nothing is searched, stored or enriched.
 */
export const understandQuery = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => UnderstandInput.parse(d))
  .handler(async ({ data }): Promise<UnderstandResult> => {
    // Imported here rather than at module scope so the browser bundle never
    // pulls the provider router in through this file's type exports.
    const { extractFrameLLM } = await import("./extract.server");

    const extracted = await extractFrameLLM(data.query, {
      bypassCache: data.bypassCache,
      context: data.context,
    });

    const { frame: validated, violations, repairs } = validateFrame(extracted.frame);
    const frame = syncClarification(validated);

    const state: ClarificationState = {
      version: "u1",
      frame,
      answered: data.context ?? {},
      asked: [],
      turns: 0,
    };
    const q = nextQuestion(state);

    return {
      frame,
      violations,
      repairs,
      blocked: hasBlockingViolation(violations) || unresolvedFields(state).length > 0,
      question: q,
      extractionError: extracted.error,
      rawResponse: extracted.rawResponse,
    };
  });

/**
 * Apply one clarification answer. The original query is never re-parsed and no
 * extraction happens here — that is what makes clarification monotonic.
 */
export const answerClarification = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => PatchInput.parse(d))
  .handler(async ({ data }): Promise<UnderstandResult> => {
    const parsed = UnderstandingFrameSchema.parse(data.frame);
    const state: ClarificationState = {
      version: "u1",
      frame: parsed,
      answered: data.answered,
      asked: data.asked,
      turns: data.turns,
    };

    const { state: next, note } = patchFrame(state, data.field, data.answer);
    // Re-validated because an answer can create a contradiction the extractor
    // never had the chance to make — a user insisting on a direction the
    // wording denies, for instance.
    const { frame, violations, repairs } = validateFrame(next.frame);
    const synced = syncClarification(frame);
    const settledState: ClarificationState = { ...next, frame: synced };
    const q = nextQuestion(settledState);

    return {
      frame: synced,
      violations,
      repairs,
      blocked: hasBlockingViolation(violations) || unresolvedFields(settledState).length > 0,
      question: q,
      extractionError: null,
      rawResponse: null,
    };
  });

/** Re-exported so the inspector can render field ids without a second import. */
export { BLOCKING_FIELDS };
