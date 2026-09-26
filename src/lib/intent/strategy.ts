/**
 * Intent strategy (Step 4.1): offer → observable signal patterns.
 *
 * The AI generates the SEARCH PLAN, never evidence. Deterministic templates
 * always work (no keys needed); an LLM upgrade refines phrases when a
 * provider is configured, cached by the AI router. Tiers follow the locked
 * model: explicit_request 1.0 / evaluation 0.8 / problem 0.65 / trigger 0.45.
 * Tier 5 (weak inference) is excluded by schema — it can never qualify.
 */

export type SignalTier = "explicit_request" | "evaluation" | "problem" | "trigger";

export interface SignalPattern {
  type: SignalTier;
  strength: number;
  phrases: string[];
}

export interface IntentStrategy {
  offer: string;
  entity: string;
  signals: SignalPattern[];
  /** true when an LLM refined the phrases; false = deterministic template. */
  llmRefined: boolean;
}

export const TIER_STRENGTH: Record<SignalTier, number> = {
  explicit_request: 1.0,
  evaluation: 0.8,
  problem: 0.65,
  trigger: 0.45,
};

const cleanOffer = (offer: string) =>
  offer.trim().replace(/\s+/g, " ").replace(/[.?!,;]+$/g, "").slice(0, 120);

/** Deterministic fallback: programmatic phrase variants, no LLM needed. */
export function templateStrategy(offer: string, entity: string): IntentStrategy {
  const o = cleanOffer(offer);
  const x = o.toLowerCase();
  return {
    offer: o,
    entity,
    llmRefined: false,
    signals: [
      {
        type: "explicit_request",
        strength: TIER_STRENGTH.explicit_request,
        phrases: [`looking for ${x}`, `need ${x}`, `hire ${x}`, `recommend ${x}`],
      },
      {
        type: "evaluation",
        strength: TIER_STRENGTH.evaluation,
        phrases: [`${x} alternatives`, `${x} vs`, `best ${x}`, `switching ${x}`],
      },
      {
        type: "problem",
        strength: TIER_STRENGTH.problem,
        phrases: [`struggling with ${x}`, `${x} help`, `${x} not working`],
      },
      {
        type: "trigger",
        strength: TIER_STRENGTH.trigger,
        phrases: [`hiring ${x}`, `new ${x}`, `launching ${x}`],
      },
    ],
  };
}

const STRATEGY_SYSTEM = `You design buyer-intent search strategies for a lead-discovery tool.
Given a seller's OFFER (what they sell) and the buyer ENTITY type, list observable public behaviors that would indicate someone needs the offer.
Respond with strict JSON only:
{"signals":[{"type":"explicit_request|evaluation|problem|trigger","phrases":["...", "..."]}]}.
Rules: 2-4 phrases per tier; phrases are quoted search strings a buyer would type or say; concrete and observable; never invent leads, companies, or URLs; no Tier-5 weak inferences (titles, headcounts, funding alone).`;

/** LLM upgrade via the existing AI router (cached 24h). Falls back silently. */
export async function refineStrategy(
  base: IntentStrategy,
): Promise<IntentStrategy> {
  try {
    const { aiComplete } = await import("@/lib/ai/router.server");
    const content = await aiComplete({
      task: "expand",
      system: STRATEGY_SYSTEM,
      user: `OFFER: ${base.offer}\nENTITY: ${base.entity}`,
      json: true,
      temperature: 0,
      maxTokens: 800,
    });
    const parsed = JSON.parse(content) as {
      signals?: Array<{ type: string; phrases?: string[] }>;
    };
    const valid = (parsed.signals ?? []).filter(
      (s): s is { type: SignalTier; phrases: string[] } =>
        Object.hasOwn(TIER_STRENGTH, s.type) &&
        Array.isArray(s.phrases) &&
        s.phrases.some((p) => String(p).trim().length > 0),
    );
    if (!valid.length) return base;
    return {
      ...base,
      llmRefined: true,
      signals: valid.map((s) => ({
        type: s.type,
        strength: TIER_STRENGTH[s.type],
        phrases: s.phrases.slice(0, 4).map((p) => String(p).slice(0, 90)),
      })),
    };
  } catch {
    return base; // No keys / provider down: deterministic template stands.
  }
}

/** Entry: deterministic always, LLM refinement when possible. */
export async function buildIntentStrategy(
  offer: string,
  entity: string,
): Promise<IntentStrategy> {
  const base = templateStrategy(offer, entity);
  if (!offer.trim()) return base;
  return refineStrategy(base);
}
