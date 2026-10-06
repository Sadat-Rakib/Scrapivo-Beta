/** Process-local cancellation for the single-server MVP. Keys are owner-scoped. */
import {
  SEARCH_CANCELLED_REASON,
  SEARCH_DEADLINE_REASON,
  SEARCH_STALE_RUN_REASON,
  searchAbortCode,
} from "@/lib/search/search-run";
import type { SearchAbortReason } from "@/lib/search/search-run";

type RegisteredRun = {
  controller: AbortController;
  conversationId?: string;
  expiresAt: number;
  detach: () => void;
};

const runs = new Map<string, RegisteredRun>();
const TTL_MS = 10 * 60_000;
const MAX_RUN_MS = 120_000;
/** Upper bound for adaptive budgets (beta-reality: live research for
 * people/companies cannot finish inside the flat 120s budget). */
const MAX_ADAPTIVE_RUN_MS = 10 * 60_000;
const keyFor = (ownerId: string, runId: string) => JSON.stringify([ownerId, runId]);

function abort(controller: AbortController, reason: SearchAbortReason): void {
  controller.abort(reason);
}

function prune() {
  for (const [key, run] of runs) {
    if (run.expiresAt > Date.now()) continue;
    abort(run.controller, SEARCH_DEADLINE_REASON);
    run.detach();
    runs.delete(key);
  }
}

/** Also remembers cancellations that arrive before their search request. */
export function cancelRegisteredSearchRun(ownerId: string, runId: string): void {
  prune();
  const key = keyFor(ownerId, runId);
  const run = runs.get(key);
  if (run) {
    abort(run.controller, SEARCH_CANCELLED_REASON);
    run.detach();
    run.expiresAt = Date.now() + TTL_MS;
    return;
  }
  const controller = new AbortController();
  abort(controller, SEARCH_CANCELLED_REASON);
  runs.set(key, { controller, expiresAt: Date.now() + TTL_MS, detach: () => {} });
}

export function beginRegisteredSearchRun(args: {
  ownerId: string;
  runId: string;
  conversationId?: string;
  signal?: AbortSignal;
  /** Optional run budget. Defaults to the flat MAX_RUN_MS; callers with a
   * requested target scale it (120s base + 20s per requested candidate). */
  maxRunMs?: number;
}): { signal: AbortSignal; finish: () => void } {
  prune();
  const key = keyFor(args.ownerId, args.runId);
  const existing = runs.get(key);
  // A cancelled, completed, or already running id can never start more work.
  if (existing) return { signal: AbortSignal.abort(), finish: () => {} };

  if (args.conversationId) {
    for (const [otherKey, run] of runs) {
      const [ownerId] = JSON.parse(otherKey) as [string, string];
      if (ownerId === args.ownerId && run.conversationId === args.conversationId) {
        abort(run.controller, SEARCH_STALE_RUN_REASON);
        run.detach();
      }
    }
  }
  const controller = new AbortController();
  const abortExternal = () => {
    const code = searchAbortCode(args.signal);
    abort(controller, code === "SEARCH_DEADLINE"
      ? SEARCH_DEADLINE_REASON
      : code === "SEARCH_STALE_RUN"
        ? SEARCH_STALE_RUN_REASON
        : SEARCH_CANCELLED_REASON);
  };
  if (args.signal?.aborted) abortExternal();
  else args.signal?.addEventListener("abort", abortExternal, { once: true });
  // Hard deadline: stop research but keep already-qualified rows downstream.
  const budgetMs = Math.min(
    Math.max(5_000, args.maxRunMs ?? MAX_RUN_MS),
    MAX_ADAPTIVE_RUN_MS,
  );
  const timeout = setTimeout(() => abort(controller, SEARCH_DEADLINE_REASON), budgetMs);
  timeout.unref?.();
  const run: RegisteredRun = {
    controller,
    conversationId: args.conversationId,
    expiresAt: Date.now() + TTL_MS,
    detach: () => {
      args.signal?.removeEventListener("abort", abortExternal);
      clearTimeout(timeout);
    },
  };
  runs.set(key, run);
  return {
    signal: controller.signal,
    finish: () => {
      run.detach();
      abort(controller, SEARCH_CANCELLED_REASON);
      run.expiresAt = Date.now() + TTL_MS;
    },
  };
}

/**
 * Mirror of beginRegisteredSearchRun's budget formula for callers that need
 * to know how much wall-time a run will get BEFORE it starts (the bounded
 * widening loop must not begin acquisition work it cannot finish). Same
 * clamp: 5s floor, adaptive ceiling.
 */
export function estimatedRunBudgetMs(maxRunMs?: number): number {
  return Math.min(Math.max(5_000, maxRunMs ?? MAX_RUN_MS), MAX_ADAPTIVE_RUN_MS);
}

/** Wall-time reserve so the bounded widening loop (PRD §35) gets a real
 * slice: stored-path verification of the initial pool commonly consumes the
 * acquisition-scaled budget, and without a reserved slice widening never
 * starts (W1 acceptance: 449s of per-row browsing left no room in a 520s
 * budget). One formula for the registered deadline and the widen-loop's
 * pre-flight mirror so the two can never drift apart. */
const WIDEN_RESERVE_MS = 120_000;
export function scaledRunBudgetMs(requested: number): number {
  return estimatedRunBudgetMs(120_000 + Math.max(0, requested) * 20_000 + WIDEN_RESERVE_MS);
}
