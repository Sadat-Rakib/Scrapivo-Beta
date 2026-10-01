/**
 * In-process Search Job worker (data-asset pass). Polls claim_search_job via
 * the store and processes claimed jobs with the real pipeline passRunner.
 * Atomic lease claims make multiple instances safe; "boot recovery" is
 * inherent — an expired lease is simply claimable again by any worker.
 */
import { skipPersistence } from "@/lib/persistence-policy.server";

let started = false;

export function ensureJobWorkerStarted(): void {
  if (started) return;
  // A local worker would claim and lease production search_jobs rows.
  if (skipPersistence("search_jobs_worker")) return;
  started = true;
  void (async () => {
    const { runJobEngine } = await import("@/lib/jobs/job-engine.server");
    const { getSearchJobsStore } = await import("@/lib/jobs/search-jobs.server");
    const { runPipelinePass } = await import("@/lib/jobs/pass-runner.server");
    await runJobEngine({
      store: getSearchJobsStore(),
      passRunner: runPipelinePass,
      owner: `worker-${process.pid}`,
      pollMs: 10_000,
    });
  })().catch((err) => {
    started = false; // allow a later call to restart the loop
    console.warn("[job-worker] crashed:", err instanceof Error ? err.message : err);
  });
}
