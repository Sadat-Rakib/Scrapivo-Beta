import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { ClarifyQuestion } from "./clarifier";

const MemorySchema = z.object({
  service: z.string().max(200).nullable().optional(),
  niche: z.string().max(200).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  audience: z.string().max(40).nullable().optional(),
  goal: z.string().max(40).nullable().optional(),
  experience_level: z.string().max(10).nullable().optional(),
  work_style: z.string().max(40).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  about_doc: z.string().max(1500).nullable().optional(),
});

const TokensSchema = z.object({
  raw: z.string().max(1000),
  expanded: z.string().max(1000),
  category: z.enum(["investor", "job", "business", "company", "people", "unknown"]),
  stage: z.string().max(40).nullable(),
  sector: z.string().max(80).nullable(),
  geo: z.string().max(120).nullable(),
  scale: z.number().int().positive().nullable(),
  urgency: z.boolean(),
  keywords: z.array(z.string().max(60)).max(60),
});

const Input = z.object({
  query: z.string().min(1).max(1000),
  memory: MemorySchema.optional(),
  tokens: TokensSchema.optional(),
  /** Extended thinking: slower, more careful extraction + bigger budgets. */
  thinker: z.boolean().optional(),
});

/**
 * Server-only entry for dynamic clarifying questions.
 *
 * MUST stay behind createServerFn: the slot extractor / question generator
 * pull in server-only modules (AI router -> node:crypto cache). Importing
 * those `.server` modules directly from a client component drags node
 * builtins into the browser bundle and breaks the production build.
 */
export const prepareDynamicQuestions = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{ questions: ClarifyQuestion[] }> => {
    // Vertical-first: investor / local / job asks ALWAYS get the deterministic
    // per-vertical question sets, seeded with the slots the input already
    // stated — questions stay tailored to what the user typed and never drift
    // to a wrong vertical ("years of experience" on an investor hunt). The
    // LLM generator is only trusted for the ambiguous general vertical.
    const { resolveSearchVertical } = await import("./vertical");
    const vertical = resolveSearchVertical(data.query);
    if (vertical !== "general") {
      const { classifyQuery } = await import("./query-classifier");
      const { buildClarifyingQuestions } = await import("./clarifier");
      const classified = classifyQuery(data.query);
      return {
        questions: buildClarifyingQuestions(classified, {
          hasLocation: !!classified.location || !!data.memory?.location,
          known: {
            stage: data.tokens?.stage ?? null,
            sector: data.tokens?.sector ?? null,
            geo: data.tokens?.geo ?? data.memory?.location ?? null,
          },
          niche: data.memory?.niche ?? null,
        }),
      };
    }
    const { extractSlots } = await import("./slot-extractor.server");
    const { generateQuestions } = await import("./question-generator.server");
    const thinker = data.thinker ?? false;
    const slots = await extractSlots(data.query, data.tokens ?? undefined, {
      temperature: thinker ? 0.05 : 0.1,
      maxTokens: thinker ? 1024 : 512,
    });
    if (!slots.missing_slots.length) return { questions: [] };
    const questions = await generateQuestions(
      slots,
      {
        service: data.memory?.service ?? null,
        niche: data.memory?.niche ?? null,
        location: data.memory?.location ?? null,
        audience: data.memory?.audience ?? null,
        goal: data.memory?.goal ?? null,
        experience_level: data.memory?.experience_level ?? null,
        work_style: data.memory?.work_style ?? null,
        website: data.memory?.website ?? null,
        about_doc: data.memory?.about_doc ?? null,
      },
      { maxTokens: thinker ? 1200 : 800 },
    );
    return { questions };
  });
