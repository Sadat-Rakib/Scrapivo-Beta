import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import { SlotSchema, type Slots } from "./slots.schema";

const SYSTEM = `Extract search slots from user query. Respond ONLY strict JSON matching schema. Never invent values. Use null when absent. Scale = number or null. Category MUST be one of people|company|business|investor|job|unknown. missing_slots = only slots that change retrieval (geo, sector, stage, scale, role, budget_or_check, intent_verb), max 4.`;

export async function extractSlots(raw: string): Promise<Slots> {
  const fallback: Slots = {
    category: "unknown",
    scale: null,
    geo: null,
    sector: null,
    stage: null,
    role: null,
    budget_or_check: null,
    intent_verb: "unknown",
    missing_slots: ["geo"],
    confidence: 0,
    raw,
  };
  try {
    const out = await aiComplete({
      task: "extract",
      system: SYSTEM,
      user: raw.slice(0, 1000),
      json: true,
      temperature: 0.1,
      maxTokens: 512,
    });
    const parsed = SlotSchema.safeParse(safeJsonParse(out));
    if (parsed.success) return parsed.data;
    return fallback;
  } catch {
    return fallback;
  }
}
