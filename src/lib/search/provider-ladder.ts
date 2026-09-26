/**
 * Phase 1F — free-first discovery ladder + cost logging.
 *
 * Hard rules (L1.10):
 * - Paid SERP is never a required dependency.
 * - Paid SERP MUST NOT run in parallel when free/self-hosted already succeeds.
 */
export type CostClass = "free" | "self_hosted" | "browser" | "paid";

export interface ProviderUseLog {
  provider_used: string;
  fallback_reason: string | null;
  cost_class: CostClass;
  operation: string;
  success: boolean;
  result_count: number;
  at: string;
}

const recentLogs: ProviderUseLog[] = [];

export function logProviderUse(
  entry: Omit<ProviderUseLog, "at"> & { at?: string },
): ProviderUseLog {
  const full: ProviderUseLog = {
    ...entry,
    at: entry.at ?? new Date().toISOString(),
  };
  recentLogs.push(full);
  if (recentLogs.length > 200) recentLogs.shift();
  console.info(
    "[provider-ladder] " +
      JSON.stringify({
        provider_used: full.provider_used,
        fallback_reason: full.fallback_reason,
        cost_class: full.cost_class,
        operation: full.operation,
        success: full.success,
        result_count: full.result_count,
      }),
  );
  return full;
}

/** Test helper — recent ladder decisions (cleared per process in tests). */
export function recentProviderLogs(): readonly ProviderUseLog[] {
  return recentLogs;
}

export function clearProviderLogs(): void {
  recentLogs.length = 0;
}

/**
 * SPEC-path web discovery: SearXNG only. Never invokes paid SERP here —
 * escalation to paid is a separate, explicit emergency path (not wired for
 * Phase 1 live-gapfill).
 *
 * When SEARXNG_URL is set but the host is unreachable, throws with
 * `code = SOURCE_UNAVAILABLE` — never returns a silent empty list that looks
 * like an honest coverage zero.
 */
export async function discoverWebFreeFirst(args: {
  queries: string[];
  maxQueries?: number;
  timeRange?: string;
  sourceKey?: string;
  operation?: string;
  /** M3: stop provider work when the active search run is cancelled. */
  signal?: AbortSignal | null;
}): Promise<{
  results: import("./searxng.server").SearxngResult[];
  provider_used: string;
  cost_class: CostClass;
}> {
  const operation = args.operation ?? "live-web-discovery";
  if (args.signal?.aborted) {
    const err = new Error("SEARCH_CANCELLED");
    (err as Error & { code: string }).code = "SEARCH_CANCELLED";
    throw err;
  }

  const rawBase = process.env.SEARXNG_URL?.trim();
  if (!rawBase) {
    logProviderUse({
      provider_used: "searxng-unconfigured",
      fallback_reason: "SEARXNG_URL unset",
      cost_class: "self_hosted",
      operation,
      success: false,
      result_count: 0,
    });
    const err = new Error("SEARXNG_UNCONFIGURED");
    (err as Error & { code: string }).code = "SOURCE_UNAVAILABLE";
    throw err;
  }

  const baseUrl = rawBase.replace(/:\/\/localhost(?=[:/]|$)/i, "://127.0.0.1");
  // Fail closed before spending the query budget: unreachable Docker / dead
  // public host must not register as "0 results for this Spec".
  try {
    const probe = await fetch(
      `${baseUrl.replace(/\/$/, "")}/search?q=ping&format=json`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (probe.status >= 500) {
      const err = new Error(`SEARXNG_UNREACHABLE HTTP ${probe.status}`);
      (err as Error & { code: string }).code = "SOURCE_UNAVAILABLE";
      throw err;
    }
  } catch (e) {
    if (
      e instanceof Error &&
      (e as Error & { code?: string }).code === "SOURCE_UNAVAILABLE"
    ) {
      logProviderUse({
        provider_used: "searxng",
        fallback_reason: e.message,
        cost_class: "self_hosted",
        operation,
        success: false,
        result_count: 0,
      });
      throw e;
    }
    if (e instanceof Error && e.name === "SEARCH_CANCELLED") throw e;
    const err = new Error(
      `SEARXNG_UNREACHABLE: ${e instanceof Error ? e.message : String(e)}`,
    );
    (err as Error & { code: string }).code = "SOURCE_UNAVAILABLE";
    logProviderUse({
      provider_used: "searxng",
      fallback_reason: err.message,
      cost_class: "self_hosted",
      operation,
      success: false,
      result_count: 0,
    });
    throw err;
  }

  const { searchSearxng } = await import("./searxng.server");
  const results = await searchSearxng(
    args.queries,
    args.maxQueries ?? 8,
    args.timeRange ?? "year",
    args.sourceKey ?? "live-web",
    args.signal,
  );
  const provider_used = "searxng";
  const cost_class: CostClass = "self_hosted";
  logProviderUse({
    provider_used,
    fallback_reason: null,
    cost_class,
    operation,
    success: results.length > 0,
    result_count: results.length,
  });
  // Intentionally no paid parallel call — L1.10 / Test 10.
  return { results, provider_used, cost_class };
}

/**
 * Gate for any paid SERP entry point: refuse when free discovery already
 * produced enough hits for the same operation in this process window.
 */
export function shouldSkipPaidSerp(args: {
  freeResultCount: number;
  sufficientAt?: number;
}): { skip: boolean; reason: string } {
  const enough = args.sufficientAt ?? 3;
  if (args.freeResultCount >= enough) {
    return {
      skip: true,
      reason: `free_discovery_sufficient:${args.freeResultCount}>=${enough}`,
    };
  }
  return { skip: false, reason: `free_insufficient:${args.freeResultCount}` };
}
