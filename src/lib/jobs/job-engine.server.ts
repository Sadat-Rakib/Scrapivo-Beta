/**
 * Lease-owning Search Job engine (Workstream 1). Fully dependency-injected so
 * tests are deterministic offline (inject a fake SearchJobsStore + passRunner).
 *
 * FROZEN design — the engine ONLY orchestrates:
 *   * leasing (claim RPC + heartbeat interval + claim-loss abort),
 *   * pool widening between passes (yield-based),
 *   * stop conditions (TARGET_REACHED / COVERAGE_EXHAUSTED / BUDGET_EXHAUSTED
 *     / USER_STOPPED / FAILED) and pause checkpoints.
 * It NEVER lowers qualification gates — passRunner owns qualification.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type {
  SearchJobBudgets,
  SearchJobCompletionReason,
  SearchJobMode,
  SearchJobRow,
  SearchJobsStore,
} from "./search-job.types";

// ---------------------------------------------------------------------------
// Tunables (frozen defaults; overridable per-deps for tests)
// ---------------------------------------------------------------------------

/** First-pass candidate pool target. */
export const POOL_BASE = 250;
/** Hard pool cap for long-running job/watch modes. */
export const POOL_HARD_CAP_JOB_WATCH = 2000;
/** Extra headroom when sizing the pool from the estimated need. */
export const OVERFETCH = 1.5;
/** Yield clamp floor — a disastrous pass must not demand an infinite pool. */
export const MIN_YIELD = 0.02;
export const MAX_YIELD = 1;
/** Consecutive zero-new-candidate passes before declaring coverage exhausted. */
export const COVERAGE_EMPTY_PASSES = 2;
/** Default total wall-time budget per job (ms). */
export const DEFAULT_TOTAL_BUDGET_MS = 15 * 60_000;
/** Default pass-count budget per job. */
export const DEFAULT_MAX_PASSES = 20;
/** Pass wall-time budget by mode. */
export const PASS_BUDGET_MS: Record<SearchJobMode, number> = {
  interactive: 15_000,
  batch: 45_000,
  job: 120_000,
  watch: 120_000,
};

// ---------------------------------------------------------------------------
// Pass contract (the parent workstream wires the real passRunner)
// ---------------------------------------------------------------------------

export interface EngineNewCandidate {
  candidate_key: string;
  entity_id?: string | null;
  state?: string;
  priority?: number;
  attempts?: number;
  data?: Record<string, unknown>;
}

export interface EngineNewQuery {
  query_hash: string;
  query: string;
  source_family?: string | null;
  result_count?: number;
}

export interface EnginePassContext {
  spec: SearchSpec;
  job: SearchJobRow;
  /** Wall-time budget for THIS pass, from the job mode. */
  budgetMs: number;
  /** Aborts when the lease is lost mid-pass. passRunner must honor it. */
  signal: AbortSignal;
  poolTarget: number;
  attemptedQueryHashes: string[];
  excludeCandidateKeys: string[];
}

export interface EnginePassResult {
  qualifiedCount: number;
  researchedCount: number;
  discoveredCount: number;
  newCandidates: EngineNewCandidate[];
  newQueries?: EngineNewQuery[];
  /** Optional override — passRunner knows about untried query variants. */
  completionHint?: SearchJobCompletionReason;
}

