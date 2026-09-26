/**
 * Search run identity + stale rejection (M3).
 *
 * Cancellation = two layers:
 *   1. AbortSignal — stop work
 *   2. run identity — discard late responses whose run_id ≠ active
 *
 * Abort alone does not protect against remount races / late fallbacks.
 */
import {
  resolveFinalOutcome,
  type SearchOutcomeCode,
  DIAGNOSTIC_OUTCOME_CODES,
} from "@/lib/search/canonical-contract";

export type SearchRunIds = {
  search_run_id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
};

export type SearchRunContext = SearchRunIds & {
  /** Optional abort — providers should honour when supported. */
  signal?: AbortSignal | null;
  /** Wall clock for tests. */
  created_at?: string;
};

let seq = 0;

function mintId(prefix: string): string {
  seq += 1;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${seq}`;
  return `${prefix}_${rand}`;
}

/** Create a new run identity bundle (server or client). */
export function createSearchRun(partial?: Partial<SearchRunIds>): SearchRunIds {
  return {
    search_run_id: partial?.search_run_id ?? mintId("run"),
    conversation_id: partial?.conversation_id ?? mintId("conv"),
    turn_id: partial?.turn_id ?? mintId("turn"),
    request_id: partial?.request_id ?? mintId("req"),
  };
}

/** True when the response belongs to the currently active run. */
export function isActiveRun(
  responseRunId: string | null | undefined,
  activeRunId: string | null | undefined,
): boolean {
  if (!activeRunId || !responseRunId) return false;
  return responseRunId === activeRunId;
}

/**
 * Discard rule: if response.run_id !== activeRunId → discard.
 * Missing ids are treated as stale (fail closed for delivery).
 */
export function shouldDiscardStaleResult(
  response: { search_run_id?: string | null },
  activeRunId: string | null | undefined,
): boolean {
  return !isActiveRun(response.search_run_id, activeRunId);
}

export type RouteOutcome = {
  code: SearchOutcomeCode;
  source?: string;
  detail?: string;
};

/**
 * Merge route outcomes into the final typed outcome.
 * Diagnostics (SOURCE_*) never override a completed NO_QUALIFIED_RESULTS
 * unless no higher-precedence outcome exists.
 *
 * M7: when coverageEstablished=false (all capable providers failed/unavailable),
 * do not invent NO_QUALIFIED_RESULTS — surface SOURCE_UNAVAILABLE / SOURCE_ERROR.
 */
export function finalizeSearchOutcome(
  routes: RouteOutcome[],
  args?: {
    cancelled?: boolean;
    failed?: boolean;
    unsupported?: boolean;
    qualifiedCount?: number;
    /** False when no capable provider succeeded — not a completed zero-results search. */
    coverageEstablished?: boolean;
  },
): {
  outcome: SearchOutcomeCode;
  diagnostics: RouteOutcome[];
} {
  const diagnostics = routes.filter((r) => DIAGNOSTIC_OUTCOME_CODES.has(r.code));
  const codes: SearchOutcomeCode[] = routes.map((r) => r.code);
  if (args?.cancelled) codes.push("SEARCH_CANCELLED");
  if (args?.failed) codes.push("SEARCH_FAILED");
  if (args?.unsupported) codes.push("UNSUPPORTED_CAPABILITY");
  const q = args?.qualifiedCount ?? -1;
  const coverageOk = args?.coverageEstablished !== false;
  if (q > 0 && !args?.cancelled && !args?.failed) {
    codes.push("QUALIFIED_RESULTS");
  } else if (q === 0 && !args?.cancelled && !args?.failed && coverageOk) {
    codes.push("NO_QUALIFIED_RESULTS");
  }
  return {
    outcome: resolveFinalOutcome(codes),
    diagnostics,
  };
}

/** Throw if the abort signal already fired. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    const err = new Error("SEARCH_CANCELLED");
    (err as Error & { code: SearchOutcomeCode }).code = "SEARCH_CANCELLED";
    throw err;
  }
}

/** Stop waiting for adapters that cannot abort their current operation. */
export async function awaitSearchWork<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      try { throwIfAborted(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
