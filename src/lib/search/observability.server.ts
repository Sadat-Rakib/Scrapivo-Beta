// =====================================================================
// Source health logging (Phase 1, Task 1.5)
//
// A per-source-per-run log so a source silently dying (like the Lever board
// list once did) is discoverable without manual investigation — no dashboard
// yet, just a queryable `source_health` table.
//
// The row-building is a pure function (buildSourceHealthRows) so it's unit
// testable offline; logSourceHealth does the best-effort insert (never throws
// into the search path — visibility must not break discovery).
// =====================================================================

export type SourceHealthRow = {
  run_id: string;
  query: string;
  source: string;
  result_count: number;
  error_count: number;
  ran_at: string;
};

/**
 * Build one health row per source from the Promise.allSettled outcome of the
 * fan-out. A rejected source → error_count 1, result_count 0. A fulfilled
 * source → result_count = leads returned, error_count 0.
 */
export function buildSourceHealthRows(
  runId: string,
  query: string,
  names: string[],
  settled: Array<PromiseSettledResult<unknown[]>>,
  ranAt = new Date().toISOString(),
): SourceHealthRow[] {
  const rows: SourceHealthRow[] = [];
  for (let i = 0; i < settled.length; i++) {
    const name = names[i] ?? `source_${i}`;
    const r = settled[i];
    if (r && r.status === "fulfilled") {
      rows.push({
        run_id: runId,
        query,
        source: name,
        result_count: Array.isArray(r.value) ? r.value.length : 0,
        error_count: 0,
        ran_at: ranAt,
      });
    } else {
      rows.push({
        run_id: runId,
        query,
        source: name,
        result_count: 0,
        error_count: 1,
        ran_at: ranAt,
      });
    }
  }
  return rows;
}

/** Best-effort insert of the run's health rows. Never throws. */
export async function logSourceHealth(rows: SourceHealthRow[]): Promise<void> {
  if (!rows.length) return;
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    const { error } = await getAdmin().from("source_health").insert(rows);
    if (error && process.env.NODE_ENV === "development") {
      // e.g. table not yet created (run supabase/apply_phase2_schema.sql).
      console.warn("[source-health] insert error:", error.message);
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[source-health] insert skipped:", (err as Error)?.message);
    }
  }
}
