import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import { SlotSchema, type Slots } from "./slots.schema";
import { tokenizeInput, type InputTokens } from "./tokenize-input";

const SYSTEM = `Extract search slots from user query. Respond ONLY strict JSON matching schema. Never invent values. Use null when absent. Scale = number or null. Category MUST be one of people|company|business|investor|job|unknown. work_mode = remote|hybrid|onsite when the query signals where/how the work happens (e.g. "remotely", "work from home" → remote), else null. role = the actual job/craft/role words with filler stripped (e.g. "react developer", "plumber") — never generic filler like "actively hiring". missing_slots = only slots that change retrieval (geo, sector, stage, scale, role, budget_or_check, intent_verb), max 4. GIVEN FACTS (from deterministic parsing of the exact typed words) are ground truth — copy them into the matching slots verbatim and NEVER override or null them. Only infer slots NOT covered by given facts.`;

export async function extractSlots(
  raw: string,
  given?: InputTokens,
  opts?: { temperature?: number; maxTokens?: number },
): Promise<Slots> {
  const fallback: Slots = {
    category: "unknown",
    scale: null,
    geo: null,
    sector: null,
    stage: null,
    role: null,
    budget_or_check: null,
    work_mode: null,
    intent_verb: "unknown",
    missing_slots: ["geo"],
    confidence: 0,
    raw,
  };
  // Deterministic facts first: explicit typed words always win over the LLM.
  const t = given ?? tokenizeInput(raw);
  try {
    const out = await aiComplete({
      task: "extract",
      system: SYSTEM,
      user: JSON.stringify({
        query: raw.slice(0, 1000),
        givenFacts: {
          category: t.category !== "unknown" ? t.category : null,
          stage: t.stage,
          sector: t.sector,
          geo: t.geo,
          scale: t.scale,
          urgency: t.urgency,
        },
      }),
      json: true,
      temperature: opts?.temperature ?? 0.1,
      maxTokens: opts?.maxTokens ?? 512,
    });
    const parsed = SlotSchema.safeParse(safeJsonParse(out));
    if (!parsed.success) return applyFacts(fallback, t);
    return applyFacts(parsed.data, t);
  } catch {
    return applyFacts(fallback, t);
  }
}

/** Hard-merge deterministic facts over any LLM output. Facts never lose. */
function applyFacts(slots: Slots, t: InputTokens): Slots {
  const merged: Slots = { ...slots };
  if (t.category !== "unknown") merged.category = t.category;
  if (t.stage) merged.stage = t.stage;
  if (t.sector) merged.sector = t.sector;
  if (t.geo) merged.geo = t.geo;
  if (t.scale) merged.scale = t.scale;
  // Deterministic work-mode: typed remote/hybrid/onsite words always win.
  if (/\bremot(e|ely|ely-?first|work)\b/i.test(t.raw)) merged.work_mode = "remote";
  else if (/\bhybrid\b/i.test(t.raw)) merged.work_mode = "hybrid";
  else if (/\bon-?site\b/i.test(t.raw)) merged.work_mode = "onsite";
  const present = new Set<string>();
  if (merged.category !== "unknown") present.add("intent_verb");
  if (merged.stage) present.add("stage");
  if (merged.sector) present.add("sector");
  if (merged.geo) present.add("geo");
  if (merged.scale) present.add("scale");
  merged.missing_slots = merged.missing_slots.filter((s) => !present.has(s));
  return merged;
}
