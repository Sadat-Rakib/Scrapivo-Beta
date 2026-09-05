import { z } from "zod";

export const SlotSchema = z.object({
  category: z.enum(["people", "company", "business", "investor", "job", "unknown"]),
  scale: z.number().int().positive().nullable(),
  geo: z.string().max(120).nullable(),
  sector: z.string().max(80).nullable(),
  stage: z.string().max(40).nullable(),
  role: z.string().max(120).nullable(),
  budget_or_check: z.string().max(40).nullable(),
  intent_verb: z.enum(["hire", "pitch", "fundraise", "jobhunt", "buy", "unknown"]),
  missing_slots: z
    .array(z.enum(["geo", "sector", "stage", "scale", "role", "budget_or_check", "intent_verb"]))
    .max(4),
  confidence: z.number().min(0).max(1),
  raw: z.string(),
});
export type Slots = z.infer<typeof SlotSchema>;

export const GenOptionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  hint: z.string().max(120),
});
export const GenQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(1).max(140),
  options: z.array(GenOptionSchema).min(2).max(4),
  allow_custom: z.literal(true),
});
export const GenResponseSchema = z.object({
  questions: z.array(GenQuestionSchema).max(3),
});
export type GenResponse = z.infer<typeof GenResponseSchema>;

export type UserMemory = {
  service?: string | null;
  niche?: string | null;
  location?: string | null;
  audience?: string | null;
  goal?: string | null;
  experience_level?: string | null;
  work_style?: string | null;
  website?: string | null;
  /** Freeform user context (resume/portfolio excerpt, business description). */
  about_doc?: string | null;
};
