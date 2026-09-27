/**
 * Durable Search Job store over the service-role admin client (Workstream 1).
 *
 * All writes go through the admin client — ownership is enforced at the
 * server-fn layer (every fn checks user_id === context.userId), never here.
 * Count bumps are read-modify-write, which is safe because only the current
 * lease owner ever writes counts for a job (single-writer invariant).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdmin } from "@/integrations/my-supabase/admin.server";
import {
  SearchJobConflictError,
  parseSearchJobRow,
  type CandidateUpsert,
  type CountDelta,
  type NewSearchJob,
  type QueryRecord,
  type SearchJobCompletionReason,
  type SearchJobPatch,
  type SearchJobRow,
  type SearchJobsStore,
  type SourceUpsert,
} from "./search-job.types";

const JOBS = "search_jobs";
const CANDIDATES = "search_job_candidates";
const QUERIES = "search_job_queries";
const SOURCES = "search_job_sources";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

function nowIso(): string {
  return new Date().toISOString();
}

function mapDbError(error: { code?: string; message?: string }): never {
  if (error.code === UNIQUE_VIOLATION) throw new SearchJobConflictError(error.message);
  throw new Error(`[search-jobs store] ${error.message ?? "unknown supabase error"}`);
}

interface RpcJobRow {
  [key: string]: unknown;
}

export function createSearchJobsStore(client: SupabaseClient): SearchJobsStore {
  return {
    async create(job: NewSearchJob): Promise<SearchJobRow> {
      const { data, error } = await client
        .from(JOBS)
        .insert({
          user_id: job.user_id,
          project_id: job.project_id ?? null,
          watch_id: job.watch_id ?? null,
          scheduled_for: job.scheduled_for ?? null,
          spec: job.spec,
          target: job.target,
          mode: job.mode,
        })
        .select("*")
        .single();
      if (error) mapDbError(error);
      return parseSearchJobRow(data);
    },

    async get(jobId: string): Promise<SearchJobRow | null> {
      const { data, error } = await client
        .from(JOBS)
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
      if (error) mapDbError(error);
      return data ? parseSearchJobRow(data) : null;
    },

    async list(
      userId,
      opts: { page: number; pageSize: number; projectId?: string | null },
    ): Promise<{ rows: SearchJobRow[]; total: number }> {
      const page = Math.max(0, opts.page);
      const pageSize = Math.min(50, Math.max(1, opts.pageSize));
      const from = page * pageSize;
      let query = client
        .from(JOBS)
        .select("*", { count: "exact" })
        .eq("user_id", userId);
      if (opts.projectId) query = query.eq("project_id", opts.projectId);
      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) mapDbError(error);
      return { rows: (data ?? []).map(parseSearchJobRow), total: count ?? 0 };
    },

    async update(jobId: string, patch: SearchJobPatch): Promise<SearchJobRow | null> {
      const { data, error } = await client
        .from(JOBS)
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", jobId)
        .select("*")
        .maybeSingle();
      if (error) mapDbError(error);
      return data ? parseSearchJobRow(data) : null;
    },

    async delete(jobId: string): Promise<void> {
      const { error } = await client.from(JOBS).delete().eq("id", jobId);
      if (error) mapDbError(error);
    },

    async upsertCandidate(jobId: string, candidate: CandidateUpsert): Promise<void> {
      const { error } = await client.from(CANDIDATES).upsert(
        {
          job_id: jobId,
          candidate_key: candidate.candidate_key,
          entity_id: candidate.entity_id ?? null,
          state: candidate.state ?? "DISCOVERED",
          priority: candidate.priority ?? 0,
          attempts: candidate.attempts ?? 0,
          data: candidate.data ?? {},
        },
        { onConflict: "job_id,candidate_key" },
      );
      if (error) mapDbError(error);
    },

    async recordQuery(jobId: string, query: QueryRecord): Promise<void> {
      const { error } = await client.from(QUERIES).upsert(
        {
          job_id: jobId,
          query_hash: query.query_hash,
          query: query.query,
          source_family: query.source_family ?? null,
          result_count: query.result_count ?? 0,
          attempted_at: nowIso(),
        },
        { onConflict: "job_id,query_hash" },
      );
      if (error) mapDbError(error);
    },

    async upsertSource(jobId: string, source: SourceUpsert): Promise<void> {
      const { error } = await client.from(SOURCES).upsert(
        {
          job_id: jobId,
          source: source.source,
          cursor: source.cursor ?? {},
          status: source.status ?? null,
          exhausted: source.exhausted ?? false,
          metrics: source.metrics ?? {},
        },
        { onConflict: "job_id,source" },
      );
      if (error) mapDbError(error);
    },

    async bumpCounts(jobId: string, delta: CountDelta): Promise<void> {
      const current = await this.get(jobId);
      if (!current) return; // job vanished mid-pass — nothing to bump
      const { error } = await client
        .from(JOBS)
        .update({
          discovered_count: current.discovered_count + (delta.discovered ?? 0),
          researched_count: current.researched_count + (delta.researched ?? 0),
          qualified_count: current.qualified_count + (delta.qualified ?? 0),
          updated_at: nowIso(),
        })
        .eq("id", jobId);
      if (error) mapDbError(error);
    },

    async setDesiredPause(jobId: string): Promise<void> {
      await this.update(jobId, { pause_requested_at: nowIso() });
    },

    async setDesiredStop(jobId: string): Promise<void> {
      await this.update(jobId, { stop_requested_at: nowIso() });
    },

    async clearDesired(jobId: string): Promise<void> {
      await this.update(jobId, { pause_requested_at: null, stop_requested_at: null });
    },

    async completeJob(jobId: string, reason: SearchJobCompletionReason): Promise<void> {
      const status = reason === "USER_STOPPED" ? "stopped" : "completed";
      const row = await this.update(jobId, { status, completion_reason: reason });
      if (!row) throw new Error(`[search-jobs store] completeJob: job ${jobId} not found`);
    },

    async failJob(jobId: string, error: string): Promise<void> {
      await this.update(jobId, {
        status: "failed",
        completion_reason: "FAILED",
        error: error.slice(0, 4000),
      });
    },

    async claim(owner: string, leaseSeconds: number): Promise<SearchJobRow | null> {
      const { data, error } = await client.rpc("claim_search_job", {
        p_owner: owner,
        p_lease_seconds: leaseSeconds,
      });
      if (error) mapDbError(error);
      const rows = (data ?? []) as RpcJobRow[];
      return rows.length ? parseSearchJobRow(rows[0]) : null;
    },

    async heartbeat(jobId: string, owner: string): Promise<boolean> {
      const { data, error } = await client.rpc("heartbeat_search_job", {
        p_job_id: jobId,
        p_owner: owner,
      });
      if (error) mapDbError(error);
      return data === true;
    },

    async release(jobId: string, owner: string): Promise<void> {
      const { error } = await client.rpc("release_search_job", {
        p_job_id: jobId,
        p_owner: owner,
      });
      if (error) mapDbError(error);
    },

    async listAttemptedQueryHashes(jobId: string): Promise<string[]> {
      const { data, error } = await client
        .from(QUERIES)
        .select("query_hash")
        .eq("job_id", jobId);
      if (error) mapDbError(error);
      return (data ?? []).map((r: { query_hash: string }) => r.query_hash);
    },

    async listCandidateKeys(jobId: string): Promise<string[]> {
      const { data, error } = await client
        .from(CANDIDATES)
        .select("candidate_key")
        .eq("job_id", jobId);
      if (error) mapDbError(error);
      return (data ?? []).map((r: { candidate_key: string }) => r.candidate_key);
    },
  };
}

let _store: SearchJobsStore | undefined;

/** Singleton store bound to the service-role admin client. */
export function getSearchJobsStore(): SearchJobsStore {
  if (!_store) _store = createSearchJobsStore(getAdmin());
  return _store;
}
