/**
 * Widening semantics shared by the job engine and the interactive path
 * (PRD §6: one widening machine, not two).
 *
 * The pool math and the empty-pass exhaustion rule are the job engine's
 * frozen semantics — re-exported here so the interactive search reuses the
 * exact same numbers instead of growing a competing copy. The interactive
 * loop adds only the bounded widening decision below (PRD §33-37).
 */
import { COVERAGE_EMPTY_PASSES, nextPoolTarget } from "@/lib/jobs/job-engine.server";

export { COVERAGE_EMPTY_PASSES, nextPoolTarget };
export {
  MIN_YIELD,
  MAX_YIELD,
  OVERFETCH,
  POOL_BASE,
} from "@/lib/jobs/job-engine.server";

/** Interactive widening bound: at most 3 widen passes after the first
 *  acquisition round (4 acquisition rounds total, incl. the initial one). */
export const MAX_WIDEN_PASSES = 3;

/** Why the bounded widening loop stopped. Surfaced honestly in the outcome. */
export type WidenStopOutcome =
  /** Widening never started (target already met / live path not required). */
  | "NOT_REQUIRED"
  /** Delivered or qualified-ready count reached the requested target. */
  | "TARGET_REACHED"
  /** Enough consecutive passes produced zero new candidates — the coverage
   *  the constraints allow is exhausted (same rule as the job engine). */
  | "COVERAGE_EXHAUSTED"
  /** Widen-pass budget spent (MAX_WIDEN_PASSES). */
  | "WIDEN_LIMIT"
  /** Run deadline/budget ended the loop; accumulated results finalize. */
  | "DEADLINE"
  /** Internal: another widen pass should run (never surfaces in an outcome). */
  | "CONTINUE";

/**
 * Bounded-widening stop decision (pure; unit-testable).
 * Precedence mirrors the job engine: target first, then budget/deadline,
 * then pass limit, then consecutive-empty-pass coverage exhaustion.
 */
export function widenStopDecision(args: {
  /** Qualified or qualified-ready candidates accumulated so far. */
  qualifiedCount: number;
  /** The user's requested target (delivery bar). */
  target: number;
  /** Widen passes already run (0 = initial pass only). */
  widenPasses: number;
  /** Consecutive widen passes that added zero new candidates. */
  emptyWidenPasses: number;
  /** The run's hard deadline already fired. */
  deadlineHit: boolean;
  /** The run was cancelled (never widen past a cancellation). */
  cancelled: boolean;
  /** Remaining wall-time before the run budget ends, when known. */
  budgetRemainingMs?: number;
}): WidenStopOutcome {
  if (args.qualifiedCount >= Math.max(1, args.target)) return "TARGET_REACHED";
  if (args.deadlineHit || args.cancelled) return "DEADLINE";
  if (args.budgetRemainingMs !== undefined && args.budgetRemainingMs <= 0) return "DEADLINE";
  if (args.widenPasses >= MAX_WIDEN_PASSES) return "WIDEN_LIMIT";
  if (args.emptyWidenPasses >= COVERAGE_EMPTY_PASSES) return "COVERAGE_EXHAUSTED";
  return "CONTINUE";
}

/**
 * Per-pass acquisition target for the interactive path — scales the live
 * gapfill's desiredCount with the pass number so deeper passes research more
 * (deeper result pages, more query variants), bounded by the pool target.
 */
export function widenDesiredCount(args: {
  widenPass: number;
  baseDesiredCount: number;
  poolTarget: number;
}): number {
  const pass = Math.max(1, args.widenPass);
  const scaled = args.baseDesiredCount * Math.pow(2, pass - 1);
  return Math.max(args.baseDesiredCount, Math.min(args.poolTarget, scaled));
}
