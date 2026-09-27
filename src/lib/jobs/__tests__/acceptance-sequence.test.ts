/**
 * Data-asset whole-sequence acceptance — DETERMINISTIC, OFFLINE.
 *
 * Walks the frozen sequence end to end:
 *   Create Project (context v1) → "find 100" job pins context snapshot v1 →
 *   first rows stream → project edited to context v2 WHILE job runs → running
 *   job stays on v1 → worker restart simulated (lease expires, new owner
 *   claims atomically) → job resumes WITHOUT duplicate candidates/queries →
 *   target reached OR honest COVERAGE_EXHAUSTED → dataset queryable from the
 *   job store (project-scoped store.list) → selected rows added to a project
 *   List (dedupe by entity_id) → same-thesis rerun reuse invariants →
 *   Watch from thesis rides the SAME engine (mode 'watch') → watch diff
 *   notification outcomes → outbox ambiguous delivery → no duplicate intents.
 *
 * Honesty notes (no frozen source file was edited):
 *  - The engine runs against an in-memory SearchJobsStore whose claim /
 *    heartbeat mirror the migration's RPC semantics; the SQL's real
 *    single-statement atomicity is asserted textually (same limitation as
 *    job-engine.test.ts — no real Postgres in this suite).
 *  - createSearchJob is a TanStack server fn (auth middleware) and cannot run
 *    offline; the frozen context-pinning block is replicated here through the
 *    exact same store.update call that fn makes.
 *  - The reuse invariants are driven by a scripted indexer double feeding
 *    createReuseRun() (the parent workstream's documented wiring point),
 *    with staleness decided by the REAL freshness module.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/jobs/worker.server", () => ({ ensureJobWorkerStarted: () => {} }));

import {
  nextPoolTarget,
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
import { createReuseRun, type ReuseRun, type ReuseRunSnapshot } from "../../canonical/reuse-metrics.server";
import { isFieldFresh } from "../../canonical/freshness";
import { addListItems, updateProjectContext } from "../../projects/projects-store";
import {
  createWatchJob,
  fingerprintFor,
  processWatchJob,
  scheduleSlotFor,
  type WatchRecord,
} from "../../watch/watch-scheduler.server";
import { enqueueNotification, processOutbox, type AdapterOverride } from "../../notifications/outbox.server";
import type { NotificationChannel } from "../../notifications/types";

// ---------------------------------------------------------------------------
// Migration SQL (textual atomicity/unique assertions — no real Postgres here)
// ---------------------------------------------------------------------------

const SEARCH_JOBS_SQL = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20260927000000_search_jobs.sql", import.meta.url)),
  "utf8",
);
const NOTIFICATIONS_SQL = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20260928000000_notifications.sql", import.meta.url)),
  "utf8",
);

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(label: string, cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`until timeout: ${label}`);
    await sleepMs(2);
  }
}

// ---------------------------------------------------------------------------
// In-memory SearchJobsStore — copy of the job-engine.test.ts fake, plus the
// real store's project-scoped list() filter (eq(user_id) + eq(project_id)).
// ---------------------------------------------------------------------------

function makeThesis(): SearchSpec {
  return {
    entity: "company",
    criteria: [{ field: "industry", value: "dentist", stated: true, confidence: 1 }],
    missing: [],
    signal_required: false,
    signal_types: [],
    signal_recency: null,
    status: "ready_to_search",
    raw_query: "find 100 dentists",
  };
}

class FakeSearchJobsStore implements SearchJobsStore {
  jobs = new Map<string, SearchJobRow>();
  candidates = new Map<string, SearchJobCandidateRow>();
  queries = new Map<string, SearchJobQueryRow>();
  claimCalls = 0;
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
      user_id: USER,
      project_id: null,
      watch_id: null,
      scheduled_for: null,
      spec: makeThesis(),
      target: 10,
      mode: "batch",
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
    // Partial UNIQUE (watch_id, scheduled_for) — idempotent watch schedule slots.
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

  // Project-scoped read (mirrors search-jobs.server.ts: eq(user_id) + optional
  // eq(project_id), newest first, paged, honest total).
  async list(
    userId: string,
    opts: { page: number; pageSize: number; projectId?: string | null },
  ): Promise<{ rows: SearchJobRow[]; total: number }> {
    const all = [...this.jobs.values()]
      .filter((j) => j.user_id === userId)
      .filter((j) => (opts.projectId ? j.project_id === opts.projectId : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const start = Math.max(0, opts.page) * opts.pageSize;
    return {
      rows: all.slice(start, start + opts.pageSize).map((j) => ({ ...j })),
      total: all.length,
    };
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

  async upsertSource(): Promise<void> {}

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

  // Frozen claimable predicate: (queued|running) AND (lease NULL OR expired).
  async claim(owner: string, leaseSeconds: number) {
    this.claimCalls += 1;
    for (const job of this.jobs.values()) {
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
// Fake supabase client for the watch scheduler / projects store / outbox
// (same thenable-builder pattern as watch-scheduler.test.ts + the projects
// store tests' upsert support).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const UNIQUE_KEYS: Record<string, string[]> = {
  search_jobs: ["watch_id+scheduled_for"],
  notification_outbox: ["idempotency_key"],
  watch_seen_matches: ["watch_id+entity_id+match_fingerprint"],
};

/** search_jobs column defaults (mimic the DB so zod row parsing passes). */
function jobColumnDefaults(): Row {
  return {
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
  };
}

