/**
 * Intent ranking (Step 4.3, pure): Fit x Intent x Recency x Evidence.
 * Fit comes from the retrieval row (normalized score or 0.5 fallback);
 * every other factor comes from the verified EvidenceObject.
 * Rows without evidence never rank here — the caller hides them.
 */
import { recencyScore, type EvidenceObject } from "./evidence";

export interface RankedLead {
  key: string;
  fit: number;
  intent: number;
  recency: number;
  evidence: number;
  quality: number;
}

export function fitOf(row: unknown): number {
  const r = (row ?? {}) as Record<string, unknown>;
  // NOTE: intent_score deliberately excluded — rank output must never feed
  // back in as rank input.
  for (const k of ["score", "quality_score"]) {
    const v = Number(r[k]);
    if (Number.isFinite(v) && v > 0) return Math.min(1, v > 1 ? v / 100 : v);
  }
  return 0.5;
}

export function rankEvidence(
  row: unknown,
  key: string,
  ev: EvidenceObject,
): RankedLead {
  const fit = fitOf(row);
  const intent = Math.max(0, Math.min(1, ev.strength * ev.confidence));
  const recency = recencyScore(ev.publishedAt, Date.parse(ev.observedAt));
  const evidence = ev.url && ev.excerpt ? 1 : 0.5;
  const quality = fit * intent * recency * evidence;
  return { key, fit, intent, recency, evidence, quality };
}

export function sortRanked<T extends { key: string }>(
  rows: T[],
  byKey: (key: string) => RankedLead | undefined,
): T[] {
  return [...rows].sort(
    (a, b) => (byKey(b.key)?.quality ?? -1) - (byKey(a.key)?.quality ?? -1),
  );
}
