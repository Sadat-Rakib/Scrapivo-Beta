/**
 * Parallel provider fan-out (Phase 5).
 *
 * Runs independent provider thunks CONCURRENTLY (Promise.allSettled) with no
 * cap on provider count — "uncapped" — bounded instead by a shared time
 * budget and per-provider failure isolation:
 * - one slow provider delays the step by at most the budget, never the query;
 * - one throwing provider is journaled in `errors`, never fakes rows;
 * - empty input resolves immediately with zero rows (no work invented).
 *
 * Sequential cheapest-first tiering (hot → s3 → provider) is unchanged —
 * this fans out WITHIN the provider step across declared providers, where
 * there are no data dependencies between calls. Cost discipline (which
 * providers run at all) stays with the coverage selector and the caller's
 * capability gate.
 */

export interface ProviderThunk<T> {
  /** Stable source name for journaling (e.g. "provider-osm"). */
  name: string;
  /** Independent fetch; may throw or hang (hung thunks hit the budget). */
  run: () => Promise<T[]>;
}

export interface FanOutResult<T> {
  rows: T[];
  /** Per-provider failure journal (name + message), never silent. */
  errors: Array<{ name: string; error: string }>;
  elapsedMs: number;
}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`provider timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (t !== undefined) clearTimeout(t);
  });
}

/**
 * Fan out across providers in parallel. Never throws: failures are
 * collected in `errors` and the caller decides (usually: continue with
 * whatever rows the healthy providers returned).
 */
export async function fanOutProviders<T>(
  sources: Array<ProviderThunk<T>>,
  opts: { timeoutMs?: number } = {},
): Promise<FanOutResult<T>> {
  const t0 = Date.now();
  const timeoutMs = Math.max(1, opts.timeoutMs ?? 20000);
  if (sources.length === 0) return { rows: [], errors: [], elapsedMs: Date.now() - t0 };
  const settled = await Promise.allSettled(
    sources.map((s) => withBudget(Promise.resolve().then(() => s.run()), timeoutMs)),
  );
  const rows: T[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (Array.isArray(r.value)) rows.push(...r.value);
    } else {
      errors.push({
        name: sources[i].name,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });
  return { rows, errors, elapsedMs: Date.now() - t0 };
}
