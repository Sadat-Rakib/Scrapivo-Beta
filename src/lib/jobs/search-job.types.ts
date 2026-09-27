/**
 * Durable Search Job engine — shared types (Workstream 1).
 *
 * NOTE: lives in search-job.types.ts (not types.ts) because src/lib/jobs/types.ts
 * already holds the job-board posting types — unrelated module, do not mix.
 *
 * Design is FROZEN: the engine orchestrates leasing/widening/stopping only.
 * It never qualifies — passRunner owns qualification gates.
 */
import { z } from "zod";
import type { SearchSpec } from "@/lib/search/search-spec";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SEARCH_JOB_MODES = ["interactive", "batch", "job", "watch"] as const;
export type SearchJobMode = (typeof SEARCH_JOB_MODES)[number];

export const SEARCH_JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "stopped",
  "completed",
  "failed",
] as const;
export type SearchJobStatus = (typeof SEARCH_JOB_STATUSES)[number];

export const SEARCH_JOB_COMPLETION_REASONS = [
  "TARGET_REACHED",
  "COVERAGE_EXHAUSTED",
  "BUDGET_EXHAUSTED",
  "USER_STOPPED",
  "FAILED",
] as const;
export type SearchJobCompletionReason = (typeof SEARCH_JOB_COMPLETION_REASONS)[number];

/** Terminal statuses — a stopped job is terminal and never resumable. */
export const TERMINAL_STATUSES: readonly SearchJobStatus[] = ["stopped", "completed", "failed"];

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Engine-persisted budget bookkeeping inside search_jobs.budgets jsonb. */
export interface SearchJobBudgets {
  /** Candidate pool size the next pass should draw from (widening math). */
  pool_target?: number;
  /** Total engine wall-time spent across passes, ms. */
  elapsed_ms?: number;
  [key: string]: unknown;
}

