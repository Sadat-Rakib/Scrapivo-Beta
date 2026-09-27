/**
 * Reuse metrics (Workstream 4) — per-run accumulator for how much work the
 * canonical cache saved vs. how much went live/stale.
 *
 * Exported only: the parent threads `createReuseRun()` through the job pass
 * later. IDEAL WIRING POINTS:
 *   1. Job pass start:       const reuse = createReuseRun();
 *   2. Indexed read-back:    queryIndexForSpec(spec, limit, offset, reuse)
 *      (already threaded — optional param records cache hits + fresh/stale
 *      field reuse automatically).
 *   3. Before live research: reuse.recordLiveCall() where the gapfill/
 *      browser-live tier is invoked for a cache-missed candidate.
 *   4. Job pass end:         reuse.snapshot() → per-run reuse telemetry row.
 *
 * Counting semantics:
 *   canonical_cache_hits    — records served from the canonical index
 *   fresh_fields_reused     — fresh fact fields consumed without re-research
 *   live_research_calls     — live research invocations
 *   stale_fields_researched — stale fields marked for target re-research
 */

export interface ReuseRunSnapshot {
  canonical_cache_hits: number;
  fresh_fields_reused: number;
  live_research_calls: number;
  stale_fields_researched: number;
}

export interface ReuseRun {
  /** A record was served from canonical storage (no live research). */
  recordCacheHit(field?: string): void;
  /** A fact field was consumed fresh from cache. */
  recordFreshReused(field: string): void;
  /** A live research call was made (cache missed / stale target). */
  recordLiveCall(): void;
  /** A stale field was marked and sent to target re-research. */
  recordStaleResearched(field: string): void;
  snapshot(): ReuseRunSnapshot;
}

export function createReuseRun(): ReuseRun {
  let cacheHits = 0;
  let freshFields = 0;
  let liveCalls = 0;
  let staleResearched = 0;
  return {
    recordCacheHit(_field?: string) {
      cacheHits += 1;
    },
    recordFreshReused(field: string) {
      if (field) freshFields += 1;
    },
    recordLiveCall() {
      liveCalls += 1;
    },
    recordStaleResearched(field: string) {
      if (field) staleResearched += 1;
    },
    snapshot(): ReuseRunSnapshot {
      return {
        canonical_cache_hits: cacheHits,
        fresh_fields_reused: freshFields,
        live_research_calls: liveCalls,
        stale_fields_researched: staleResearched,
      };
    },
  };
}
