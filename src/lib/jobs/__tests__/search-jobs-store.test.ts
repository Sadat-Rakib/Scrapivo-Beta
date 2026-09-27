/**
 * Store tests (Workstream 1) — offline via a minimal thenable fake of the
 * supabase-js query builder, including unique-violation simulation so the
 * 23505 → SearchJobConflictError mapping is exercised for real.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSearchJobsStore } from "../search-jobs.server";
import { SearchJobConflictError } from "../search-job.types";
import type { NewSearchJob } from "../search-job.types";

const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20260927000000_search_jobs.sql", import.meta.url)),
  "utf8",
);

// ---------------------------------------------------------------------------
// Minimal supabase-js fake (thenable builder)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface PendingQuery {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | null;
  values: Row[] | null;
  onConflict: string | null;
  filters: Array<[string, unknown]>;
  orderCol: string | null;
  orderAsc: boolean;
  range: [number, number] | null;
  want: "none" | "single" | "maybeSingle";
  wantCount: boolean;
}

/** Unique keys mirroring the migration (partial = only when all cols non-null). */
const UNIQUE_KEYS: Record<string, string[]> = {
  search_jobs: ["watch_id+scheduled_for"],
  search_job_candidates: ["job_id+candidate_key"],
  search_job_queries: ["job_id+query_hash"],
  search_job_sources: ["job_id+source"],
};

interface QueryResult {
  data: unknown;
  error: unknown;
  count?: number;
}

class Builder {
  q: PendingQuery;
  constructor(
    private client: FakeSupabase,
    table: string,
  ) {
    this.q = {
      table,
      op: "select",
      values: null,
      onConflict: null,
      filters: [],
      orderCol: null,
      orderAsc: true,
      range: null,
      want: "none",
      wantCount: false,
    };
  }
  select(_cols?: string, opts?: { count?: string }) {
    // NOTE: never resets op — in supabase-js .select() after .insert()/.update()
    // keeps the mutation and just requests rows back.
    this.q.wantCount = opts?.count === "exact";
    return this;
  }
  insert(values: Row | Row[]) {
    this.q.op = "insert";
    this.q.values = Array.isArray(values) ? values : [values];
    return this;
  }
  update(values: Row) {
    this.q.op = "update";
    this.q.values = [values];
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.q.op = "upsert";
    this.q.values = Array.isArray(values) ? values : [values];
    this.q.onConflict = opts?.onConflict ?? null;
    return this;
  }
  delete() {
    this.q.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.q.filters.push([col, val]);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.q.orderCol = col;
    this.q.orderAsc = opts?.ascending ?? true;
    return this;
  }
  range(from: number, to: number) {
    this.q.range = [from, to];
    return this;
  }
  single() {
    this.q.want = "single";
    return this;
  }
  maybeSingle() {
    this.q.want = "maybeSingle";
    return this;
  }

