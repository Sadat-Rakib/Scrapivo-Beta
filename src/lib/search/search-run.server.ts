/** Process-local cancellation for the single-server MVP. Keys are owner-scoped. */
import {
  SEARCH_CANCELLED_REASON,
  SEARCH_DEADLINE_REASON,
  SEARCH_STALE_RUN_REASON,
  searchAbortCode,
  type SearchAbortReason,
} from "@/lib/search/search-run";

type RegisteredRun = {
  controller: AbortController;
  conversationId?: string;
  expiresAt: number;
  detach: () => void;
};

const runs = new Map<string, RegisteredRun>();
const TTL_MS = 10 * 60_000;
const MAX_RUN_MS = 120_000;
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
  const externalReason: SearchAbortReason =
    args.signal?.aborted && searchAbortCode(args.signal) === "SEARCH_DEADLINE"
      ? SEARCH_DEADLINE_REASON
      : SEARCH_CANCELLED_REASON;
  const abortExternal = () => abort(controller, externalReason);
  if (args.signal?.aborted) abortExternal();
  else args.signal?.addEventListener("abort", abortExternal, { once: true });
  // Hard deadline: stop research but keep already-qualified rows downstream.
  const timeout = setTimeout(() => abort(controller, SEARCH_DEADLINE_REASON), MAX_RUN_MS);
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
