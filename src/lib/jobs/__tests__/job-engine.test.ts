/**
 * Engine tests (Workstream 1) — offline and deterministic.
 *
 * The engine is fully dependency-injected: tests run it against FakeStore,
 * an in-memory SearchJobsStore whose claim/heartbeat implement the same lease
 * semantics as the migration's RPCs (single-threaded JS makes the fake claim
 * trivially atomic; the SQL's FOR UPDATE SKIP LOCKED is asserted textually —
 * honest limitation: no real Postgres in this suite).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runJobEngine,
  type EngineNewCandidate,
  type EnginePassContext,
  type EnginePassResult,
  type JobEngineDeps,
} from "../job-engine.server";
 import {
  SearchJobConflictError,
  type SearchJobCandidateRow,
  type SearchJobQueryRow,
  type SearchJobRow,
  type SearchJobsStore,
} from "../search-job.types";
import type { SearchSpec } from "@/lib/search/search-spec";

const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20260927000000_search_jobs.sql", import.meta.url)),
  "utf8",
);

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(label: string, cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`until timeout: ${label}`);
    await sleepMs(2);
  }
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeSpec(): SearchSpec {
  return {
    entity: "company",
    criteria: [{ field: "industry", value: "dentist", stated: true, confidence: 1 }],
    missing: [],
    signal_required: false,
    signal_types: [],
    signal_recency: null,
    status: "ready_to_search",
    raw_query: "dentists in Pune",
  };
}

/** In-memory SearchJobsStore mirroring the migration's lease semantics. */
class FakeStore implements SearchJobsStore {
  jobs = new Map<string, SearchJobRow>();
  candidates = new Map<string, SearchJobCandidateRow>();
  queries = new Map<string, SearchJobQueryRow>();
  sources = new Map<string, { job_id: string; source: string }>();
  claimCalls = 0;
  releases = 0;
  nowMs = 1_700_000_000_000;

  private seq = 0;
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
  iso(): string {
    return new Date(this.nowMs).toISOString();
  }
  advanceMs(ms: number): void {
    this.nowMs += ms;
  }

  addJob(overrides: Partial<SearchJobRow> = {}): SearchJobRow {
    const id = this.nextId("job");
    const row: SearchJobRow = {
      id,
      user_id: "user-1",
      project_id: null,
      watch_id: null,
      scheduled_for: null,
      spec: makeSpec(),
      target: 10,
      mode: "job",
      status: "queued",
      completion_reason: null,
      discovered_count: 0,
      researched_count: 0,
      qualified_count: 0,
      current_pass: 0,
      budgets: {},
      project_context_version: null,
      context_snapshot: null,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      pause_requested_at: null,
      stop_requested_at: null,
      error: null,
      created_at: this.iso(),
      updated_at: this.iso(),
      ...overrides,
    };
    this.jobs.set(id, row);
    return row;
  }

  async create(job: Parameters<SearchJobsStore["create"]>[0]): Promise<SearchJobRow> {
    // Mirror the partial UNIQUE (watch_id, scheduled_for).
    for (const existing of this.jobs.values()) {
      if (
        job.watch_id &&
        existing.watch_id === job.watch_id &&
        job.scheduled_for &&
        existing.scheduled_for === job.scheduled_for
      ) {
        throw new SearchJobConflictError("duplicate (watch_id, scheduled_for)");
      }
    }
    return this.addJob({
      user_id: job.user_id,
      project_id: job.project_id ?? null,
      watch_id: job.watch_id ?? null,
      scheduled_for: job.scheduled_for ?? null,
      spec: job.spec,
      target: job.target,
      mode: job.mode,
    });
  }