  private exec(): QueryResult {
    const client = this.client;
    const rows = client.tables[this.q.table] ?? (client.tables[this.q.table] = []);
    const matches = () =>
      rows.filter((r) => this.q.filters.every(([c, v]) => r[c] === v));
    const now = new Date().toISOString();

    if (this.q.op === "insert" || this.q.op === "upsert") {
      const results: Row[] = [];
      for (const value of this.q.values ?? []) {
        // Mimic DB column defaults: gen_random_uuid() pk, timestamps, and the
        // search_jobs column defaults (status/counters/lease fields).
        const colDefaults: Row =
          this.q.table === "search_jobs" ? jobColumnDefaults() : {};
        const stamped: Row = {
          id: this.client.nextUuid(),
          ...colDefaults,
          ...value,
          created_at: now,
          updated_at: now,
        };
        if (this.q.op === "upsert" && this.q.onConflict) {
          const cols = this.q.onConflict.split(",");
          const idx = rows.findIndex((r) => cols.every((c) => r[c] === stamped[c]));
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...stamped, updated_at: now };
            results.push(rows[idx]);
            continue;
          }
          rows.push(stamped);
          results.push(stamped);
          continue;
        }
        // Plain insert: simulate unique violations.
        const clash = (UNIQUE_KEYS[this.q.table] ?? []).some((uk) => {
          const cols = uk.split("+");
          if (!cols.every((c) => stamped[c] !== undefined && stamped[c] !== null)) return false;
          return rows.some((r) => cols.every((c) => r[c] === stamped[c]));
        });
        if (clash) {
          return {
            data: null,
            error: { code: "23505", message: `duplicate key value violates unique constraint on ${this.q.table}` },
          };
        }
        rows.push(stamped);
        results.push(stamped);
      }
      if (this.q.want === "single") {
        return results.length
          ? { data: results[results.length - 1], error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } };
      }
      return { data: results, error: null };
    }

    if (this.q.op === "update") {
      const patched = matches();
      for (const row of patched) Object.assign(row, this.q.values?.[0], { updated_at: now });
      return this.finish(patched);
    }
    if (this.q.op === "delete") {
      const doomed = matches();
      for (const row of doomed) rows.splice(rows.indexOf(row), 1);
      return this.finish(doomed);
    }

    // select
    let out = matches();
    const matchedCount = out.length;
    if (this.q.orderCol) {
      out = [...out].sort((a, b) => {
        const av = String(a[this.q.orderCol as string] ?? "");
        const bv = String(b[this.q.orderCol as string] ?? "");
        return this.q.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.q.range) out = out.slice(this.q.range[0], this.q.range[1] + 1);
    return this.finish(out, matchedCount);
  }

  private finish(rows: Row[], matchedCount = rows.length): QueryResult {
    if (this.q.want === "single") {
      return rows.length
        ? { data: rows[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    if (this.q.want === "maybeSingle") {
      return { data: rows[0] ?? null, error: null };
    }
    return {
      data: rows,
      error: null,
      count: this.q.wantCount ? matchedCount : undefined,
    };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: (v: QueryResult) => TResult1 | PromiseLike<TResult1>,
    onRejected?: (e: unknown) => TResult2 | PromiseLike<TResult2>,
  ) {
    return Promise.resolve().then(() => this.exec()).then(onFulfilled, onRejected);
  }
}

/** Deterministic valid uuid (DB default gen_random_uuid() stand-in). */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

class FakeSupabase {
  tables: Record<string, Row[]> = {
    search_jobs: [],
    search_job_candidates: [],
    search_job_queries: [],
    search_job_sources: [],
  };
  rpcLog: Record<string, Array<Record<string, unknown>>> = {};
  rpcImpl: Record<string, (params: Record<string, unknown>) => unknown> = {};
  private seq = 0;

  from(table: string): Builder {
    return new Builder(this, table);
  }
  async rpc(name: string, params: Record<string, unknown>) {
    if (!this.rpcLog[name]) this.rpcLog[name] = [];
    this.rpcLog[name].push(params);
    const impl = this.rpcImpl[name];
    return { data: impl ? impl(params) : null, error: null };
  }
  nextUuid(): string {
    this.seq += 1;
    return uuid(this.seq);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPEC: NewSearchJob["spec"] = {
  entity: "company",
  criteria: [{ field: "industry", value: "dentist", stated: true, confidence: 1 }],
  missing: [],
  signal_required: false,
  signal_types: [],
  signal_recency: null,
  status: "ready_to_search",
  raw_query: "dentists in Pune",
};

const USER_1 = uuid(1);
const USER_2 = uuid(2);

function newJobValue(over: Partial<NewSearchJob> = {}): NewSearchJob {
  return {
    user_id: USER_1,
    spec: SPEC,
    target: 10,
    mode: "job",
    ...over,
  };
}

/** search_jobs column defaults a real INSERT would receive from the DB. */
function jobColumnDefaults(): Row {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = fullJobRow();
  return rest;
}

/** Complete, zod-valid search_jobs row for raw table seeding. */
function fullJobRow(over: Row = {}): Row {
  return {
    id: uuid(0),
    user_id: USER_1,
    project_id: null,
    watch_id: null,
    scheduled_for: null,
    spec: SPEC,
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function makeStore() {
  const client = new FakeSupabase();
  return { client, store: createSearchJobsStore(client as unknown as SupabaseClient) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("search-jobs store", () => {
  it("9. create maps unique violation (duplicate watch slot) to SearchJobConflictError", async () => {
    const { store } = makeStore();
    const slot = { watch_id: uuid(501), scheduled_for: "2026-09-27T00:00:00.000Z" };
    const first = await store.create(newJobValue(slot));
    expect(first.watch_id).toBe(uuid(501));
    await expect(store.create(newJobValue(slot))).rejects.toBeInstanceOf(SearchJobConflictError);
    // The DB-level guarantee this mapping rides on:
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_search_jobs_watch_sched[\s\S]*?WHERE watch_id IS NOT NULL AND scheduled_for IS NOT NULL;/,
    );
  });

  it("8. upsertCandidate dedupes on (job_id, candidate_key) — ON CONFLICT DO UPDATE", async () => {
    const { client, store } = makeStore();
    const job = await store.create(newJobValue());
    await store.upsertCandidate(job.id, { candidate_key: "k1", state: "DISCOVERED", attempts: 1 });
    await store.upsertCandidate(job.id, {
      candidate_key: "k1",
      state: "RESEARCHED",
      attempts: 2,
      priority: 5,
    });
    expect(client.tables.search_job_candidates).toHaveLength(1);
    expect(client.tables.search_job_candidates[0]).toMatchObject({
      candidate_key: "k1",
      attempts: 2,
      state: "RESEARCHED",
      priority: 5,
    });
    expect(await store.listCandidateKeys(job.id)).toEqual(["k1"]);
  });

  it("recordQuery dedupes on (job_id, query_hash)", async () => {
    const { client, store } = makeStore();
    const job = await store.create(newJobValue());
    await store.recordQuery(job.id, { query_hash: "h1", query: "q", result_count: 3 });
    await store.recordQuery(job.id, { query_hash: "h1", query: "q", result_count: 9 });
    expect(client.tables.search_job_queries).toHaveLength(1);
    expect(client.tables.search_job_queries[0]).toMatchObject({ result_count: 9 });
    expect(await store.listAttemptedQueryHashes(job.id)).toEqual(["h1"]);
  });

  it("bumpCounts increments from current values", async () => {
    const { store } = makeStore();
    const job = await store.create(newJobValue());
    await store.bumpCounts(job.id, { discovered: 5, researched: 3, qualified: 1 });
    await store.bumpCounts(job.id, { qualified: 2 });
    const after = await store.get(job.id);
    expect(after).toMatchObject({ discovered_count: 5, researched_count: 3, qualified_count: 3 });
  });

  it("list filters by user, pages, and clamps pageSize to 50", async () => {
    const { client, store } = makeStore();
    for (let i = 0; i < 55; i++) {
      client.tables.search_jobs.push(
        fullJobRow({
          id: uuid(100 + i),
          user_id: USER_1,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      client.tables.search_jobs.push(fullJobRow({ id: uuid(200 + i), user_id: USER_2 }));
    }
    const page0 = await store.list(USER_1, { page: 0, pageSize: 100 });
    expect(page0.total).toBe(55);
    expect(page0.rows).toHaveLength(50); // clamped
    const page1 = await store.list(USER_1, { page: 1, pageSize: 50 });
    expect(page1.rows).toHaveLength(5);
    expect(page0.rows.every((r) => r.user_id === USER_1)).toBe(true);
  });

  it("claim/heartbeat/release delegate to the lease RPCs", async () => {
    const { client, store } = makeStore();
    const claimedRow = {
      id: uuid(901),
      user_id: USER_1,
      project_id: null,
      watch_id: null,
      scheduled_for: null,
      spec: SPEC,
      target: 10,
      mode: "job",
      status: "running",
      completion_reason: null,
      discovered_count: 0,
      researched_count: 0,
      qualified_count: 0,
      current_pass: 0,
      budgets: {},
      project_context_version: null,
      context_snapshot: null,
      lease_owner: "w1",
      lease_expires_at: "2026-09-27T01:00:00.000Z",
      heartbeat_at: "2026-09-27T00:00:00.000Z",
      pause_requested_at: null,
      stop_requested_at: null,
      error: null,
      created_at: "2026-09-27T00:00:00.000Z",
      updated_at: "2026-09-27T00:00:00.000Z",
    };
    client.rpcImpl["claim_search_job"] = ({ p_owner }) => [{ ...claimedRow, lease_owner: p_owner }];
    client.rpcImpl["heartbeat_search_job"] = () => false;
    const jobId = claimedRow.id as string;
    const claimed = await store.claim("w1", 300);
    expect(claimed).toMatchObject({ id: jobId, status: "running", lease_owner: "w1" });
    expect(client.rpcLog["claim_search_job"]).toEqual([{ p_owner: "w1", p_lease_seconds: 300 }]);
    await expect(store.heartbeat(jobId, "w1")).resolves.toBe(false);
    await store.release(jobId, "w1");
    expect(client.rpcLog["release_search_job"]).toEqual([{ p_job_id: jobId, p_owner: "w1" }]);
  });

  it("migration hardening: SECURITY DEFINER + search_path + owner-scoped heartbeat", () => {
    expect(MIGRATION_SQL).toMatch(/LANGUAGE sql\s*\n\s*SECURITY DEFINER\s*\n\s*SET search_path = public/);
    // Heartbeat only extends a live lease held by the same owner.
    expect(MIGRATION_SQL).toMatch(
      /WHERE id = p_job_id\s*\n\s*AND lease_owner = p_owner\s*\n\s*AND lease_expires_at > now\(\)/,
    );
    // Release is owner-scoped too.
    expect(MIGRATION_SQL).toMatch(/WHERE id = p_job_id\s*\n\s*AND lease_owner = p_owner;/);
    // Claim only picks queued/running with an absent or expired lease.
    expect(MIGRATION_SQL).toMatch(
      /WHERE status IN \('queued','running'\)\s*\n\s*AND \(lease_expires_at IS NULL OR lease_expires_at < now\(\)\)/,
    );
    expect(MIGRATION_SQL).toContain("GRANT EXECUTE ON FUNCTION public.claim_search_job(TEXT, INT) TO authenticated, service_role");
  });
});
