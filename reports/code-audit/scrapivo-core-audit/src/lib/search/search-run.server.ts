/** Process-local cancellation for the single-server MVP. Keys are owner-scoped. */
type RegisteredRun = {
  controller: AbortController;
  conversationId?: string;
  expiresAt: number;
  detach: () => void;
};

const runs = new Map<string, RegisteredRun>();
const TTL_MS = 10 * 60_000;
const keyFor = (ownerId: string, runId: string) => JSON.stringify([ownerId, runId]);

function prune() {
  for (const [key, run] of runs) {
    if (run.expiresAt > Date.now()) continue;
    run.controller.abort();
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
    run.controller.abort();
    run.detach();
    run.expiresAt = Date.now() + TTL_MS;
    return;
  }
  const controller = new AbortController();
  controller.abort();
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
        run.controller.abort();
        run.detach();
      }
    }
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (args.signal?.aborted) abort();
  else args.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, TTL_MS);
  timeout.unref?.();
  const run: RegisteredRun = {
    controller,
    conversationId: args.conversationId,
    expiresAt: Date.now() + TTL_MS,
    detach: () => {
      args.signal?.removeEventListener("abort", abort);
      clearTimeout(timeout);
    },
  };
  runs.set(key, run);
  return {
    signal: controller.signal,
    finish: () => {
      run.detach();
      controller.abort();
      run.expiresAt = Date.now() + TTL_MS;
    },
  };
}
