/**
 * Search Job server fns (Workstream 1). All requireMyAuth; every read/write is
 * scoped to context.userId — the store runs on the admin client, so ownership
 * is enforced HERE, row by row. Other users' rows are never returned.
 *
 * NOTE: lives in search-jobs.functions.ts (not jobs.functions.ts) because that
 * file is the existing job-board search endpoint.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { getSearchJobsStore } from "@/lib/jobs/search-jobs.server";
import { SearchSpecZod, TERMINAL_STATUSES } from "@/lib/jobs/search-job.types";
import type { SearchJobRow } from "@/lib/jobs/search-job.types";

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

/** Recursively JSON-safe wire type (TanStack Start validates fn returns). */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type WireJob = Omit<SearchJobRow, "spec" | "budgets" | "context_snapshot"> & {
  spec: Json;
  budgets: Json;
  context_snapshot: Json | null;
};

/** Lease internals never leave the server; jsonb payloads are plain JSON on
 *  the wire (they were zod-validated on the way in / out of the store). */
function toWireJob(row: SearchJobRow): WireJob {
  const { lease_owner: _o, lease_expires_at: _e, heartbeat_at: _h, ...pub } = row;
  return pub as unknown as WireJob;
}

function jobNotFound(): never {
  throw new Error("Search job not found");
}

const idInput = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// createSearchJob
// ---------------------------------------------------------------------------

export const createSearchJob = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        spec: SearchSpecZod,
        target: z.number().int().min(1).max(2000).optional(),
        projectId: z.string().uuid().nullable().optional(),
        watchId: z.string().uuid().nullable().optional(),
        scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    const target = data.target ?? 10;
    // Frozen mode inference: ≤25 interactive, ≤200 batch, else job.
    const mode = target <= 25 ? "interactive" : target <= 200 ? "batch" : "job";
    const job = await store.create({
      user_id: context.userId,
      project_id: data.projectId ?? null,
      watch_id: data.watchId ?? null,
      scheduled_for: data.scheduledFor ?? null,
      spec: data.spec,
      target,
      mode,
    });
    return toWireJob(job);
  });

// ---------------------------------------------------------------------------
// getSearchJob
// ---------------------------------------------------------------------------

export const getSearchJob = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    const job = await store.get(data.id);
    if (!job || job.user_id !== context.userId) return null;
    return toWireJob(job);
  });

// ---------------------------------------------------------------------------
// listSearchJobs (paged, newest first)
// ---------------------------------------------------------------------------

export const listSearchJobs = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        page: z.number().int().min(0).optional().default(0),
        pageSize: z.number().int().min(1).max(50).optional().default(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    // Store-level eq(user_id) + pageSize clamp ≤50; defense-in-depth: the
    // admin client is never exposed to the caller.
    const { rows, total } = await store.list(context.userId, {
      page: data.page,
      pageSize: data.pageSize,
    });
    return { rows: rows.map(toWireJob), total };
  });

// ---------------------------------------------------------------------------
// requestPauseSearchJob — only meaningful while queued/running
// ---------------------------------------------------------------------------

export const requestPauseSearchJob = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    const job = await store.get(data.id);
    if (!job || job.user_id !== context.userId) jobNotFound();
    if (job.status !== "queued" && job.status !== "running") {
      throw new Error(`Cannot pause a ${job.status} search job`);
    }
    await store.setDesiredPause(job.id);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// requestStopSearchJob
// ---------------------------------------------------------------------------

export const requestStopSearchJob = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    const job = await store.get(data.id);
    if (!job || job.user_id !== context.userId) jobNotFound();
    if (TERMINAL_STATUSES.includes(job.status)) {
      throw new Error(`Search job already finished (${job.status})`);
    }
    await store.setDesiredStop(job.id);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// resumeSearchJob — paused → queued; stopped is terminal and NOT resumable
// ---------------------------------------------------------------------------

export const resumeSearchJob = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    const job = await store.get(data.id);
    if (!job || job.user_id !== context.userId) jobNotFound();
    if (job.status === "stopped") {
      throw new Error("A stopped search job is terminal and cannot be resumed");
    }
    if (job.status !== "paused") {
      throw new Error(`Cannot resume a ${job.status} search job`);
    }
    await store.update(job.id, { status: "queued" });
    await store.clearDesired(job.id); // clears pause_requested_at (+ stale stop)
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// deleteSearchJob — own queued/paused/stopped rows only
// ---------------------------------------------------------------------------

export const deleteSearchJob = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const store = getSearchJobsStore();
    const job = await store.get(data.id);
    if (!job || job.user_id !== context.userId) jobNotFound();
    const deletable = ["queued", "paused", "stopped"] as const;
    if (!deletable.includes(job.status as (typeof deletable)[number])) {
      throw new Error(`Cannot delete a ${job.status} search job`);
    }
    await store.delete(job.id);
    return { ok: true as const };
  });
