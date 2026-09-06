/**
 * File-first, live-fallback router. Single decision point — no scattered conditionals.
 * Investors/VC + LocalBusiness: local JSONL first, blend/fallback to live when thin.
 * Jobs: always live (postings age out; stale = broken promise).
 * People/Companies general: live unless local dataset attached later.
 */
import type { ClassifiedQuery } from "./query-classifier";
import { resolveSearchVertical } from "./vertical";

export type SourceDecision = "local" | "live" | "blend" | "insufficient";
const MIN_LOCAL = 5;

export function decideSource(
  classified: ClassifiedQuery,
  localCount: number,
  requestedCount = MIN_LOCAL,
): SourceDecision {
  const raw = classified.raw || "";
  const vertical = resolveSearchVertical(raw);
  const goal = classified.goal;

  // Jobs always live
  if (goal === "jobs" || /\b(job|jobs|hiring|role|opening)\b/i.test(raw)) return "live";

  if (vertical === "investors" || vertical === "local") {
    if (localCount >= Math.max(requestedCount, MIN_LOCAL)) return "local";
    if (localCount > 0) return "blend";
    return "live";
  }
  return "live";
}

export function insufficientMessage(found: number, requested: number): string {
  return `Found ${found} matching investors, fewer than the ${requested} requested — want me to broaden the criteria or run live search to fill the gap?`;
}
