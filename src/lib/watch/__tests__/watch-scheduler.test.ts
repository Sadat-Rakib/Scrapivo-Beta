/**
 * Watch v2 scheduler tests (Workstream 5) — offline. The job store runs over a
 * fake supabase client (admin.server + worker mocked), so the 23505 →
 * SearchJobConflictError idempotency and the full diff/notification flow are
 * exercised for real without a database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/jobs/worker.server", () => ({ ensureJobWorkerStarted: () => {} }));

// ---------------------------------------------------------------------------
// Minimal supabase-js fake (thenable builder)
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

class Builder {
  private op: "select" | "insert" | "update" | "delete" | null = null;
  private values: Row | Row[] | null = null;
  private filters: Array<[string, string, unknown]> = [];
  private want: "none" | "single" | "maybeSingle" = "none";
  private limitN: number | null = null;

  constructor(
    private client: FakeSupabase,
    private table: string,
  ) {}

  select() {
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
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

  private exec(): { data: unknown; error: unknown } {
    const rows = this.client.tables[this.table] ?? (this.client.tables[this.table] = []);
    const now = new Date().toISOString();

    if (this.op === "insert") {
      const results: Row[] = [];
      for (const value of (Array.isArray(this.values) ? this.values : [this.values]) as Row[]) {
        const stamped: Row = {
          id: this.client.nextUuid(),
          ...(this.table === "search_jobs" ? jobColumnDefaults() : {}),
          ...value,
          created_at: now,
          updated_at: now,
        };
        const clash = (UNIQUE_KEYS[this.table] ?? []).some((uk) => {
          const cols = uk.split("+");
          if (!cols.every((c) => stamped[c] !== undefined && stamped[c] !== null)) return false;
          return rows.some((r) => cols.every((c) => r[c] === stamped[c]));
        });
        if (clash) {
          return { data: null, error: { code: "23505", message: "duplicate key value" } };
        }
        rows.push(stamped);
        results.push(stamped);
      }
      return { data: this.want === "single" ? results[0] : results, error: null };
    }

    if (this.op === "update") {
      let patched = this.matches(rows);
      if (this.limitN !== null) patched = patched.slice(0, this.limitN);
      for (const row of patched) Object.assign(row, this.values, { updated_at: now });
      if (this.want === "maybeSingle") return { data: patched[0] ?? null, error: null };
      return { data: patched, error: null };
    }
    if (this.op === "delete") {
      const doomed = this.matches(rows);
      for (const row of doomed) rows.splice(rows.indexOf(row), 1);
      return { data: doomed, error: null };
    }

    let out = this.matches(rows);
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    if (this.want === "single") return { data: out[0] ?? null, error: out.length ? null : { code: "PGRST116", message: "no rows" } };
    if (this.want === "maybeSingle") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  private matches(rows: Row[]): Row[] {
    return rows.filter((r) =>
      this.filters.every(([col, op, val]) => {
        if (op === "eq") return r[col] === val;
        if (op === "in") return (val as unknown[]).includes(r[col]);
        if (op === "lt") return String(r[col]) < String(val);
        if (op === "lte") return String(r[col]) <= String(val);
        return false;
      }),
    );
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

const THESIS = {
  entity: "company" as const,
  criteria: [{ field: "industry", value: "dentist", stated: true, confidence: 1 }],
  missing: [],
  signal_required: false,
  signal_types: [],
  signal_recency: null,
  status: "ready_to_search" as const,
  raw_query: "dentists in Pune",
};

function watchRow(over: Partial<Row> = {}): Row {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: USER,
    name: "Dentists",
    query: "dentists in Pune",
    project_id: null,
    change_mode: "new_entity",
    delivery: { channels: ["in_app"] },
    thesis: THESIS,
    icp: {},
    ...over,
  };
}

async function seedWatch(over: Partial<Row> = {}) {
  await sharedClient.from("campaigns").insert(watchRow(over));
}

function candidate(entityId: string, data: Record<string, unknown> = {}): Row {
  return { candidate_key: `k:${entityId}`, entity_id: entityId, data, state: "QUALIFIED" };
}

async function seedCompletedJob(watchId: string, candidates: Row[], jobId?: string) {
  const id = jobId ?? sharedClient.nextUuid();
  await sharedClient.from("search_jobs").insert({ id, watch_id: watchId, mode: "watch", status: "completed" });
  for (const c of candidates) {
    await sharedClient.from("search_job_candidates").insert({ ...c, job_id: id });
  }
  return id;
}

import {
  createWatchJob,
  diffWatchJob,
  fingerprintFor,
  processWatchJob,
  processCompletedWatchJobs,
  runDueWatchesForAllUsers,
  scheduleSlotFor,
  watchIsDue,
} from "../watch-scheduler.server";

beforeEach(() => {
  for (const t of Object.keys(sharedClient.tables)) sharedClient.tables[t] = [];
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

describe("createWatchJob", () => {
  it("enqueues a job with mode 'watch', the watch id, slot and frozen thesis", async () => {
    const w = watchRow() as never;
    const job = await createWatchJob(w, USER, { slot: scheduleSlotFor() });
    expect(job).not.toBeNull();
    expect(job!.mode).toBe("watch");
    expect(job!.watch_id).toBe((w as Row).id);
    expect(job!.spec).toEqual(THESIS);
    expect(sharedClient.tables.search_jobs).toHaveLength(1);
  });

  it("two creates for the same (watch_id, scheduled_for) → ONE job (conflict returns existing)", async () => {
    const w = watchRow() as never;
    const slot = scheduleSlotFor();
    const a = await createWatchJob(w, USER, { slot });
    const b = await createWatchJob(w, USER, { slot });
    expect(a!.id).toBe(b!.id);
    expect(sharedClient.tables.search_jobs).toHaveLength(1);
  });

  it("a different slot enqueues a different job", async () => {
    const w = watchRow() as never;
    await createWatchJob(w, USER, { slot: "2026-09-27T10:00:00.000Z" });
    await createWatchJob(w, USER, { slot: "2026-09-27T11:00:00.000Z" });
    expect(sharedClient.tables.search_jobs).toHaveLength(2);
  });
});

describe("scheduleSlotFor + watchIsDue", () => {
  it("floors to the UTC hour", () => {
    expect(scheduleSlotFor(new Date("2026-09-27T10:17:43.221Z"))).toBe("2026-09-27T10:00:00.000Z");
  });

  it("daily/weekly due gates", () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    expect(watchIsDue({ icp: {} })).toBe(true);
    expect(watchIsDue({ icp: { last_scheduled_at: hoursAgo(2) } })).toBe(false);
    expect(watchIsDue({ icp: { last_scheduled_at: hoursAgo(25) } })).toBe(true);
    expect(watchIsDue({ icp: { schedule: "weekly", last_scheduled_at: hoursAgo(24 * 6) } })).toBe(false);
    expect(watchIsDue({ icp: { schedule: "weekly", last_scheduled_at: hoursAgo(24 * 8) } })).toBe(true);
  });

  it("a paused watch is never due — even past its schedule window", () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    expect(watchIsDue({ icp: { paused: true } })).toBe(false);
    expect(watchIsDue({ icp: { paused: true, last_scheduled_at: hoursAgo(24 * 30) } })).toBe(false);
    // Resuming (paused: false / absent) restores the normal gate.
    expect(watchIsDue({ icp: { paused: false, last_scheduled_at: hoursAgo(25) } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cron — due watches for ALL users (paused skip is the E2E-C16 gate)
// ---------------------------------------------------------------------------

describe("runDueWatchesForAllUsers", () => {
  it("enqueues one job per due watch and stamps last_scheduled_at", async () => {
    await seedWatch();
    await seedWatch({ id: "00000000-0000-4000-8000-000000000011" });
    const res = await runDueWatchesForAllUsers(sharedClient as unknown as SupabaseClient);
    expect(res.ran).toBe(2);
    expect(sharedClient.tables.search_jobs).toHaveLength(2);
    for (const camp of sharedClient.tables.campaigns!) {
      expect((camp.icp as Row).last_scheduled_at).toBe(scheduleSlotFor());
    }
  });

  it("a paused watch is skipped by the cron — no job, no due-run", async () => {
    await seedWatch({ icp: { paused: true } });
    await seedWatch({ id: "00000000-0000-4000-8000-000000000011", icp: {} });
    const res = await runDueWatchesForAllUsers(sharedClient as unknown as SupabaseClient);
    expect(res.ran).toBe(1);
    const jobs = sharedClient.tables.search_jobs!;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].watch_id).toBe("00000000-0000-4000-8000-000000000011");
  });

  it("a deleted watch leaves no orphan due-run — only existing rows iterate", async () => {
    await seedWatch();
    const res = await runDueWatchesForAllUsers(sharedClient as unknown as SupabaseClient);
    expect(res.ran).toBe(1);
    // The watch row is removed; the next cron tick has nothing to iterate.
    await sharedClient.from("campaigns").delete().eq("id", "00000000-0000-4000-8000-000000000010");
    const again = await runDueWatchesForAllUsers(sharedClient as unknown as SupabaseClient);
    expect(again.ran).toBe(0);
    // The existing job for the old slot stays idempotent — no new one appears.
    expect(sharedClient.tables.search_jobs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

describe("fingerprintFor", () => {
  it("is stable regardless of signal order (new_signal mode)", () => {
    const a = fingerprintFor({ entity_id: "e1", data: { signals: ["hiring", "funding"] } }, "new_signal");
    const b = fingerprintFor({ entity_id: "e1", data: { signals: ["funding", "hiring"] } }, "new_signal");
    expect(a).toBe(b);
  });

  it("changes when the signal set changes (new_signal mode)", () => {
    const a = fingerprintFor({ entity_id: "e1", data: { signals: ["hiring"] } }, "new_signal");
    const b = fingerprintFor({ entity_id: "e1", data: { signals: ["hiring", "funding"] } }, "new_signal");
    expect(a).not.toBe(b);
  });

  it("new_entity mode ignores signal data entirely", () => {
    const a = fingerprintFor({ entity_id: "e1", data: { signals: ["hiring"] } }, "new_entity");
    const b = fingerprintFor({ entity_id: "e1", data: { signals: ["funding"] } }, "new_entity");
    expect(a).toBe(b);
  });

  it("falls back to candidate_key when entity_id is absent", () => {
    const a = fingerprintFor({ candidate_key: "k1" }, "new_entity");
    const b = fingerprintFor({ entity_id: null, candidate_key: "k1" }, "new_entity");
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Diff + notification fan-out
// ---------------------------------------------------------------------------

describe("diffWatchJob / processWatchJob", () => {
  it("new_signal mode: known entity, unchanged signals → NO notification intent", async () => {
    await seedWatch({ change_mode: "new_signal" });
    const w = watchRow({ change_mode: "new_signal" }) as never;
    const jobId = await seedCompletedJob((w as Row).id as string, [
      candidate("e1", { signals: ["hiring"] }),
    ]);
    // First run records the entity+signal fingerprint (and notifies once).
    const first = await processWatchJob(jobId);
    expect(first!.newCount).toBe(1);
    expect(sharedClient.tables.notification_outbox).toHaveLength(1);
    // Second job, same entity, same signals → nothing new, no new intent.
    const jobId2 = await seedCompletedJob((w as Row).id as string, [
      candidate("e1", { signals: ["hiring"] }),
    ]);
    const second = await processWatchJob(jobId2);
    expect(second!.newCount).toBe(0);
    expect(sharedClient.tables.notification_outbox).toHaveLength(1);
  });

  it("new_signal mode: known entity with a NEW signal → exactly one intent", async () => {
    await seedWatch({ change_mode: "new_signal" });
    const w = watchRow({ change_mode: "new_signal" }) as never;
    const watchId = (w as Row).id as string;
    await sharedClient.from("watch_seen_matches").insert({
      watch_id: watchId,
      entity_id: "e1",
      match_fingerprint: fingerprintFor({ entity_id: "e1", data: { signals: ["hiring"] } }, "new_signal"),
    });
    const jobId = await seedCompletedJob(watchId, [
      candidate("e1", { signals: ["hiring", "funding"] }),
    ]);
    const result = await processWatchJob(jobId);
    expect(result!.newCount).toBe(1);
    const intents = sharedClient.tables.notification_outbox!;
    expect(intents).toHaveLength(1);
    expect(intents[0].channel).toBe("in_app");
    expect((intents[0].payload as Row).matches).toBe(1);
    expect(intents[0].idempotency_key).toBe(`watch:${watchId}:${jobId}:in_app`);
  });

  it("new_entity mode: a first-seen entity enqueues one intent per delivery channel", async () => {
    await seedWatch({ delivery: { channels: ["in_app", "email", "slack"] } });
    const w = watchRow() as never;
    const watchId = (w as Row).id as string;
    await sharedClient.from("notification_connections").insert({
      id: "c-e",
      user_id: USER,
      type: "email",
      enabled: true,
      encrypted_credentials: "enc",
    });
    const jobId = await seedCompletedJob(watchId, [candidate("e1"), candidate("e2")]);
    const result = await processWatchJob(jobId);
    expect(result!.newCount).toBe(2);
    const intents = sharedClient.tables.notification_outbox!;
    expect(intents.map((i) => i.channel).sort()).toEqual(["email", "in_app"]);
    const inApp = intents.find((i) => i.channel === "in_app")!;
    expect((inApp.payload as Row).matches).toBe(2);
    expect((inApp.payload as Row).connection_id).toBeNull();
    expect(intents.find((i) => i.channel === "email")!.payload).toMatchObject({ connection_id: "c-e" });
    // slack skipped: no enabled slack connection
  });

  it("non-QUALIFIED candidates are never diffed", async () => {
    await seedWatch();
    const w = watchRow() as never;
    const jobId = sharedClient.nextUuid();
    await sharedClient.from("search_jobs").insert({ id: jobId, watch_id: (w as Row).id, mode: "watch", status: "completed" });
    await sharedClient.from("search_job_candidates").insert({
      ...candidate("e1"),
      job_id: jobId,
      state: "DISCOVERED",
    });
    const result = await processWatchJob(jobId);
    expect(result!.newCount).toBe(0);
    expect(sharedClient.tables.watch_seen_matches).toHaveLength(0);
    expect(sharedClient.tables.notification_outbox).toHaveLength(0);
  });

  it("is idempotent: a reprocessed job is skipped via icp.last_job_id", async () => {
    await seedWatch();
    const w = watchRow() as never;
    const watchId = (w as Row).id as string;
    const jobId = await seedCompletedJob(watchId, [candidate("e1")]);
    const first = await processWatchJob(jobId);
    expect(first!.newCount).toBe(1);
    const campaign = sharedClient.tables.campaigns![0];
    expect((campaign.icp as Row).last_job_id).toBe(jobId);
    expect((campaign.icp as Row).last_results_count).toBe(1);

    const second = await processWatchJob(jobId);
    expect(second!.skipped).toBe("already_processed");
    expect(sharedClient.tables.watch_seen_matches).toHaveLength(1);
    expect(sharedClient.tables.notification_outbox).toHaveLength(1);
  });

  it("the poller processes only unstamped completed watch jobs", async () => {
    await seedWatch();
    const w = watchRow() as never;
    const watchId = (w as Row).id as string;
    const j1 = await seedCompletedJob(watchId, [candidate("e1")]);
    await processWatchJob(j1);
    const j2 = await seedCompletedJob(watchId, [candidate("e3")]);
    const results = await processCompletedWatchJobs();
    expect(results.map((r) => r.jobId)).toEqual([j2]);
    expect(sharedClient.tables.watch_seen_matches.map((r) => r.entity_id).sort()).toEqual(["e1", "e3"]);
  });

  it("diffWatchJob de-duplicates identical candidates within one job", async () => {
    await seedWatch();
    const w = watchRow() as never;
    const watchId = (w as Row).id as string;
    const jobId = await seedCompletedJob(watchId, [candidate("e1"), candidate("e1")]);
    const { newCount } = await diffWatchJob(w as never, jobId, sharedClient as unknown as SupabaseClient);
    expect(newCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// compile-thesis (deterministic, offline)
// ---------------------------------------------------------------------------

describe("compileThesisDeterministic", () => {
  it("produces a SearchSpec without any LLM call", async () => {
    const { compileThesisDeterministic } = await import("../compile-thesis");
    const spec = compileThesisDeterministic("SaaS founders hiring engineers");
    expect(spec.raw_query).toBe("SaaS founders hiring engineers");
    expect(Array.isArray(spec.criteria)).toBe(true);
    expect(spec.status).toBeDefined();
  });
});