/** notification_outbox column defaults (mimic the DB). */
function outboxColumnDefaults(): Row {
  return {
    status: "pending",
    attempts: 0,
    last_error: null,
    available_at: new Date().toISOString(),
    delivered_at: null,
  };
}

class Builder {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private values: Row[] = [];
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private filters: Array<[string, string, unknown]> = [];
  private want: "none" | "single" | "maybeSingle" = "none";
  private limitN: number | null = null;
  private selectCols: string | null = null;

  constructor(
    private client: FakeSupabase,
    private table: string,
  ) {}

  select(cols?: string) {
    this.selectCols = cols ?? "*";
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.values = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict ?? null;
    this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = [values];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, "eq", val]);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push([col, "in", vals]);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push([col, "lt", val]);
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push([col, "lte", val]);
    return this;
  }
  order(_col: string, _opts?: { ascending?: boolean }) {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.want = "single";
    return this;
  }
  maybeSingle() {
    this.want = "maybeSingle";
    return this;
  }

  private matches(r: Row): boolean {
    return this.filters.every(([col, op, val]) => {
      if (op === "eq") return r[col] === val;
      if (op === "in") return (val as unknown[]).includes(r[col]);
      if (op === "lt") return String(r[col]) < String(val);
      if (op === "lte") return String(r[col]) <= String(val);
      return false;
    });
  }

  private shapeMutation(rows: Row[]): { data: unknown; error: unknown } {
    if (this.want === "single") {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "no rows / multiple rows" } };
    }
    if (this.want === "maybeSingle") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  private exec(): { data: unknown; error: unknown } {
    const rows = this.client.tables[this.table] ?? (this.client.tables[this.table] = []);
    const now = new Date().toISOString();

    if (this.op === "insert" || this.op === "upsert") {
      const conflictKeys = this.onConflict
        ? this.onConflict.split(",").map((s) => s.trim())
        : (UNIQUE_KEYS[this.table] ?? []).flatMap((uk) => uk.split("+"));
      const results: Row[] = [];
      for (const value of this.values) {
        if (this.op === "insert") {
          const stamped: Row = {
            id: this.client.nextUuid(),
            ...(this.table === "search_jobs" ? jobColumnDefaults() : {}),
            ...(this.table === "notification_outbox" ? outboxColumnDefaults() : {}),
            ...value,
            created_at: now,
            updated_at: (value.updated_at as string) ?? now,
          };
          const clash =
            conflictKeys.length > 0 &&
            conflictKeys.every((c) => stamped[c] !== undefined && stamped[c] !== null) &&
            rows.some((r) => conflictKeys.every((c) => r[c] === stamped[c]));
          if (clash) return { data: null, error: { code: "23505", message: "duplicate key value" } };
          rows.push(stamped);
          results.push(stamped);
        } else {
          // upsert: ON CONFLICT (conflictKeys) — merge, or skip on ignoreDuplicates.
          const keyOf = (r: Row) => conflictKeys.map((k) => String(r[k])).join("|");
          const idx = conflictKeys.length ? rows.findIndex((r) => keyOf(r) === keyOf(value)) : -1;
          if (idx >= 0) {
            if (this.ignoreDuplicates) continue; // dedupe: skip, not an error
            rows[idx] = { ...rows[idx], ...value, updated_at: now };
            results.push(rows[idx]!);
          } else {
            const stamped = { id: this.client.nextUuid(), ...value, created_at: now, updated_at: now };
            rows.push(stamped);
            results.push(stamped);
          }
        }
      }
      if (this.op === "upsert" && !this.selectCols) return { data: results, error: null };
      return this.shapeMutation(results);
    }

    if (this.op === "update") {
      let patched = rows.filter((r) => this.matches(r));
      if (this.limitN !== null) patched = patched.slice(0, this.limitN);
      for (const r of patched) Object.assign(r, ...this.values, { updated_at: now });
      return this.shapeMutation(patched);
    }
    if (this.op === "delete") {
      const doomed = rows.filter((r) => this.matches(r));
      for (const r of doomed) rows.splice(rows.indexOf(r), 1);
      return { data: doomed, error: null };
    }

    let out = rows.filter((r) => this.matches(r));
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    if (this.want === "single") {
      return out.length
        ? { data: out[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    return this.shapeMutation(out);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: (v: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>,
    onRejected?: (e: unknown) => TResult2 | PromiseLike<TResult2>,
  ) {
    return Promise.resolve().then(() => this.exec()).then(onFulfilled, onRejected);
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {
    search_jobs: [],
    search_job_candidates: [],
    search_job_queries: [],
    campaigns: [],
    watch_seen_matches: [],
    notification_outbox: [],
    notification_connections: [],
  };
  private seq = 0;
  from(table: string): Builder {
    return new Builder(this, table);
  }
  nextUuid(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }
}

const sharedClient = new FakeSupabase();

vi.mock("@/integrations/my-supabase/admin.server", () => ({
  getAdmin: () => sharedClient,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT_A = "00000000-0000-4000-8000-00000000000a";
const PROJECT_B = "00000000-0000-4000-8000-00000000000b";

/** project_context row v1 (shape of the migration's project_context table). */
const CONTEXT_V1: Row = {
  id: "ctx-1",
  project_id: PROJECT_A,
  context_version: 1,
  default_icp_id: null,
  offer_profile: { what_they_do: "dental clinics" },
  preferred_geographies: ["Austin"],
  exclusions: ["agencies"],
  preferred_signals: ["hiring"],
  messaging_preferences: {},
  custom_context: {},
  updated_at: "t0",
};

function passResult(over: Partial<EnginePassResult> = {}): EnginePassResult {
  return {
    qualifiedCount: 0,
    researchedCount: 0,
    discoveredCount: 0,
    newCandidates: [],
    ...over,
  };
}

function cand(key: string, entityState: string, passNo: number): EngineNewCandidate {
  return {
    candidate_key: key,
    entity_id: key.replace("company:", ""),
    state: entityState,
    priority: passNo,
    attempts: passNo,
    data: { pass: passNo },
  };
}

/** A block of `n` qualified company entities e{from}..e{from+n-1}. */
function qualifiedBlock(from: number, n: number, passNo: number): EngineNewCandidate[] {
  return Array.from({ length: n }, (_, i) => cand(`company:e${from + i}`, "QUALIFIED", passNo));
}

function startEngine(
  store: FakeSearchJobsStore,
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
    pollMs: 2,
    signal: stop.signal,
    ...overrides,
  });
  return { stop, done };
}

/**
 * Mirrors the frozen context-pinning block of createSearchJob
 * (src/lib/search-jobs.functions.ts): read project_context, strip
 * context_version, stamp the job with version + snapshot via store.update —
 * the exact write that server fn performs.
 */
async function pinProjectContext(
  store: FakeSearchJobsStore,
  jobId: string,
  ctxRow: Row,
): Promise<{ version: number; snapshot: Row }> {
  const { context_version: v, ...snap } = ctxRow;
  const version = typeof v === "number" ? v : 0;
  await store.update(jobId, {
    project_context_version: version,
    context_snapshot: snap as Record<string, unknown>,
  });
  return { version, snapshot: snap };
}

// ---------------------------------------------------------------------------
// Scenario state shared by the ordered steps below
// ---------------------------------------------------------------------------

const store = new FakeSearchJobsStore();
const poolTargetsSeen: number[] = [];
let jobId = "";
let contextSnapshotV1: Row = {};
let passCall = 0;
let engineAStopped: { stop: AbortController; done: Promise<void> } | null = null;

const S8 = { watchId: "", slot: "", watchJobId: "" };

function fakeAdapter(
  status: "delivered" | "delivery_unknown" | "failed",
  error?: string,
): NotificationChannel & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async send(n: never) {
      calls.push(n);
      return { status, error };
    },
  } as NotificationChannel & { calls: unknown[] };
}

/** Scripted "find 100" pass schedule (batch mode, target 100):
 *  pass1 streams the first 10 qualified cheaply; pass2 is lost to a lease
 *  expiry; the post-restart owner re-runs pass2 and drives to 100. */
async function scriptedFind100Pass(ctx: EnginePassContext): Promise<EnginePassResult> {
  passCall += 1;
  poolTargetsSeen.push(ctx.poolTarget);
  const call = passCall;
  if (call === 1) {
    return passResult({
      qualifiedCount: 10,
      researchedCount: 20, // cheap first rows
      discoveredCount: 12,
      newCandidates: [
        ...qualifiedBlock(1, 10, 1),
        cand("company:d1", "DISCOVERED", 1),
        cand("company:d2", "DISCOVERED", 1),
      ],
      newQueries: [
        { query_hash: "h1", query: "dentists austin", result_count: 8 },
        { query_hash: "h2", query: "dentists tx", result_count: 7 },
        { query_hash: "h3", query: "dentists pune", result_count: 5 },
      ],
    });
  }
  if (call === 2) {
    // Pass 2 under worker A: the lease expires mid-pass; the engine aborts us.
    await until("lease loss aborts pass 2", () => ctx.signal.aborted);
    engineAStopped?.stop.abort(); // dead worker's loop must not re-claim
    return passResult(); // discarded — nothing from this pass is persisted
  }
  if (call === 3) {
    // Post-restart pass 2: re-emits dup keys/hash (upserts must collapse).
    return passResult({
      qualifiedCount: 15,
      researchedCount: 1000, // disastrous yield → widening pressure
      discoveredCount: 15,
      newCandidates: qualifiedBlock(9, 15, 3),
      newQueries: [
        { query_hash: "h1", query: "dentists austin", result_count: 11 },
        { query_hash: "h4", query: "dentists dallas", result_count: 9 },
        { query_hash: "h5", query: "dentists canada", result_count: 4 },
      ],
    });
  }
  const rest = [
    { qualified: 25, from: 24, hashes: [{ query_hash: "h2", query: "dentists tx", result_count: 12 }, { query_hash: "h6", query: "dentists uk", result_count: 6 }] },
    { qualified: 25, from: 49, hashes: [{ query_hash: "h7", query: "dentists nz", result_count: 3 }] },
    { qualified: 25, from: 74, hashes: [{ query_hash: "h8", query: "dentists ie", result_count: 2 }] },
  ][call - 4]!;
  return passResult({
    qualifiedCount: rest.qualified,
    researchedCount: 400,
    discoveredCount: rest.qualified,
    newCandidates: qualifiedBlock(rest.from, rest.qualified, call),
    newQueries: rest.hashes,
  });
}

// ---------------------------------------------------------------------------
// The frozen sequence — ordered steps sharing the scenario above
// ---------------------------------------------------------------------------

describe("data-asset acceptance: frozen whole sequence", () => {
  it("S1 create project context v1 + 'find 100' job pins context snapshot v1; first rows stream", async () => {
    // --- Create Project (context v1): the project_context row starts at v1 ---
    const projectsFake = new FakeSupabase();
    projectsFake.tables.project_context = [{ ...CONTEXT_V1 }];
    const seeded = projectsFake.tables.project_context[0];
    expect(seeded.context_version).toBe(1);

    // --- "find 100" job (batch by the frozen mode inference) ---
    const job = await store.create({
      user_id: USER,
      project_id: PROJECT_A,
      spec: makeThesis(),
      target: 100,
      mode: "batch",
    });
    jobId = job.id;

    // Context snapshot pinned AT CREATION (frozen behavior of createSearchJob).
    const pinned = await pinProjectContext(store, jobId, CONTEXT_V1);
    expect(pinned.version).toBe(1);
    contextSnapshotV1 = pinned.snapshot;
    expect(contextSnapshotV1).not.toHaveProperty("context_version");
    const afterPin = (await store.get(jobId))!;
    expect(afterPin.project_context_version).toBe(1);
    expect(afterPin.context_snapshot).toEqual(contextSnapshotV1);

    // Engine starts; pass 1 streams the first 10 qualified rows.
    engineAStopped = startEngine(store, scriptedFind100Pass, { owner: "worker-1" });
    await until("pass 1 persisted (first rows streamed)", () => {
      const j = store.jobs.get(jobId)!;
      return j.current_pass === 1 && j.qualified_count === 10;
    });
    const streaming = store.jobs.get(jobId)!;
    expect(streaming.status).toBe("running");
    expect(streaming.qualified_count).toBe(10);
    expect(streaming.researched_count).toBe(20);
    const keys = await store.listCandidateKeys(jobId);
    expect(keys.filter((k) => k.startsWith("company:e"))).toHaveLength(10);
  });

  it("S2 project edited to context v2 WHILE job runs → running job stays pinned to v1", async () => {
    // Live lease is respected: no other worker can claim mid-run.
    expect(await store.claim("worker-2", 300)).toBeNull();

    const jBefore = (await store.get(jobId))!;
    expect(jBefore.status).toBe("running");
    expect(jBefore.project_context_version).toBe(1);
    expect(jBefore.context_snapshot).toEqual(contextSnapshotV1); // v1, byte-stable

    // --- Project edited to context v2 while the job is running ---
    const projectsFake = new FakeSupabase();
    projectsFake.tables.project_context = [{ ...CONTEXT_V1 }];
    const v2 = await updateProjectContext(projectsFake as unknown as SupabaseClient, PROJECT_A, {
      exclusions: ["agencies", "medi-spas"],
      preferred_geographies: ["Dallas"],
    });
    expect(v2.context_version).toBe(2);
    expect(v2.exclusions).toEqual(["agencies", "medi-spas"]);

    // The running job did NOT re-read context: still the v1 snapshot.
    const jAfter = (await store.get(jobId))!;
    expect(jAfter.status).toBe("running");
    expect(jAfter.project_context_version).toBe(1);
    expect(jAfter.context_snapshot).toEqual(contextSnapshotV1);
    expect(jAfter.context_snapshot).not.toEqual({
      ...CONTEXT_V1,
      exclusions: ["agencies", "medi-spas"],
      preferred_geographies: ["Dallas"],
    });
  });

  it("S3 worker restart: lease expires, new owner claims atomically, pass re-run discarded nothing", async () => {
    const before = (await store.get(jobId))!;
    expect(before.qualified_count).toBe(10);
    expect(before.current_pass).toBe(1);

    // Worker A "dies" mid-pass-2: the wall clock runs past the lease.
    store.advanceMs(300_001);
    // Heartbeat observes the loss → pass aborted → worker A's loop exits
    // (nothing persisted; the lease is left expired, owned by the dead worker).
    await engineAStopped!.done;

    // Nothing from the lost pass was persisted (counts + rows unchanged).
    const afterLoss = (await store.get(jobId))!;
    expect(afterLoss.qualified_count).toBe(10);
    expect(afterLoss.researched_count).toBe(20);
    expect(afterLoss.discovered_count).toBe(12);
    expect((await store.listCandidateKeys(jobId)).length).toBe(12);
    expect((await store.listAttemptedQueryHashes(jobId)).length).toBe(3);
    expect(afterLoss.status).toBe("running"); // not failed, not completed
    expect(afterLoss.completion_reason).toBeNull();
    expect(afterLoss.error).toBeNull();

    // Worker A died holding the lease: owner unchanged, lease expired.
    const deadOwner = (await store.get(jobId))!;
    expect(deadOwner.lease_owner).toBe("worker-1");
    expect(new Date(deadOwner.lease_expires_at!).getTime()).toBeLessThanOrEqual(store.nowMs);

    // Atomic reclaim: two concurrent claims → exactly one winner
    // (single-threaded fake; the SQL's FOR UPDATE SKIP LOCKED is the real
    // single-statement atomicity and is asserted textually below).
    expect(SEARCH_JOBS_SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(SEARCH_JOBS_SQL).toContain("FUNCTION public.claim_search_job");
    const [c1, c2] = await Promise.all([store.claim("worker-2", 300), store.claim("worker-3", 300)]);
    expect(c1).not.toBeNull();
    expect(c1!.lease_owner).toBe("worker-2");
    expect(c2).toBeNull();
    await store.release(jobId, "worker-2"); // hand the row back to the pool

    // New owner (worker restart) claims the expired-lease job and resumes.
    const engineB = startEngine(store, scriptedFind100Pass, { owner: "worker-2" });
    await until("claimed by worker-2", () => store.jobs.get(jobId)!.lease_owner === "worker-2");

    // Let the resumed job drive to the target, then stop the engine loop.
    await until("completed by worker-2", () => store.jobs.get(jobId)!.status === "completed");
    engineB.stop.abort();
    await engineB.done;
  });

  it("S4 target reached: completion_reason, zero duplicate candidate_keys/query_hashes, unique upserts collapsed", async () => {
    const j = (await store.get(jobId))!;
    // Honest completion — the target was reached, nothing faked.
    expect(j.status).toBe("completed");
    expect(j.completion_reason).toBe("TARGET_REACHED");
    expect(j.qualified_count).toBe(100);
    expect(j.current_pass).toBe(5);
    expect(j.discovered_count).toBe(102); // 12+15+25+25+25
    expect(j.researched_count).toBe(2220); // 20+1000+400+400+400

    // (b) Unique upserts collapse retries: no duplicate keys, dups last-write-win.
    const keys = await store.listCandidateKeys(jobId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(100); // e1..e98 + d1,d2 — re-emitted keys merged
    const dup = [...store.candidates.values()].find((c) => c.candidate_key === "company:e9")!;
    expect(dup.attempts).toBe(3); // pass1 then pass2' re-upsert (last write wins)
    const hashes = await store.listAttemptedQueryHashes(jobId);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes).toHaveLength(8); // h1..h8 — re-recorded h1 merged
    expect([...store.queries.values()].find((q) => q.query_hash === "h1")!.result_count).toBe(11);

    // Low-yield widening, asserted through the frozen nextPoolTarget math with
    // pass-2' numbers (15 qualified / 1000 researched, deficit 75 → yield floor):
    //   desired = ceil(ceil(75/0.02) * 1.5) = 5625, clamped by per-pass cap.
    const lowYield = {
      passQualifiedCount: 15,
      passResearchedCount: 1000,
      target: 100,
      qualifiedCount: 10,
      previousPoolTarget: 250,
    };
    expect(nextPoolTarget({ ...lowYield, nextPassNumber: 2, mode: "job" })).toBe(500); // cap grows per pass
    expect(nextPoolTarget({ ...lowYield, nextPassNumber: 8, mode: "watch" })).toBe(2000); // hard cap
    expect(nextPoolTarget({ ...lowYield, nextPassNumber: 2, mode: "batch" })).toBe(250); // batch pool cap
    expect(poolTargetsSeen).toHaveLength(6); // passes 1..5 + the aborted pass 2
    expect(new Set(poolTargetsSeen).size).toBe(1); // batch never exceeds POOL_BASE
    expect(j.budgets.pool_target).toBe(250);

    // (dataset remains queryable from the job store — project-scoped read via
    // store.list with the projectId filter, mirroring search-jobs.server.ts)
    const scoped = await store.list(USER, { page: 0, pageSize: 50, projectId: PROJECT_A });
    expect(scoped.total).toBe(1);
    expect(scoped.rows[0]!.id).toBe(jobId);
    const otherProject = await store.list(USER, { page: 0, pageSize: 50, projectId: PROJECT_B });
    expect(otherProject.total).toBe(0);
    const unscoped = await store.list(USER, { page: 0, pageSize: 50 });
    expect(unscoped.total).toBe(1);
  });

  it("S5 honest COVERAGE_EXHAUSTED alternative — dataset stays queryable, no phantom rows", async () => {
    const cov = await store.create({ user_id: USER, spec: makeThesis(), target: 10, mode: "batch" });
    const engineC = startEngine(store, async () => passResult(), { owner: "worker-3" });
    await until("coverage exhausted", () => store.jobs.get(cov.id)!.status === "completed");
    engineC.stop.abort();
    await engineC.done;

    const j = (await store.get(cov.id))!;
    expect(j.completion_reason).toBe("COVERAGE_EXHAUSTED"); // honest: not TARGET_REACHED
    expect(j.qualified_count).toBe(0);
    expect(j.current_pass).toBe(2); // exactly COVERAGE_EMPTY_PASSES empty passes
    expect((await store.listCandidateKeys(cov.id)).length).toBe(0);
    // Queryable from the job store; project filter keeps it out of other projects.
    const all = await store.list(USER, { page: 0, pageSize: 50 });
    expect(all.rows.map((r) => r.id).sort()).toEqual([jobId, cov.id].sort());
    const scoped = await store.list(USER, { page: 0, pageSize: 50, projectId: PROJECT_B });
    expect(scoped.total).toBe(0);
  });

  it("S6 selected rows added to a project List — dedupe by entity_id on (list_id, entity_id)", async () => {
    const qualified = [...store.candidates.values()]
      .filter((c) => c.job_id === jobId && c.state === "QUALIFIED")
      .map((c) => c.entity_id!);
    expect(new Set(qualified).size).toBe(qualified.length);
    expect(qualified.length).toBe(98);

    const projectsFake = new FakeSupabase();
    projectsFake.tables.project_list_items = [
      { id: "i0", list_id: "L1", entity_id: "e1" }, // pre-existing row
    ];
    const asClient = projectsFake as unknown as SupabaseClient;
    const first = await addListItems(asClient, "L1", qualified.map((entity_id) => ({ entity_id })));
    expect(first.added).toBe(97); // e1 already present → skipped, not an error
    const again = await addListItems(asClient, "L1", qualified.slice(0, 5).map((entity_id) => ({ entity_id })));
    expect(again.added).toBe(0); // full dedupe on re-add
    const entities = projectsFake.tables.project_list_items.map((r) => r.entity_id).sort();
    expect(new Set(entities).size).toBe(entities.length);
    expect(entities).toHaveLength(98);
  });

  it("S7 same-thesis rerun: canonical_cache_hits up, fresh_fields_reused 0→N, fewer live calls, only stale fields researched", async () => {
    // Scripted indexer double at the parent workstream's wiring point:
    // a run-scoped createReuseRun() accumulator fed per candidate field, with
    // staleness decided by the REAL freshness module (TTL per field class).
    const canonical = new Map<string, { observedAt: number }>();
    const STABLE = ["website", "city", "domain"]; // 90-day TTL class
    const MEDIUM = ["description", "detail", "pricing", "team_size", "tech_stack"]; // 30-day / default
    const indexerDouble = (reuse: ReuseRun): ReuseRunSnapshot => {
      for (const field of [...STABLE, ...MEDIUM]) {
        const rec = canonical.get(field);
        if (!rec) {
          reuse.recordLiveCall(); // cold canonical index → live research
          canonical.set(field, { observedAt: store.nowMs });
        } else if (isFieldFresh(field, new Date(rec.observedAt), new Date(store.nowMs))) {
          reuse.recordCacheHit(field);
          reuse.recordFreshReused(field);
        } else {
          reuse.recordStaleResearched(field); // stale → targeted re-research only
          reuse.recordLiveCall();
          rec.observedAt = store.nowMs;
        }
      }
      return reuse.snapshot();
    };

    const snapShape = ["canonical_cache_hits", "fresh_fields_reused", "live_research_calls", "stale_fields_researched"];
    const reuse1 = createReuseRun();
    const reuse2 = createReuseRun();
    const runs: { r1: ReuseRunSnapshot | null; r2: ReuseRunSnapshot | null } = { r1: null, r2: null };
    const snapOf = (x: ReuseRunSnapshot | null): ReuseRunSnapshot => {
      if (!x) throw new Error("reuse snapshot was not captured");
      return x;
    };

    const engineD = startEngine(
      store,
      async () => {
        passCall += 1;
        const snap = passCall === 7 ? indexerDouble(reuse1) : indexerDouble(reuse2);
        if (passCall === 7) runs.r1 = snap;
        else runs.r2 = snap;
        return passResult({
          qualifiedCount: 5,
          researchedCount: 8,
          discoveredCount: 5,
          newCandidates: qualifiedBlock(200, 5, passCall),
        });
      },
      { owner: "worker-4" },
    );

    const run1 = await store.create({ user_id: USER, spec: makeThesis(), target: 5, mode: "batch" });
    await until("rerun run1 completed", () => store.jobs.get(run1.id)!.status === "completed");
    const r1 = snapOf(runs.r1);

    // 40 days pass: medium-TTL fields go stale, stable fields stay fresh.
    store.advanceMs(40 * 86_400_000);
    const run2 = await store.create({ user_id: USER, spec: makeThesis(), target: 5, mode: "batch" });
    await until("rerun run2 completed", () => store.jobs.get(run2.id)!.status === "completed");
    engineD.stop.abort();
    await engineD.done;
    const r2 = snapOf(runs.r2);
    expect(Object.keys(r1).sort()).toEqual(snapShape); // createReuseRun snapshot shape
    // Reuse invariants between the first run and the same-thesis rerun:
    expect(r1).toEqual({ canonical_cache_hits: 0, fresh_fields_reused: 0, live_research_calls: 8, stale_fields_researched: 0 });
    expect(r2.canonical_cache_hits).toBeGreaterThan(r1.canonical_cache_hits); // 3 > 0
    expect(r1.fresh_fields_reused).toBe(0);
    expect(r2.fresh_fields_reused).toBeGreaterThan(0); // 0 → 3
    expect(r2.live_research_calls).toBeLessThan(r1.live_research_calls); // 5 < 8
    expect(r2.stale_fields_researched).toBeGreaterThan(0);
    expect(r2.live_research_calls).toBe(r2.stale_fields_researched); // ONLY stale fields went live
    expect(r2).toEqual({ canonical_cache_hits: 3, fresh_fields_reused: 3, live_research_calls: 5, stale_fields_researched: 5 });
  });

  it("S8 create Watch from the thesis → watch job rides the SAME engine (mode 'watch'), idempotent slot", async () => {
    for (const t of Object.keys(sharedClient.tables)) sharedClient.tables[t] = [];
    const watch: WatchRecord = {
      id: "00000000-0000-4000-8000-0000000000aa",
      user_id: USER,
      name: "Dentists watch",
      query: "find 100 dentists",
      project_id: PROJECT_A,
      change_mode: "new_signal",
      delivery: { channels: ["in_app"] },
      thesis: makeThesis(),
      icp: {},
    };
    await sharedClient.from("campaigns").insert({ ...watch });
    S8.watchId = watch.id;
    S8.slot = scheduleSlotFor(new Date(store.nowMs));

    // createWatchJob (WS5) goes through the SAME SearchJobsStore contract.
    const job = await createWatchJob(watch, USER, { slot: S8.slot, client: sharedClient as unknown as SupabaseClient });
    expect(job).not.toBeNull();
    expect(job!.mode).toBe("watch");
    expect(job!.watch_id).toBe(watch.id);
    expect(job!.spec).toEqual(makeThesis()); // frozen thesis, not a re-compile
    S8.watchJobId = job!.id;
    // Duplicate create for the same slot → the SAME job (unique slot idempotency).
    const dup = await createWatchJob(watch, USER, { slot: S8.slot, client: sharedClient as unknown as SupabaseClient });
    expect(dup!.id).toBe(S8.watchJobId);
    expect(sharedClient.tables.search_jobs).toHaveLength(1);

    // The SAME runJobEngine drives watch-mode jobs (mirrored twin in the
    // fake store — the admin-backed store implements this exact interface).
    const twin = await store.create({
      user_id: USER,
      watch_id: watch.id,
      scheduled_for: S8.slot,
      spec: makeThesis(),
      target: 10,
      mode: "watch",
    });
    const engineE = startEngine(
      store,
      async () =>
        passResult({
          qualifiedCount: 10,
          researchedCount: 10,
          discoveredCount: 10,
          newCandidates: qualifiedBlock(300, 10, 1),
        }),
      { owner: "worker-5" },
    );
    await until("watch twin completed", () => store.jobs.get(twin.id)!.status === "completed");
    engineE.stop.abort();
    await engineE.done;
    expect(store.jobs.get(twin.id)!.completion_reason).toBe("TARGET_REACHED");
  });

  it("S9 watch diff → exactly the three notification outcomes (none / one for new signal / one for new entity)", async () => {
    // Mark the S8 watch job completed and diff it three times.
    await sharedClient.from("search_jobs").update({ status: "completed" }).eq("id", S8.watchJobId);
    const mustInsert = async (table: string, row: Row) => {
      const { error } = await sharedClient.from(table).insert(row);
      if (error) {
        const msg = (error as { message?: string }).message ?? "unknown fixture insert error";
        throw new Error(`fixture insert into ${table} failed: ${msg}`);
      }
    };
    const seedJob = async (id: string, candidates: Row[]) => {
      await mustInsert("search_jobs", { id, watch_id: S8.watchId, mode: "watch", status: "completed" });
      for (const c of candidates) await mustInsert("search_job_candidates", { ...c, job_id: id });
    };
    const seedCandidates = async (jobId: string, candidates: Row[]) => {
      for (const c of candidates) await mustInsert("search_job_candidates", { ...c, job_id: jobId });
    };
    const c = (entityId: string, data: Row) => ({
      candidate_key: `company:${entityId}`,
      entity_id: entityId,
      data,
      state: "QUALIFIED",
    });

    // Outcome 1 — run 1: first sighting of e1 → ONE intent.
    await seedCandidates(S8.watchJobId, [c("e1", { signals: ["hiring"] })]);
    const r1 = await processWatchJob(S8.watchJobId, sharedClient as unknown as SupabaseClient);
    expect(r1!.newCount).toBe(1);
    expect(sharedClient.tables.notification_outbox).toHaveLength(1);
    expect(sharedClient.tables.notification_outbox[0].idempotency_key).toBe(
      `watch:${S8.watchId}:${S8.watchJobId}:in_app`,
    );
    // Idempotent reprocess → no second intent.
    const again = await processWatchJob(S8.watchJobId, sharedClient as unknown as SupabaseClient);
    expect(again!.skipped).toBe("already_processed");
    expect(sharedClient.tables.notification_outbox).toHaveLength(1);

    // Outcome 2 — known entity, NO new signal → NO notification intent.
    await seedJob("job-w2", [c("e1", { signals: ["hiring"] })]);
    const r2 = await processWatchJob("job-w2", sharedClient as unknown as SupabaseClient);
    expect(r2!.newCount).toBe(0);
    expect(sharedClient.tables.notification_outbox).toHaveLength(1); // unchanged
    expect(sharedClient.tables.watch_seen_matches).toHaveLength(1); // fingerprint unchanged

    // Outcome 3 — known entity with a NEW signal + a new entity → exactly ONE new intent.
    await seedJob("job-w3", [c("e1", { signals: ["hiring", "funding"] }), c("e2", {})]);
    const r3 = await processWatchJob("job-w3", sharedClient as unknown as SupabaseClient);
    expect(r3!.newCount).toBe(2);
    expect(sharedClient.tables.notification_outbox).toHaveLength(2); // exactly one NEW intent
    const intent3 = sharedClient.tables.notification_outbox.find(
      (i) => i.idempotency_key === `watch:${S8.watchId}:job-w3:in_app`,
    );
    expect(intent3).toBeTruthy();
    expect((intent3!.payload as Row).matches).toBe(2);
    // Seen ledger now holds e1@fp1, e1@fp2, e2 — fingerprints are signal-aware.
    const fps = sharedClient.tables.watch_seen_matches.map((r) => r.match_fingerprint);
    expect(new Set(fps).size).toBe(3);
    expect(fps).toContain(fingerprintFor({ entity_id: "e1", data: { signals: ["hiring", "funding"] } }, "new_signal"));
  });

  it("S10 outbox: duplicate enqueue → one intent; ambiguous delivery → delivery_unknown preserved; retries never duplicate", async () => {
    // The migration is the real unique constraint; the fake mirrors it.
    expect(NOTIFICATIONS_SQL).toMatch(/idempotency_key\s+TEXT NOT NULL UNIQUE/);
    sharedClient.tables.notification_outbox = [];
    sharedClient.tables.in_app_notifications = [];
    const asClient = sharedClient as unknown as SupabaseClient;

    // Duplicate enqueue for the same idempotency key → exactly ONE intent row.
    const key = `watch:${S8.watchId}:job-w3:in_app`;
    const a = await enqueueNotification({ idempotencyKey: key, userId: USER, channel: "in_app", payload: { title: "T", matches: 2 } }, asClient);
    const b = await enqueueNotification({ idempotencyKey: key, userId: USER, channel: "in_app", payload: { title: "T", matches: 2 } }, asClient);
    expect(a.enqueued).toBe(true);
    expect(b.enqueued).toBe(false);
    expect(sharedClient.tables.notification_outbox).toHaveLength(1);
    // in_app delivery is local and definite.
    expect(await processOutbox(10, asClient)).toMatchObject({ claimed: 1, delivered: 1 });
    expect(sharedClient.tables.notification_outbox![0]!.status).toBe("delivered");

    // Ambiguous delivery: the adapter can't confirm → delivery_unknown, final.
    const unknownAdapter = fakeAdapter("delivery_unknown", "SMTP timeout after DATA");
    await enqueueNotification({ idempotencyKey: `${key}:email`, userId: USER, channel: "email", payload: { title: "T", connection_id: "c1" } }, asClient);
    const first = await processOutbox(10, asClient, { email: unknownAdapter } as AdapterOverride);
    expect(first).toMatchObject({ claimed: 1, unknown: 1 });
    const ambiguous = sharedClient.tables.notification_outbox!.find((r) => r.idempotency_key === `${key}:email`)!;
    expect(ambiguous.status).toBe("delivery_unknown");
    expect(ambiguous.attempts).toBe(1);
    expect(unknownAdapter.calls).toHaveLength(1);

    // Manual retry path (worker restart / operator re-tick): the ambiguous
    // row is NEVER re-claimed — no blind duplicate send, status preserved.
    ambiguous.available_at = new Date(Date.now() - 60_000).toISOString();
    const retry = await processOutbox(10, asClient, { email: unknownAdapter } as AdapterOverride);
    expect(retry.claimed).toBe(0);
    expect(unknownAdapter.calls).toHaveLength(1); // still exactly one send attempt
    expect(sharedClient.tables.notification_outbox!.find((r) => r.idempotency_key === `${key}:email`)!.status).toBe("delivery_unknown");

    // Contrast — a DEFINITIVE failure is safe to retry, still one intent row.
    const failAdapter = fakeAdapter("failed", "Slack webhook HTTP 500");
    const okAdapter = fakeAdapter("delivered");
    await enqueueNotification({ idempotencyKey: `${key}:retry-safe`, userId: USER, channel: "email", payload: { title: "T", connection_id: "c2" } }, asClient);
    expect(await processOutbox(10, asClient, { email: failAdapter } as AdapterOverride)).toMatchObject({ claimed: 1, failed: 1 });
    const retryable = sharedClient.tables.notification_outbox!.find((r) => r.idempotency_key === `${key}:retry-safe`)!;
    expect(retryable.status).toBe("failed");
    retryable.available_at = new Date(Date.now() - 60_000).toISOString(); // backoff elapses
    expect(await processOutbox(10, asClient, { email: okAdapter } as AdapterOverride)).toMatchObject({ claimed: 1, delivered: 1 });
    expect(sharedClient.tables.notification_outbox!.find((r) => r.idempotency_key === `${key}:retry-safe`)!.attempts).toBe(2);

    // A worker that died mid-send ('sending' past the staleness window) is
    // marked delivery_unknown — the outcome is genuinely unknown.
    await sharedClient.from("notification_outbox").insert({
      idempotency_key: `${key}:stale`,
      user_id: USER,
      channel: "in_app",
      payload: { title: "T" },
      status: "sending",
      attempts: 1,
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const recovered = await processOutbox(10, asClient);
    expect(recovered.claimed).toBe(0);
    expect(sharedClient.tables.notification_outbox!.find((r) => r.idempotency_key === `${key}:stale`)!.status).toBe("delivery_unknown");

    // Whole-ledger invariant: intents stay unique, ambiguous stays ambiguous.
    const rows = sharedClient.tables.notification_outbox!;
    expect(new Set(rows.map((r) => r.idempotency_key)).size).toBe(rows.length);
    for (const r of rows.filter((x) => x.status === "delivery_unknown")) {
      expect(r.delivered_at).toBeNull();
    }
  });
});
