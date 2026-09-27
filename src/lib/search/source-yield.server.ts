/**
 * Source yield learning — IO (Workstream 4).
 *
 * Writes/reads source_yield_stats (supabase/migrations/20260927200000_source_yield.sql)
 * via the service-role admin client; pure math lives in source-yield.ts.
 * Everything here is best-effort: visibility must never break discovery
 * (same rule as source_health logging), so every function returns a value
 * and never throws into the search path.
 *
 * WIRING POINTS (parent-owned spec-search.functions.ts — for the parent to
 * hook, no edit made here):
 *   1. Diagnostics drain: after `providerAttempts = live.diagnostics ?? []`
 *      (~line 1952) and/or right before the final result attach
 *      (`providerAttempts`, ~line 2398), call
 *      `await drainProviderDiagnostics(providerAttempts, { queryFamily, entityType })`
 *      with queryFamily = the spec's entity/query family key. It is
 *      fire-and-forget safe.
 *   2. Plan reorder: prefetch
 *      `const yields = await smoothedYieldsBySource(queryFamily, entityType, plan.steps.map(s => s.providerId))`
 *      then pass `{ yieldOrder: yields }` into buildSourcePlan's opts (or
 *      call `reorderByYield(plan.steps.map(s => s.providerId), ...)` and
 *      re-sort plan.steps). buildSourcePlan itself stays sync.
 */
import type { ProviderDiagnostic } from "./source-plan";
import {
  applyStableYieldOrder,
  decayWeightedYield,
  YIELD_MAX_WINDOW_DAYS,
  type SourceYieldOutcome,
  type YieldWindow,
} from "./source-yield";

const DAY_MS = 86_400_000;

/** UTC daily window bucket (00:00Z of `now`'s day). */
function utcWindowStart(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/** Map one provider diagnostic onto the yield counters we track. */
export function providerDiagnosticToOutcome(d: ProviderDiagnostic): SourceYieldOutcome {
  return {
    attempts: d.attempted ? 1 : 0,
    candidates: d.artifactsFound ?? 0,
    qualified: d.qualified ?? 0,
    contacts: 0,
    signals: 0,
    latencyMs: 0,
    failures: d.attempted && !d.succeeded ? 1 : 0,
  };
}

/**
 * Accumulate one source outcome into today's UTC window (read-modify-write
 * upsert). Never throws; returns whether the upsert landed.
 */
export async function recordSourceOutcome(
  queryFamily: string,
  entityType: string,
  source: string,
  outcome: SourceYieldOutcome,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    const admin = getAdmin();
    const windowStart = utcWindowStart(now);
    const delta: Record<string, number> = {
      attempts: Math.max(0, outcome.attempts ?? 0),
      candidates: Math.max(0, outcome.candidates ?? 0),
      qualified: Math.max(0, outcome.qualified ?? 0),
      contacts: Math.max(0, outcome.contacts ?? 0),
      signals: Math.max(0, outcome.signals ?? 0),
      latency_ms_sum: Math.max(0, Math.round(outcome.latencyMs ?? 0)),
      failures: Math.max(0, outcome.failures ?? 0),
    };
    const { data, error: readErr } = await admin
      .from("source_yield_stats")
      .select("attempts,candidates,qualified,contacts,signals,latency_ms_sum,failures")
      .eq("query_family", queryFamily)
      .eq("entity_type", entityType)
      .eq("source", source)
      .eq("window_start", windowStart)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const cur = (data ?? {}) as Record<string, number | null>;
    const sum = (k: string) => (cur[k] ?? 0) + delta[k];
    const { error } = await admin
      .from("source_yield_stats")
      .upsert(
        {
          query_family: queryFamily,
          entity_type: entityType,
          source,
          window_start: windowStart,
          attempts: sum("attempts"),
          candidates: sum("candidates"),
          qualified: sum("qualified"),
          contacts: sum("contacts"),
          signals: sum("signals"),
          latency_ms_sum: sum("latency_ms_sum"),
          failures: sum("failures"),
        },
        { onConflict: "query_family,entity_type,source,window_start" },
      );
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[source-yield] record skipped:", (err as Error)?.message);
    }
    return false;
  }
}

/**
 * Fold finished-run provider diagnostics into source_yield_stats.
 * Fire-and-forget safe: logs in dev, never throws. Returns rows written.
 */
export async function drainProviderDiagnostics(
  diags: ProviderDiagnostic[],
  ctx: { queryFamily: string; entityType: string },
): Promise<number> {
  let written = 0;
  for (const d of diags ?? []) {
    if (!d?.provider || !d.attempted) continue;
    const ok = await recordSourceOutcome(
      ctx.queryFamily,
      ctx.entityType,
      d.provider,
      providerDiagnosticToOutcome(d),
    );
    if (ok) written += 1;
  }
  return written;
}

/**
 * Smoothed qualification yield for one source over the trailing ~28 daily
 * windows (7-day half-life). null = insufficient evidence (< 8 decayed
 * attempts) or read failure — never a fake zero.
 */
export async function smoothedSourceYield(
  queryFamily: string,
  entityType: string,
  source: string,
  now: Date = new Date(),
): Promise<number | null> {
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    const cutoff = new Date(now.getTime() - YIELD_MAX_WINDOW_DAYS * DAY_MS).toISOString();
    const { data, error } = await getAdmin()
      .from("source_yield_stats")
      .select("window_start,attempts,qualified")
      .eq("query_family", queryFamily)
      .eq("entity_type", entityType)
      .eq("source", source)
      .gte("window_start", cutoff);
    if (error) throw new Error(error.message);
    return decayWeightedYield((data ?? []) as YieldWindow[], now);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[source-yield] read failed:", (err as Error)?.message);
    }
    return null;
  }
}

/**
 * Batched per-source smoothed yields for the reorder hook. One query;
 * sources with no windows are simply absent from the map (unknown).
 */
export async function smoothedYieldsBySource(
  queryFamily: string,
  entityType: string,
  sources: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!sources.length) return out;
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    const cutoff = new Date(now.getTime() - YIELD_MAX_WINDOW_DAYS * DAY_MS).toISOString();
    const { data, error } = await getAdmin()
      .from("source_yield_stats")
      .select("source,window_start,attempts,qualified")
      .eq("query_family", queryFamily)
      .eq("entity_type", entityType)
      .in("source", [...sources])
      .gte("window_start", cutoff);
    if (error) throw new Error(error.message);
    const bySource = new Map<string, YieldWindow[]>();
    for (const row of (data ?? []) as Array<YieldWindow & { source: string }>) {
      const list = bySource.get(row.source) ?? [];
      list.push(row);
      bySource.set(row.source, list);
    }
    for (const [source, windows] of bySource) {
      const y = decayWeightedYield(windows, now);
      if (y !== null) out.set(source, y);
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[source-yield] batch read failed:", (err as Error)?.message);
    }
  }
  return out;
}

/**
 * Reorder sources by smoothed yield (stable): high yield moves up, unknown/
 * no-data sources keep their original position, nothing is dropped.
 */
export async function reorderByYield(
  sources: string[],
  queryFamily: string,
  entityType: string,
  now: Date = new Date(),
): Promise<string[]> {
  if (sources.length < 2) return [...sources];
  const yields = await smoothedYieldsBySource(queryFamily, entityType, sources, now);
  return applyStableYieldOrder(sources, yields);
}
