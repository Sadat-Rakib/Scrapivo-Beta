import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import { GenResponseSchema, type GenResponse, type Slots, type UserMemory } from "./slots.schema";
import type { ClarifyQuestion } from "./clarifier";

const SYSTEM = `Given slots + user memory (ICP), generate max 3 clarifying questions, one-at-a-time order. Each: 2-4 generated options specific to THIS input (never generic static lists) + allow_custom:true always. Each option: {id (snake), label (max 6 words), hint (what it filters, max 12 words)}. Skip any slot already in memory or query. Respond ONLY strict JSON {"questions":[{id,question,options,allow_custom:true}]}`;

const FALLBACK: GenResponse = {
  questions: [
    {
      id: "geo",
      question: "Anywhere in particular?",
      options: [
        { id: "global", label: "Worldwide", hint: "Most results" },
        { id: "us", label: "United States", hint: "US only" },
      ],
      allow_custom: true,
    },
  ],
};

export async function generateQuestions(
  slots: Slots,
  memory: UserMemory = {},
): Promise<ClarifyQuestion[]> {
  // Suppress slots already answered by memory
  const effectiveMissing = slots.missing_slots.filter((s) => {
    if (s === "geo" && memory.location) return false;
    if (s === "role" && memory.service) return false;
    return true;
  });
  if (!effectiveMissing.length) return [];
  try {
    const out = await aiComplete({
      task: "classify",
      system: SYSTEM,
      user: JSON.stringify({ slots: { ...slots, missing_slots: effectiveMissing }, memory }).slice(
        0,
        2000,
      ),
      json: true,
      temperature: 0.6,
      maxTokens: 800,
    });
    const parsed = GenResponseSchema.safeParse(safeJsonParse(out));
    const data = parsed.success ? parsed.data : FALLBACK;
    return data.questions.map((q) => ({
      id: q.id as ClarifyQuestion["id"],
      question: q.question,
      options: q.options.map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
      allowOther: true,
    }));
  } catch {
    return FALLBACK.questions.map((q) => ({
      id: q.id as ClarifyQuestion["id"],
      question: q.question,
      options: q.options,
      allowOther: true,
    }));
  }
}
