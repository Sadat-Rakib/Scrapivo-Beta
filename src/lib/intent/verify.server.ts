/**
 * Evidence verification (Step 4.3): hit + offer -> EvidenceObject or null.
 *
 * Accepts only classifier-confirmed buyer labels (hiring/buying/researching,
 * never seeker) with confidence >= 0.5. The classifier is injectable so
 * tests prove the gate without LLM keys. Confidence is classifier-only;
 * recency is applied once, downstream in rankEvidence (never squared).
 */
import { classifyIntents, type IntentLabel } from "@/lib/ai/intent-classifier.server";
import { TIER_LABEL, type EvidenceHit, type EvidenceObject } from "./evidence";

export const MIN_CLASSIFY_CONFIDENCE = 0.5;

type ClassifyFn = (
  target: string,
  leads: Array<{ id: string; title: string; snippet: string; platform?: string }>,
) => Promise<Record<string, IntentLabel>>;

export async function verifyHit(
  hit: EvidenceHit,
  offer: string,
  leadKey: string,
  classify: ClassifyFn = classifyIntents,
): Promise<EvidenceObject | null> {
  let labels: Record<string, IntentLabel>;
  try {
    labels = await classify(offer, [
      { id: "hit", title: hit.title, snippet: hit.excerpt, platform: hit.source },
    ]);
  } catch {
    return null; // No classifier (no keys) -> no verified intent. Honest null.
  }
  const label = labels["hit"];
  if (!label) return null;
  if (!["hiring", "buying", "researching"].includes(label.intent)) return null;
  if (label.role_in_post === "seeker") return null;
  const confidence = Number(label.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CLASSIFY_CONFIDENCE) return null;
  if (!hit.tier || !TIER_LABEL[hit.tier]) return null;
  return {
    leadKey,
    tier: hit.tier,
    strength: hit.strength,
    source: hit.source,
    url: hit.url,
    observedAt: new Date().toISOString(),
    publishedAt: hit.publishedAt,
    excerpt: hit.excerpt.slice(0, 280),
    reason: `Public ${hit.source} post matches "${hit.phrase}" (${TIER_LABEL[hit.tier].toLowerCase()}).`,
    confidence: Math.round(confidence * 100) / 100,
  };
}
