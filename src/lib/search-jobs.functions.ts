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
    // Context snapshot (frozen): the job executes against the project context
    // it started with, even if the project changes mid-run. Best-effort —
    // ownership checked on the projects row before its context is read.
    let contextVersion: number | null = null;
    let contextSnapshot: Record<string, unknown> | null = null;
    if (data.projectId) {
      try {
        const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
        const { data: proj } = await getAdmin()
          .from("projects")
          .select("id")
          .eq("id", data.projectId)
          .eq("user_id", context.userId)
          .maybeSingle();
        if (proj) {
          const { data: ctxRow } = await getAdmin()
            .from("project_context")
            .select(
              "context_version, default_icp_id, offer_profile, preferred_geographies, exclusions, preferred_signals, messaging_preferences, custom_context",
            )
            .eq("project_id", data.projectId)
            .maybeSingle();
          if (ctxRow) {
            contextVersion =
              typeof ctxRow.context_version === "number" ? ctxRow.context_version : null;
            const { context_version: _v, ...snap } = ctxRow;
            contextSnapshot = snap;
          }
        }
      } catch {
        // snapshot is best-effort; the job still runs on the explicit spec
      }
    }
    const job = await store.create({
      user_id: context.userId,
      project_id: data.projectId ?? null,
      watch_id: data.watchId ?? null,
      scheduled_for: data.scheduledFor ?? null,
      spec: data.spec,
      target,
      mode,
    });
    if (contextVersion !== null || contextSnapshot !== null) {
      await store.update(job.id, {
        project_context_version: contextVersion,
        context_snapshot: contextSnapshot,
      });
    }
    // Batch/job modes continue in the background worker; interactive stays
    // on the existing inline path.
    if (mode !== "interactive") {
      const { ensureJobWorkerStarted } = await import("@/lib/jobs/worker.server");
      ensureJobWorkerStarted();
    }
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
        projectId: z.string().uuid().nullable().optional(),
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
      projectId: data.projectId ?? undefined,
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
