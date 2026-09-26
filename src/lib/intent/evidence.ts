/**
 * Intent evidence types (Step 4.3). An EvidenceObject is the ONLY thing
 * that can carry an intent badge: source + URL + timestamps + excerpt.
 * No evidence -> no intent -> lead stays hidden (Batch 4 policy).
 */
import type { SignalTier } from "./strategy";

export interface EvidenceHit {
  /** Strategy tier whose phrase produced this hit. */
  tier: SignalTier;
  strength: number;
  /** The exact phrase that matched. */
  phrase: string;
  source: string;
  url: string;
  title: string;
  excerpt: string;
  publishedAt?: string | null;
  freshnessWindow?: string | null;
}

export interface EvidenceObject {
  /** registry_key (index) or row key of the verified lead. */
  leadKey: string;
  tier: SignalTier;
  strength: number;
  source: string;
  url: string;
  observedAt: string;
  publishedAt?: string | null;
  excerpt: string;
  reason: string;
  /** classifier confidence x recency x evidence-quality, 0..1. */
  confidence: number;
}

export const TIER_LABEL: Record<SignalTier, string> = {
  explicit_request: "Explicit request",
  evaluation: "Evaluating options",
  problem: "Problem signal",
  trigger: "Business trigger",
};

/** Recency decay: hours since published -> 0..1. Unknown -> 0.3. */
export function recencyScore(publishedAt?: string | null, now = Date.now()): number {
  if (!publishedAt) return 0.3;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 0.3;
  const hours = (now - t) / 3_600_000;
  if (hours < 0) return 0.3;
  if (hours <= 48) return 1;
  if (hours <= 24 * 7) return 0.8;
  if (hours <= 24 * 30) return 0.5;
  return 0.2;
}