export interface SearchJobRow {
  id: string;
  user_id: string;
  project_id: string | null;
  watch_id: string | null;
  scheduled_for: string | null;
  spec: SearchSpec;
  target: number;
  mode: SearchJobMode;
  status: SearchJobStatus;
  completion_reason: SearchJobCompletionReason | null;
  discovered_count: number;
  researched_count: number;
  qualified_count: number;
  current_pass: number;
  budgets: SearchJobBudgets;
  project_context_version: number | null;
  context_snapshot: Record<string, unknown> | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  pause_requested_at: string | null;
  stop_requested_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchJobCandidateRow {
  id: string;
  job_id: string;
  candidate_key: string;
  entity_id: string | null;
  state: string;
  priority: number;
  attempts: number;
  data: Record<string, unknown>;
  discovered_at: string | null;
  researched_at: string | null;
  qualified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchJobQueryRow {
  id: string;
  job_id: string;
  query_hash: string;
  query: string;
  source_family: string | null;
  attempted_at: string;
  result_count: number;
  created_at: string;
  updated_at: string;
}

export interface SearchJobSourceRow {
  id: string;
  job_id: string;
  source: string;
  cursor: Record<string, unknown>;
  status: string | null;
  exhausted: boolean;
  metrics: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Zod — structural validation only; semantics stay with the passRunner.
// ---------------------------------------------------------------------------

export const SpecFieldZod = z.object({
  field: z.string().min(1).max(120),
  value: z.string().max(4000),
  stated: z.boolean(),
  confidence: z.number().min(0).max(1),
});

/** Structural SearchSpec validation (the TS interface has no zod of its own). */
export const SearchSpecZod = z
  .object({
    entity: z.enum(["person", "company", "business", "investor", "job", "unknown"]),
    criteria: z.array(SpecFieldZod).max(200),
    missing: z.array(z.string().max(120)).max(100),
    signal_required: z.boolean(),
    signal_types: z.array(z.string().max(120)).max(100),
    signal_recency: z.string().max(40).nullable(),
    status: z.enum(["needs_clarification", "ready_to_search", "searching", "complete"]),
    raw_query: z.string().max(8000),
  })
  .passthrough(); // understanding / locationSuggestion ride along untouched

const isoTimestamp = z.string().datetime({ offset: true }).nullable();

export const SearchJobRowZod = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  watch_id: z.string().uuid().nullable(),
  scheduled_for: isoTimestamp,
  spec: SearchSpecZod,
  target: z.number().int().min(1),
  mode: z.enum(SEARCH_JOB_MODES),
  status: z.enum(SEARCH_JOB_STATUSES),
  completion_reason: z.enum(SEARCH_JOB_COMPLETION_REASONS).nullable(),
  discovered_count: z.number().int().min(0),
  researched_count: z.number().int().min(0),
  qualified_count: z.number().int().min(0),
  current_pass: z.number().int().min(0),
  budgets: z.record(z.unknown()).default({}),
  project_context_version: z.number().int().nullable(),
  context_snapshot: z.record(z.unknown()).nullable(),
  lease_owner: z.string().nullable(),
  lease_expires_at: isoTimestamp,
  heartbeat_at: isoTimestamp,
  pause_requested_at: isoTimestamp,
  stop_requested_at: isoTimestamp,
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export function parseSearchJobRow(raw: unknown): SearchJobRow {
  return SearchJobRowZod.parse(raw) as SearchJobRow;
}

// ---------------------------------------------------------------------------
// Store interface — the engine and server fns program against THIS shape.
// Implementations: search-jobs.server.ts (Supabase admin) and test fakes.
// ---------------------------------------------------------------------------

export interface NewSearchJob {
  user_id: string;
  project_id?: string | null;
  watch_id?: string | null;
  scheduled_for?: string | null;
  spec: SearchSpec;
  target: number;
  mode: SearchJobMode;
}

export interface CandidateUpsert {
  candidate_key: string;
  entity_id?: string | null;
  state?: string;
  priority?: number;
  attempts?: number;
  data?: Record<string, unknown>;
}

export interface QueryRecord {
  query_hash: string;
  query: string;
  source_family?: string | null;
  result_count?: number;
}

export interface SourceUpsert {
  source: string;
  cursor?: Record<string, unknown>;
  status?: string | null;
  exhausted?: boolean;
  metrics?: Record<string, unknown>;
}

export interface CountDelta {
  discovered?: number;
  researched?: number;
  qualified?: number;
}

/**
 * Patch of engine/user-writable job columns. Deliberately excludes user_id,
 * spec, target, mode — those are fixed at creation.
 */
export interface SearchJobPatch {
  status?: SearchJobStatus;
  completion_reason?: SearchJobCompletionReason | null;
  current_pass?: number;
  budgets?: SearchJobBudgets;
  pause_requested_at?: string | null;
  stop_requested_at?: string | null;
  error?: string | null;
  project_context_version?: number | null;
  context_snapshot?: Record<string, unknown> | null;
}

export interface SearchJobsStore {
  /** Insert a job row. Throws SearchJobConflictError on unique violations. */
  create(job: NewSearchJob): Promise<SearchJobRow>;
  get(jobId: string): Promise<SearchJobRow | null>;
  list(
    userId: string,
    opts: { page: number; pageSize: number },
  ): Promise<{ rows: SearchJobRow[]; total: number }>;
  /** Validated partial update; stamps updated_at. */
  update(jobId: string, patch: SearchJobPatch): Promise<SearchJobRow | null>;
  delete(jobId: string): Promise<void>;

  /** ON CONFLICT (job_id, candidate_key) DO UPDATE state/priority/attempts/data. */
  upsertCandidate(jobId: string, candidate: CandidateUpsert): Promise<void>;
  /** ON CONFLICT (job_id, query_hash) DO UPDATE result_count/source_family. */
  recordQuery(jobId: string, query: QueryRecord): Promise<void>;
  /** ON CONFLICT (job_id, source) DO UPDATE cursor/status/exhausted/metrics. */
  upsertSource(jobId: string, source: SourceUpsert): Promise<void>;

  /** Atomically-visible count increments (single lease-owner writer). */
  bumpCounts(jobId: string, delta: CountDelta): Promise<void>;

  setDesiredPause(jobId: string): Promise<void>;
  setDesiredStop(jobId: string): Promise<void>;
  /** Clears pause_requested_at + stop_requested_at (resume path). */
  clearDesired(jobId: string): Promise<void>;

  /** Terminal transitions. USER_STOPPED → status 'stopped'; rest → 'completed'. */
  completeJob(jobId: string, reason: SearchJobCompletionReason): Promise<void>;
  failJob(jobId: string, error: string): Promise<void>;

  /** Atomic lease claim via claim_search_job RPC; null = nothing claimable. */
  claim(owner: string, leaseSeconds: number): Promise<SearchJobRow | null>;
  /** heartbeat_search_job RPC — false means ownership was lost. */
  heartbeat(jobId: string, owner: string): Promise<boolean>;
  /** release_search_job RPC (graceful pause). */
  release(jobId: string, owner: string): Promise<void>;

  /** Read side for passRunner context. */
  listAttemptedQueryHashes(jobId: string): Promise<string[]>;
  listCandidateKeys(jobId: string): Promise<string[]>;
}

/** Raised on unique-violation inserts (e.g. duplicate watch schedule slot). */
export class SearchJobConflictError extends Error {
  constructor(message = "search job conflicts with an existing unique row") {
    super(message);
    this.name = "SearchJobConflictError";
  }
}
