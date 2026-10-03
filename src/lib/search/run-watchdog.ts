/**
 * Run watchdog (PRD V2 Phase 3 / P1-A): T2 hung 81 minutes past its registered
 * budget because some await on the post-clarification path never returned and
 * nothing observed the overrun. This watchdog is an INDEPENDENT timer — it
 * does not trust the run to check in. Every interval past the budget it emits
 * the stage that was current, so the hung await names itself.
 *
 * Diagnostics only: it never aborts, never changes run state. Self-expires at
 * 3x budget so a truly hung process cannot accumulate timers.
 */

export type RunWatchdogEvent = {
  runId: string;
  stage: string;
  elapsedMs: number;
  budgetMs: number;
  signalAborted: boolean;
  abortReason: string | null;
};

export type RunWatchdogOptions = {
  runId: string;
  budgetMs: number;
  /** Current stage name, read fresh on every tick. */
  getStage: () => string;
  /** Signal state, read fresh on every tick. */
  isAborted: () => { aborted: boolean; reason: string | null };
  /** Watchdog sink — console + progress-registry in production. */
  onEvent: (event: RunWatchdogEvent) => void;
  /** Tick interval; default 5s. The first event fires on the first tick past
   *  the budget, then re-fires every ~4 ticks so long hangs stay visible. */
  intervalMs?: number;
};

export function startRunWatchdog(options: RunWatchdogOptions): { stop: () => void } {
  const { runId, budgetMs, getStage, isAborted, onEvent } = options;
  const intervalMs = options.intervalMs ?? 5_000;
  const startedAt = Date.now();
  let fired = 0;
  const timer = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    // Hard self-expiry: 3x budget, absolute cap 30 minutes.
    if (elapsedMs > Math.min(budgetMs * 3, 1_800_000)) {
      clearInterval(timer);
      return;
    }
    if (elapsedMs <= budgetMs) return;
    // Re-fire every 4th tick (~20s at the default interval) after the first.
    if (fired > 0 && fired % 4 !== 0) {
      fired += 1;
      return;
    }
    fired += 1;
    const { aborted, reason } = isAborted();
    onEvent({
      runId,
      stage: getStage(),
      elapsedMs,
      budgetMs,
      signalAborted: aborted,
      abortReason: reason,
    });
  }, intervalMs);
  // Never hold the process open for diagnostics.
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
