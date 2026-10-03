import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRunWatchdog } from "../run-watchdog";

/** PRD V2 Phase 3 / P1-A: T2 hung 81 minutes past its registered budget with
 *  no telemetry. The watchdog is an independent timer that names the stage. */
describe("run watchdog (P1-A deadline/hang instrumentation)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays silent while the run is inside its budget", () => {
    const events: unknown[] = [];
    const watchdog = startRunWatchdog({
      runId: "r1",
      budgetMs: 5_000,
      getStage: () => "live_gapfill",
      isAborted: () => ({ aborted: false, reason: null }),
      onEvent: (event) => events.push(event),
      intervalMs: 1_000,
    });
    vi.advanceTimersByTime(4_500);
    expect(events).toEqual([]);
    watchdog.stop();
  });

  it("names the current stage once elapsed exceeds the budget", () => {
    const events: unknown[] = [];
    const watchdog = startRunWatchdog({
      runId: "r2",
      budgetMs: 5_000,
      getStage: () => "live_gapfill",
      isAborted: () => ({ aborted: false, reason: null }),
      onEvent: (event) => events.push(event),
      intervalMs: 1_000,
    });
    vi.advanceTimersByTime(6_500);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0] as { stage: string; elapsedMs: number; budgetMs: number; signalAborted: boolean };
    expect(first.stage).toBe("live_gapfill");
    expect(first.elapsedMs).toBeGreaterThanOrEqual(5_000);
    expect(first.budgetMs).toBe(5_000);
    expect(first.signalAborted).toBe(false);
    watchdog.stop();
  });

  it("reports the abort reason when the signal fired but work kept running", () => {
    const events: unknown[] = [];
    const watchdog = startRunWatchdog({
      runId: "r3",
      budgetMs: 5_000,
      getStage: () => "enrichment",
      isAborted: () => ({ aborted: true, reason: "SEARCH_DEADLINE" }),
      onEvent: (event) => events.push(event),
      intervalMs: 1_000,
    });
    vi.advanceTimersByTime(6_000);
    const first = events[0] as { signalAborted: boolean; abortReason: string | null; stage: string };
    expect(first.signalAborted).toBe(true);
    expect(first.abortReason).toBe("SEARCH_DEADLINE");
    expect(first.stage).toBe("enrichment");
    watchdog.stop();
  });

  it("self-expires at 3x budget so a hung process cannot accumulate timers", () => {
    const events: unknown[] = [];
    const watchdog = startRunWatchdog({
      runId: "r4",
      budgetMs: 1_000,
      getStage: () => "stuck",
      isAborted: () => ({ aborted: false, reason: null }),
      onEvent: (event) => events.push(event),
      intervalMs: 500,
    });
    vi.advanceTimersByTime(20_000);
    const before = events.length;
    expect(before).toBeGreaterThanOrEqual(1);
    vi.advanceTimersByTime(60_000);
    expect(events.length).toBe(before);
    watchdog.stop();
  });
});
