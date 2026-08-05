// Batched LLM buyer-intent classifier.
// For each lead, returns:
//   intent: hiring | buying | researching | seeker | profile | noise
//   confidence: 0..1
//   evidence: short quote from the lead text
//   role_in_post: buyer | seeker | observer | unknown
//
// Used as a post-filter in searchAllSources. Anything not in
// {hiring, buying, researching} or with role_in_post=seeker is dropped
// (a developer advertising themselves is NOT a lead for "hire a developer").

import { aiComplete, safeJsonParse } from "./router.server";

export type IntentLabel = {
  intent: "hiring" | "buying" | "researching" | "seeker" | "profile" | "noise";
  confidence: number;
  evidence: string;
  role_in_post: "buyer" | "seeker" | "observer" | "unknown";
};

type LeadLite = { id: string; title: string; snippet: string; platform?: string };

const SYSTEM = `You are a strict buyer-intent classifier for a B2B/freelance lead-discovery tool.

For each post you are given the user's TARGET (the role or service they offer) and the post text. Decide whether the post represents a real buyer signal for the TARGET.

Labels:
- "hiring"      = the author is actively trying to hire / contract / pay someone for the TARGET role or service.
- "buying"      = the author is asking to purchase, evaluate, or replace a product/service the TARGET provides.
- "researching" = the author is comparing vendors or asking for recommendations for the TARGET category.
- "seeker"     = the author IS offering themselves as the TARGET (portfolio, "I'm available for hire", "open to work"). NOT a lead.
- "profile"    = author bio, self-promotion, generic intro, "look at my project".
- "noise"      = tutorial, news, opinion, meme, unrelated, ambiguous, job listicles, advice threads.

role_in_post:
- "buyer"   = author wants to pay someone with this skill.
- "seeker"  = author has this skill and wants work.
- "observer"= author is talking ABOUT the topic but neither buying nor offering.
- "unknown" = unclear.

CRITICAL anti-patterns (ALWAYS seeker or noise — NEVER hiring/buying for TARGET):
- Rhetorical seller CTA: "Looking for a [role] for your business?" + "DM me your requirements" = seeker (freelancer hunting clients).
- "If you are a business founder… dm me" = seeker.
- Service ads with price floors: "Let's fix that room… Starting at $99" = seeker/noise.
- "Commission-based partner to find website clients" / sales partner for the author's own web business = seeker/noise (not hiring TARGET).
- Aggregator titles like "1,000+ Freelance … jobs" or "15+ Best Rated … Services" = noise.
- Body that is a pasted list of multiple [Hiring] posts = noise.
- Advice questions like "how have you managed to find jobs…" = noise.
- Opinion/listicles: "Their rates, real pay, and how they really feel about AI" = noise.
- Wrong craft for TARGET design: interior design, sculptor, 3D printer, motion graphics, character design = noise unless TARGET is that craft.

Be conservative. If unsure, label "noise" with low confidence.

Respond with strict JSON: {"results":[{"id":"<id>","intent":"...","confidence":0.0-1.0,"evidence":"<short quote, max 140 chars>","role_in_post":"..."}]}
No prose, no markdown fences.`;

function buildUser(target: string, leads: LeadLite[]): string {
  const items = leads.map((l) => {
    const text = `${l.title}\n${l.snippet}`.replace(/\s+/g, " ").slice(0, 700);
    return `ID: ${l.id}\nPLATFORM: ${l.platform ?? "unknown"}\nTEXT: ${text}`;
  }).join("\n\n---\n\n");
  return `TARGET: ${target}\n\nPOSTS:\n\n${items}`;
}

export async function classifyIntents(
  target: string,
  leads: LeadLite[],
): Promise<Record<string, IntentLabel>> {
  const out: Record<string, IntentLabel> = {};
  if (leads.length === 0) return out;

  const BATCH = 12;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    try {
      const content = await aiComplete({
        task: "classify",
        system: SYSTEM,
        user: buildUser(target, batch),
        json: true,
        temperature: 0,
        maxTokens: 1500,
      });
      const parsed = safeJsonParse<{ results?: Array<IntentLabel & { id: string }> }>(content);
      for (const r of parsed?.results ?? []) {
        if (!r?.id) continue;
        const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
        out[r.id] = {
          intent: r.intent,
          confidence: conf,
          evidence: (r.evidence || "").slice(0, 200),
          role_in_post: r.role_in_post ?? "unknown",
        };
      }
    } catch (err) {
      // best effort — if a batch fails, leave it unlabeled and continue
      console.warn("[intent-classifier] batch failed", (err as Error)?.message);
    }
  }
  return out;
}

const BUYER_INTENTS = new Set(["hiring", "buying", "researching"]);

export function isBuyerLabel(label: IntentLabel | undefined): boolean {
  if (!label) return false;
  if (label.role_in_post === "seeker") return false;
  if (!BUYER_INTENTS.has(label.intent)) return false;
  return label.confidence >= 0.5;
}

/**
 * Hard-drop only clear seekers / high-confidence junk.
 * Unlabeled + researching + weak noise stay — volume was dying at 11→2.
 */
export function shouldHardDropByLlm(label: IntentLabel | undefined): boolean {
  if (!label) return false;
  if (label.role_in_post === "seeker" && label.confidence >= 0.55) return true;
  if (label.intent === "seeker" && label.confidence >= 0.55) return true;
  if (label.intent === "profile" && label.confidence >= 0.7) return true;
  if (label.intent === "noise" && label.confidence >= 0.85) return true;
  return false;
}