export interface JobEngineDeps {
  store: SearchJobsStore;
  passRunner: (ctx: EnginePassContext) => Promise<EnginePassResult>;
  /** Lease owner tag for RPCs, e.g. "worker-1". */
  owner?: string;
  leaseSeconds?: number;
  heartbeatMs?: number;
  /** Idle wait between claims when nothing is claimable. */
  pollMs?: number;
  now?: () => number;
  totalBudgetMs?: number;
  maxPasses?: number;
  /** External stop for the whole engine loop (process shutdown). */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

function poolCapFor(mode: SearchJobMode): number {
  return mode === "job" || mode === "watch" ? POOL_HARD_CAP_JOB_WATCH : POOL_BASE;
}

/**
 * Widening math between passes (frozen):
 *   yield           = qualifiedCount / max(researchedCount, 1), clamped [0.02, 1]
 *   deficit         = target - qualified_count
 *   estimatedNeeded = ceil(deficit / yield)
 *   desired         = max(POOL_BASE, ceil(estimatedNeeded * OVERFETCH))
 *   poolTarget      = min(max(previous, desired), min(POOL_BASE * pass#, cap))
 * where cap is 2000 for job/watch modes and POOL_BASE otherwise.
 */
export function nextPoolTarget(args: {
  passQualifiedCount: number;
  passResearchedCount: number;
  target: number;
  qualifiedCount: number;
  previousPoolTarget: number;
  nextPassNumber: number;
  mode: SearchJobMode;
}): number {
  const yield_ = clamp(
    args.passQualifiedCount / Math.max(args.passResearchedCount, 1),
    MIN_YIELD,
    MAX_YIELD,
  );
  const deficit = Math.max(args.target - args.qualifiedCount, 0);
  const estimatedNeeded = Math.ceil(deficit / yield_);
  const desired = Math.max(POOL_BASE, Math.ceil(estimatedNeeded * OVERFETCH));
  const perPassCap = Math.min(POOL_BASE * Math.max(1, args.nextPassNumber), poolCapFor(args.mode));
  return Math.min(Math.max(args.previousPoolTarget, desired), perPassCap);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Runs claimable jobs until nothing is claimable (then polls every pollMs) or
 * until deps.signal aborts. Each claimed job is processed under a lease with a
 * heartbeat; losing the lease aborts the in-flight pass and its counts are
 * discarded (the new owner re-runs it).
 */
export async function runJobEngine(deps: JobEngineDeps): Promise<void> {
  const { store } = deps;
  const owner = deps.owner ?? "search-job-engine";
  const leaseSeconds = deps.leaseSeconds ?? 300;
  const heartbeatMs = deps.heartbeatMs ?? 30_000;
  const pollMs = deps.pollMs ?? 5_000;

  while (!deps.signal?.aborted) {
    let job: SearchJobRow | null = null;
    try {
      job = await store.claim(owner, leaseSeconds);
    } catch {
      // Transient claim failure — idle-poll and retry.
      await sleep(pollMs, deps.signal);
      continue;
    }
    if (!job) {
      await sleep(pollMs, deps.signal);
      continue;
    }
    await processClaimedJob(job, deps, owner, heartbeatMs);
  }
}

async function processClaimedJob(
  initialJob: SearchJobRow,
  deps: JobEngineDeps,
  owner: string,
  heartbeatMs: number,
): Promise<void> {
  const { store } = deps;
  const totalBudgetMs = deps.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const maxPasses = deps.maxPasses ?? DEFAULT_MAX_PASSES;

  const abort = new AbortController();
  let leaseLost = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  try {
    const budgets: SearchJobBudgets = initialJob.budgets ?? {};
    let poolTarget = typeof budgets.pool_target === "number" ? budgets.pool_target : POOL_BASE;
    let elapsedMs = typeof budgets.elapsed_ms === "number" ? budgets.elapsed_ms : 0;
    let emptyPasses = 0;

    heartbeatTimer = setInterval(() => {
      void store.heartbeat(initialJob.id, owner).then((ok) => {
        if (!ok) {
          leaseLost = true;
          abort.abort(); // kill the in-flight pass immediately
        }
      }).catch(() => {
        // A single failed heartbeat RPC is not proof of loss; the next tick
        // or the store's own RPC error surfaces the real state.
      });
    }, heartbeatMs);

    let job = initialJob;
    while (true) {
      // ---- Checkpoint (before each pass) ----
      const fresh = await store.get(job.id);
      if (!fresh) return; // job deleted under us
      if (fresh.stop_requested_at) {
        // Finish-any-current-pass already persisted; stop now.
        await store.completeJob(fresh.id, "USER_STOPPED");
        await store.release(fresh.id, owner);
        return;
      }
      if (fresh.pause_requested_at) {
        await store.update(fresh.id, { status: "paused" });
        await store.release(fresh.id, owner);
        return;
      }
      if (fresh.qualified_count >= fresh.target) {
        await store.completeJob(fresh.id, "TARGET_REACHED");
        return;
      }
      if (elapsedMs >= totalBudgetMs || fresh.current_pass >= maxPasses) {
        await store.completeJob(fresh.id, "BUDGET_EXHAUSTED");
        return;
      }

      // ---- Run one pass ----
      const [attemptedQueryHashes, excludeCandidateKeys] = await Promise.all([
        store.listAttemptedQueryHashes(fresh.id),
        store.listCandidateKeys(fresh.id),
      ]);
      const passStartedThisPass = (deps.now ?? Date.now)();
      const pass: EnginePassResult = await deps.passRunner({
        spec: fresh.spec,
        job: fresh,
        budgetMs: PASS_BUDGET_MS[fresh.mode],
        signal: abort.signal,
        poolTarget,
        attemptedQueryHashes,
        excludeCandidateKeys,
      });

      // ---- Claim loss: abort, persist NOTHING from this pass, re-loop ----
      if (leaseLost || abort.signal.aborted) {
        return; // another worker owns the job now
      }

      // ---- Persist pass results ----
      for (const candidate of pass.newCandidates) {
        await store.upsertCandidate(fresh.id, candidate);
      }
      for (const query of pass.newQueries ?? []) {
        await store.recordQuery(fresh.id, query);
      }
      await store.bumpCounts(fresh.id, {
        discovered: pass.discoveredCount,
        researched: pass.researchedCount,
        qualified: pass.qualifiedCount,
      });

      // ---- Widening between passes ----
      const nextPassNumber = fresh.current_pass + 1;
      poolTarget = nextPoolTarget({
        passQualifiedCount: pass.qualifiedCount,
        passResearchedCount: pass.researchedCount,
        target: fresh.target,
        qualifiedCount: fresh.qualified_count,
        previousPoolTarget: poolTarget,
        nextPassNumber,
        mode: fresh.mode,
      });
      elapsedMs += (deps.now ?? Date.now)() - passStartedThisPass;

      const updated = await store.update(fresh.id, {
        current_pass: nextPassNumber,
        budgets: { ...fresh.budgets, pool_target: poolTarget, elapsed_ms: elapsedMs },
      });

      // ---- Terminal checks (after persisting, counts now include this pass) ----
      const after = updated ?? fresh;
      const bumped = (await store.get(fresh.id)) ?? after;
      if (bumped.qualified_count >= bumped.target) {
        await store.completeJob(bumped.id, "TARGET_REACHED");
        return;
      }
      if (pass.completionHint) {
        await store.completeJob(bumped.id, pass.completionHint);
        return;
      }
      const passEmpty = pass.newCandidates.length === 0 && pass.discoveredCount === 0;
      emptyPasses = passEmpty ? emptyPasses + 1 : 0;
      if (emptyPasses >= COVERAGE_EMPTY_PASSES) {
        await store.completeJob(bumped.id, "COVERAGE_EXHAUSTED");
        return;
      }
      if (elapsedMs >= totalBudgetMs || nextPassNumber >= maxPasses) {
        await store.completeJob(bumped.id, "BUDGET_EXHAUSTED");
        return;
      }
      job = bumped;
    }
  } catch (err) {
    if (leaseLost || abort.signal.aborted) return; // lease loss is not a failure
    try {
      await store.failJob(initialJob.id, err instanceof Error ? err.message : String(err));
      await store.release(initialJob.id, owner);
    } catch {
      // Store itself is broken — nothing more this worker can do.
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}
