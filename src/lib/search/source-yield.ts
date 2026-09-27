/**
 * Source yield learning — pure math (Workstream 4).
 *
 * IO (DB read/write, diagnostics draining) lives in source-yield.server.ts;
 * everything here is offline-testable and dependency-free.
 */

export interface YieldWindow {
  window_start: string | Date;
  attempts: number;
  qualified: number;
}

export interface SourceYieldOutcome {
  attempts?: number;
  candidates?: number;
  qualified?: number;
  contacts?: number;
  signals?: number;
  latencyMs?: number;
  failures?: number;
}

export const YIELD_DECAY_HALF_LIFE_DAYS = 7;
export const YIELD_MAX_WINDOW_DAYS = 28;
/** Below this much decayed evidence the yield is unknown (null), not zero. */
export const YIELD_MIN_DECAYED_ATTEMPTS = 8;
/** Attempts/qualified smoothing prior so tiny windows cannot dominate. */
export const YIELD_PRIOR_ATTEMPTS = 2;
export const YIELD_PRIOR_QUALIFIED = 0.2;

const DAY_MS = 86_400_000;

/**
 * Exponential time-decay weighted qualification yield over daily windows.
 *
 *   weight(w) = 0.5 ^ (ageDays / 7)            (half-life 7 days)
 *   yield     = (Σ w·qualified + 0.2) / (Σ w·attempts + 2)
 *
 * The +2/+0.2 prior caps a single lucky window (a perfect 10/10 window
 * smooths to ~0.83, never 1.0) and keeps one-row windows from dominating.
 * Returns null when total decayed attempts < 8 — insufficient evidence is
 * "unknown", never a low score.
 */
export function decayWeightedYield(
  windows: YieldWindow[],
  now: Date = new Date(),
): number | null {
  let decayedAttempts = 0;
  let decayedQualified = 0;
  for (const w of windows) {
    const started = new Date(w.window_start).getTime();
    if (Number.isNaN(started)) continue;
    const ageDays = (now.getTime() - started) / DAY_MS;
    if (ageDays < 0) continue; // future window (clock skew) — ignore
    const weight = Math.pow(0.5, ageDays / YIELD_DECAY_HALF_LIFE_DAYS);
    decayedAttempts += weight * Math.max(0, w.attempts);
    decayedQualified += weight * Math.max(0, w.qualified);
  }
  if (decayedAttempts < YIELD_MIN_DECAYED_ATTEMPTS) return null;
  return (decayedQualified + YIELD_PRIOR_QUALIFIED) /
    (decayedAttempts + YIELD_PRIOR_ATTEMPTS);
}

/**
 * Stable yield-order for a source list given per-source smoothed yields.
 *
 * Rules: sources with data sort by yield DESC (ties keep original order);
 * unknown/no-data sources keep their EXACT original position and are never
 * dropped. Sources with data are re-slotted only into the positions that
 * data-having sources already occupied, so a high-yield source moves up
 * without displacing no-data sources.
 */
export function applyStableYieldOrder(
  sources: string[],
  yields: ReadonlyMap<string, number | null>,
): string[] {
  const slots: number[] = [];
  const known: Array<{ index: number; source: string; yield: number }> = [];
  for (let i = 0; i < sources.length; i++) {
    const y = yields.get(sources[i]);
    if (typeof y === "number" && Number.isFinite(y)) {
      slots.push(i);
      known.push({ index: i, source: sources[i], yield: y });
    }
  }
  if (known.length < 2) return [...sources];
  // Stable: equal yields keep original order (index tiebreak).
  known.sort((a, b) => b.yield - a.yield || a.index - b.index);
  const out = [...sources];
  known.forEach((entry, slotOrdinal) => {
    out[slots[slotOrdinal]] = entry.source;
  });
  return out;
}
