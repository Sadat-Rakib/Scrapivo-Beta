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

const Input = z.object({
  query: z.string().min(1).max(1000),
  memory: MemorySchema.optional(),
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
    const { extractSlots } = await import("./slot-extractor.server");
    const { generateQuestions } = await import("./question-generator.server");
    const slots = await extractSlots(data.query);
    if (!slots.missing_slots.length) return { questions: [] };
    const questions = await generateQuestions(slots, {
      service: data.memory?.service ?? null,
      niche: data.memory?.niche ?? null,
      location: data.memory?.location ?? null,
      audience: data.memory?.audience ?? null,
      goal: data.memory?.goal ?? null,
      experience_level: data.memory?.experience_level ?? null,
      work_style: data.memory?.work_style ?? null,
      website: data.memory?.website ?? null,
      about_doc: data.memory?.about_doc ?? null,
    });
    return { questions };
  });