  async get(jobId: string): Promise<SearchJobRow | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async list(userId: string, opts: { page: number; pageSize: number }) {
    const all = [...this.jobs.values()]
      .filter((j) => j.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const start = opts.page * opts.pageSize;
    return { rows: all.slice(start, start + opts.pageSize).map((j) => ({ ...j })), total: all.length };
  }

  async update(jobId: string, patch: Parameters<SearchJobsStore["update"]>[1]) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, patch, { updated_at: this.iso() });
    return { ...job };
  }

  async delete(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async upsertCandidate(
    jobId: string,
    c: Parameters<SearchJobsStore["upsertCandidate"]>[1],
  ): Promise<void> {
    const key = `${jobId}:${c.candidate_key}`;
    const existing = this.candidates.get(key);
    if (existing) {
      existing.entity_id = c.entity_id ?? existing.entity_id;
      existing.state = c.state ?? existing.state;
      existing.priority = c.priority ?? existing.priority;
      existing.attempts = c.attempts ?? existing.attempts;
      existing.data = c.data ?? existing.data;
      existing.updated_at = this.iso();
      return;
    }
    this.candidates.set(key, {
      id: this.nextId("cand"),
      job_id: jobId,
      candidate_key: c.candidate_key,
      entity_id: c.entity_id ?? null,
      state: c.state ?? "DISCOVERED",
      priority: c.priority ?? 0,
      attempts: c.attempts ?? 0,
      data: c.data ?? {},
      discovered_at: this.iso(),
      researched_at: null,
      qualified_at: null,
      created_at: this.iso(),
      updated_at: this.iso(),
    });
  }

  async recordQuery(jobId: string, q: Parameters<SearchJobsStore["recordQuery"]>[1]): Promise<void> {
    const key = `${jobId}:${q.query_hash}`;
    const existing = this.queries.get(key);
    if (existing) {
      existing.source_family = q.source_family ?? existing.source_family;
      existing.result_count = q.result_count ?? existing.result_count;
      existing.attempted_at = this.iso();
      existing.updated_at = this.iso();
      return;
    }
    this.queries.set(key, {
      id: this.nextId("q"),
      job_id: jobId,
      query_hash: q.query_hash,
      query: q.query,
      source_family: q.source_family ?? null,
      attempted_at: this.iso(),
      result_count: q.result_count ?? 0,
      created_at: this.iso(),
      updated_at: this.iso(),
    });
  }

  async upsertSource(jobId: string, s: Parameters<SearchJobsStore["upsertSource"]>[1]): Promise<void> {
    this.sources.set(`${jobId}:${s.source}`, { job_id: jobId, source: s.source });
  }

  async bumpCounts(jobId: string, delta: Parameters<SearchJobsStore["bumpCounts"]>[1]): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.discovered_count += delta.discovered ?? 0;
    job.researched_count += delta.researched ?? 0;
    job.qualified_count += delta.qualified ?? 0;
    job.updated_at = this.iso();
  }

  async setDesiredPause(jobId: string): Promise<void> {
    await this.update(jobId, { pause_requested_at: this.iso() });
  }
  async setDesiredStop(jobId: string): Promise<void> {
    await this.update(jobId, { stop_requested_at: this.iso() });
  }
  async clearDesired(jobId: string): Promise<void> {
    await this.update(jobId, { pause_requested_at: null, stop_requested_at: null });
  }

  async completeJob(jobId: string, reason: Parameters<SearchJobsStore["completeJob"]>[1]): Promise<void> {
    const status = reason === "USER_STOPPED" ? "stopped" : "completed";
    const row = await this.update(jobId, { status, completion_reason: reason });
    if (!row) throw new Error(`completeJob: job ${jobId} missing`);
  }

  async failJob(jobId: string, error: string): Promise<void> {
    await this.update(jobId, { status: "failed", completion_reason: "FAILED", error });
  }

  async claim(owner: string, leaseSeconds: number) {
    this.claimCalls += 1;
    for (const job of this.jobs.values()) {
      // Frozen claimable predicate: (queued|running) AND (lease NULL OR expired).
      const leaseLive =
        job.lease_expires_at !== null && new Date(job.lease_expires_at).getTime() >= this.nowMs;
      if ((job.status === "queued" || job.status === "running") && !leaseLive) {
        job.status = "running";
        job.lease_owner = owner;
        job.lease_expires_at = new Date(this.nowMs + leaseSeconds * 1000).toISOString();
        job.heartbeat_at = this.iso();
        job.updated_at = this.iso();
        return { ...job };
      }
    }
    return null;
  }

  async heartbeat(jobId: string, owner: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.lease_owner !== owner) return false;
    if (!job.lease_expires_at || new Date(job.lease_expires_at).getTime() <= this.nowMs) return false;
    job.lease_expires_at = new Date(this.nowMs + 300_000).toISOString();
    job.heartbeat_at = this.iso();
    return true;
  }

  async release(jobId: string, owner: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && job.lease_owner === owner) {
      job.lease_owner = null;
      job.lease_expires_at = null;
      this.releases += 1;
    }
  }

  async listAttemptedQueryHashes(jobId: string): Promise<string[]> {
    return [...this.queries.values()].filter((q) => q.job_id === jobId).map((q) => q.query_hash);
  }
  async listCandidateKeys(jobId: string): Promise<string[]> {
    return [...this.candidates.values()].filter((c) => c.job_id === jobId).map((c) => c.candidate_key);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passResult(over: Partial<EnginePassResult> = {}): EnginePassResult {
  return {
    qualifiedCount: 0,
    researchedCount: 0,
    discoveredCount: 0,
    newCandidates: [],
    ...over,
  };
}

function candidate(key: string, i: number): EngineNewCandidate {
  return { candidate_key: key, state: "DISCOVERED", priority: i, attempts: i, data: { i } };
}

function startEngine(
  store: FakeStore,
  passRunner: (ctx: EnginePassContext) => Promise<EnginePassResult>,
  overrides: Partial<JobEngineDeps> = {},
) {
  const stop = new AbortController();
  const done = runJobEngine({
    store,
    passRunner,
    owner: "engine-under-test",
    leaseSeconds: 300,
    heartbeatMs: 5,
    pollMs: 5,
    signal: stop.signal,
    ...overrides,
  });
  return { stop, done };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("search job engine", () => {
  it("1. two concurrent claims on one queued job → exactly one wins (SQL atomicity asserted textually)", async () => {
    const store = new FakeStore();
    store.addJob({ target: 5 });
    const [a, b] = await Promise.all([store.claim("A", 300), store.claim("B", 300)]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.status).toBe("running");
    // Honest limitation: the fake store is single-threaded; the real
    // single-statement atomicity lives in the migration and is asserted here.
    expect(MIGRATION_SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(MIGRATION_SQL).toContain("FUNCTION public.claim_search_job");
  });

  it("2. lease expiry reclaim: worker A stops heartbeating → worker B claims and finishes", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 5 });
    const claimedA = await store.claim("worker-a", 300);
    expect(claimedA!.lease_owner).toBe("worker-a");
    store.advanceMs(300_001); // worker-a died; lease clock runs out

    const { stop, done } = startEngine(
      store,
      async () => passResult({ qualifiedCount: 5, researchedCount: 5, discoveredCount: 5 }),
      { owner: "worker-b" },
    );
    await until("claimed by B", () => store.jobs.get(job.id)!.lease_owner === "worker-b");
    await until("completed", () => store.jobs.get(job.id)!.status === "completed");
    stop.abort();
    await done;
    const finished = store.jobs.get(job.id)!;
    expect(finished.completion_reason).toBe("TARGET_REACHED");
  });

  it("3. heartbeat ownership loss: pass aborted, zero partial writes", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 10 });
    let passStarted = false;
    let passReturned = false;
    const { stop, done } = startEngine(store, async (ctx) => {
      passStarted = true;
      await until("lease loss aborts pass", () => ctx.signal.aborted);
      passReturned = true;
      return passResult({
        discoveredCount: 5,
        researchedCount: 5,
        qualifiedCount: 5,
        newCandidates: [candidate("k1", 1)],
      });
    });
    await until("pass started", () => passStarted);
    // Another worker steals the lease out from under the engine.
    const stolen = store.jobs.get(job.id)!;
    expect(stolen.lease_owner).toBe("engine-under-test");
    stolen.lease_owner = "thief";
    await until("pass settled", () => passReturned);

    const after = store.jobs.get(job.id)!;
    expect(after.qualified_count).toBe(0); // no counts written for the lost pass
    expect(after.researched_count).toBe(0);
    expect(after.discovered_count).toBe(0);
    expect(store.candidates.size).toBe(0); // no candidate writes either
    expect(after.status).toBe("running"); // not failed, not completed
    expect(after.completion_reason).toBeNull();
    expect(after.error).toBeNull();
    expect(after.lease_owner).toBe("thief");
    stop.abort();
    await done;
  });

  it("4. pause at checkpoint: status paused, lease released; resume → queued → completes", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 10 });
    await store.setDesiredPause(job.id);
    let passRuns = 0;
    const first = startEngine(
      store,
      async () => {
        passRuns += 1;
        return passResult({ qualifiedCount: 10, researchedCount: 10, discoveredCount: 10 });
      },
    );
    await until("paused", () => store.jobs.get(job.id)!.status === "paused");
    first.stop.abort();
    await first.done;
    const paused = store.jobs.get(job.id)!;
    expect(paused.completion_reason).toBeNull();
    expect(paused.lease_owner).toBeNull(); // lease released on graceful pause
    expect(paused.lease_expires_at).toBeNull();
    expect(passRuns).toBe(0); // checkpoint fired before any pass ran

    // resumeSearchJob semantics: paused → queued + clearDesired.
    await store.update(job.id, { status: "queued" });
    await store.clearDesired(job.id);
    const second = startEngine(store, async () => {
      passRuns += 1;
      return passResult({ qualifiedCount: 10, researchedCount: 10, discoveredCount: 10 });
    });
    await until("completed after resume", () => store.jobs.get(job.id)!.status === "completed");
    second.stop.abort();
    await second.done;
    expect(store.jobs.get(job.id)!.completion_reason).toBe("TARGET_REACHED");
    expect(passRuns).toBe(1);
  });

  it("5. stop at checkpoint: stopped + USER_STOPPED, finished pass persisted, rows preserved", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 10 });
    const { stop, done } = startEngine(store, async () => {
      await store.setDesiredStop(job.id); // stop lands mid-pass
      return passResult({
        qualifiedCount: 3,
        researchedCount: 7,
        discoveredCount: 7,
        newCandidates: [candidate("k1", 1), candidate("k2", 2)],
      });
    });
    await until("stopped", () => store.jobs.get(job.id)!.status === "stopped");
    stop.abort();
    await done;
    const j = store.jobs.get(job.id)!;
    expect(j.completion_reason).toBe("USER_STOPPED");
    expect(j.qualified_count).toBe(3); // current pass was finished and persisted
    expect(j.current_pass).toBe(1);
    expect(store.candidates.size).toBe(2); // discovered rows preserved
    expect(j.lease_owner).toBeNull();
  });

  it("6. widening: low-yield passes grow poolTarget; target reached → TARGET_REACHED", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 10, mode: "job" });
    const poolTargetsSeen: number[] = [];
    let call = 0;
    const { stop, done } = startEngine(store, async (ctx) => {
      call += 1;
      poolTargetsSeen.push(ctx.poolTarget);
      if (call === 1) {
        return passResult({
          qualifiedCount: 1,
          researchedCount: 100, // yield 0.01 → clamped 0.02
          discoveredCount: 10,
          newCandidates: Array.from({ length: 10 }, (_, i) => candidate(`p1-${i}`, i)),
        });
      }
      if (call === 2) {
        return passResult({
          qualifiedCount: 1,
          researchedCount: 100,
          discoveredCount: 10,
          newCandidates: Array.from({ length: 10 }, (_, i) => candidate(`p2-${i}`, i)),
        });
      }
      return passResult({ qualifiedCount: 8, researchedCount: 8, discoveredCount: 8 });
    });
    await until("completed", () => store.jobs.get(job.id)!.status === "completed");
    stop.abort();
    await done;
    const j = store.jobs.get(job.id)!;
    expect(j.completion_reason).toBe("TARGET_REACHED");
    expect(j.qualified_count).toBe(10);
    // Pass 1 starts at POOL_BASE. After pass 1 the per-pass cap is still 250*1;
    // after pass 2 the cap is 250*2=500 and the yield math demands 675 → 500.
    expect(poolTargetsSeen).toEqual([250, 250, 500]);
    expect(j.budgets.pool_target).toBe(500);
  });

  it("7. two consecutive passes with zero new candidates → COVERAGE_EXHAUSTED", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 10 });
    let calls = 0;
    const { stop, done } = startEngine(store, async () => {
      calls += 1;
      return passResult();
    });
    await until("completed", () => store.jobs.get(job.id)!.status === "completed");
    stop.abort();
    await done;
    expect(calls).toBe(2);
    const j = store.jobs.get(job.id)!;
    expect(j.status).toBe("completed");
    expect(j.completion_reason).toBe("COVERAGE_EXHAUSTED");
  });

  it("8. candidate/query upsert dedupe: same keys across passes → single rows", async () => {
    const store = new FakeStore();
    const job = store.addJob({ target: 10 });
    let call = 0;
    const { stop, done } = startEngine(store, async () => {
      call += 1;
      return passResult({
        qualifiedCount: call === 1 ? 0 : 10,
        researchedCount: 5,
        discoveredCount: 1,
        newCandidates: [candidate("dup-key", call)],
        newQueries: [{ query_hash: "h1", query: "same query", result_count: call }],
      });
    });
    await until("completed", () => store.jobs.get(job.id)!.status === "completed");
    stop.abort();
    await done;
    expect(store.candidates.size).toBe(1);
    const cand = [...store.candidates.values()][0]!;
    expect(cand.candidate_key).toBe("dup-key");
    expect(cand.attempts).toBe(2); // ON CONFLICT DO UPDATE → last write wins
    expect(store.queries.size).toBe(1);
    expect([...store.queries.values()][0]!.result_count).toBe(2);
  });

  it("9. watch idempotency: migration declares the partial unique index; duplicates raise SearchJobConflictError", async () => {
    // The real DB rejects the second insert via uq_search_jobs_watch_sched.
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_search_jobs_watch_sched[\s\S]*?WHERE watch_id IS NOT NULL AND scheduled_for IS NOT NULL;/,
    );
    const store = new FakeStore();
    await store.create({
      user_id: "user-1",
      watch_id: "w-1",
      scheduled_for: "2026-09-27T00:00:00.000Z",
      spec: makeSpec(),
      target: 10,
      mode: "watch",
    });
    await expect(
      store.create({
        user_id: "user-1",
        watch_id: "w-1",
        scheduled_for: "2026-09-27T00:00:00.000Z",
        spec: makeSpec(),
        target: 10,
        mode: "watch",
      }),
    ).rejects.toBeInstanceOf(SearchJobConflictError);
  });

  it("10. completion_reason mapping for every terminal path", async () => {
    // TARGET_REACHED
    {
      const store = new FakeStore();
      const job = store.addJob({ target: 3 });
      const run = startEngine(
        store,
        async () => passResult({ qualifiedCount: 3, researchedCount: 3, discoveredCount: 3 }),
      );
      await until("target", () => {
        const s = store.jobs.get(job.id)!.status;
        return s === "completed" || s === "stopped" || s === "failed";
      });
      run.stop.abort();
      await run.done;
      expect(store.jobs.get(job.id)!.completion_reason).toBe("TARGET_REACHED");
      expect(store.jobs.get(job.id)!.status).toBe("completed");
    }
    // COVERAGE_EXHAUSTED
    {
      const store = new FakeStore();
      const job = store.addJob({ target: 3 });
      const run = startEngine(store, async () => passResult());
      await until("coverage", () => store.jobs.get(job.id)!.status === "completed");
      run.stop.abort();
      await run.done;
      expect(store.jobs.get(job.id)!.completion_reason).toBe("COVERAGE_EXHAUSTED");
    }
    // BUDGET_EXHAUSTED (pass-count budget)
    {
      const store = new FakeStore();
      const job = store.addJob({ target: 999 });
      const run = startEngine(
        store,
        async () =>
          passResult({
            qualifiedCount: 1,
            researchedCount: 2,
            discoveredCount: 2,
            newCandidates: [candidate("k", 1)],
          }),
        { maxPasses: 1 },
      );
      await until("budget", () => store.jobs.get(job.id)!.status === "completed");
      run.stop.abort();
      await run.done;
      expect(store.jobs.get(job.id)!.completion_reason).toBe("BUDGET_EXHAUSTED");
    }
    // USER_STOPPED
    {
      const store = new FakeStore();
      const job = store.addJob({ target: 3 });
      const run = startEngine(store, async () => {
        await store.setDesiredStop(job.id);
        return passResult({ qualifiedCount: 1, researchedCount: 1, discoveredCount: 1 });
      });
      await until("stopped", () => store.jobs.get(job.id)!.status === "stopped");
      run.stop.abort();
      await run.done;
      expect(store.jobs.get(job.id)!.completion_reason).toBe("USER_STOPPED");
      expect(store.jobs.get(job.id)!.status).toBe("stopped");
    }
    // FAILED (unexpected passRunner error)
    {
      const store = new FakeStore();
      const job = store.addJob({ target: 3 });
      const run = startEngine(store, async () => {
        throw new Error("pass exploded");
      });
      await until("failed", () => store.jobs.get(job.id)!.status === "failed");
      run.stop.abort();
      await run.done;
      const j = store.jobs.get(job.id)!;
      expect(j.completion_reason).toBe("FAILED");
      expect(j.error).toContain("pass exploded");
      expect(j.lease_owner).toBeNull(); // lease released on failure
    }
  });
});
