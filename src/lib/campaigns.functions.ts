/**
 * Signal watches — persist buying-signal prompts as campaigns and re-run on
 * schedule. No auto-send; drafts stay manual.
 *
 * Watch v2 (Workstream 5): a run is a durable search job (mode 'watch') on the
 * job engine carrying the watch's FROZEN compiled thesis. This module only
 * compiles/caches the thesis, enqueues jobs (idempotent per schedule slot) and
 * keeps the legacy icp bookkeeping fresh — completion diffing, seen-match
 * memory and notification fan-out live in watch/watch-scheduler.server.ts.
 *
 * The legacy searchAllSources execution path (executeWatchSearch) is RETIRED.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { compileThesis } from "@/lib/watch/compile-thesis";
import {
  createWatchJob,
  scheduleSlotFor,
  watchIsDue,
  type WatchChangeMode,
  type WatchDeliveryChannel,
  type WatchIcp,
} from "@/lib/watch/watch-scheduler.server";

export type WatchSchedule = "daily" | "weekly";
export type { WatchChangeMode, WatchDeliveryChannel, WatchIcp };
export type CampaignIcp = WatchIcp;

const CreateWatch = z.object({
  name: z.string().min(1).max(120).optional(),
  query: z.string().min(2).max(200),
  schedule: z.enum(["daily", "weekly"]).default("daily"),
  projectId: z.string().uuid().nullable().optional(),
  changeMode: z.enum(["new_entity", "new_signal"]).optional(),
  deliveryChannels: z.array(z.enum(["in_app", "email", "slack"])).optional(),
});

const WatchId = z.object({ id: z.string().uuid() });

const WATCH_COLUMNS =
  "id, name, query, icp, project_id, change_mode, delivery, thesis_context_version, last_run_at, created_at, updated_at";

// ---------------------------------------------------------------------------
// createSignalWatch
// ---------------------------------------------------------------------------

export const createSignalWatch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => CreateWatch.parse(d))
  .handler(async ({ data, context }) => {
    const { classifyQuery } = await import("./search/query-classifier");
    const classified = classifyQuery(data.query);

    // Compile + freeze the thesis NOW (deterministic compiler, cron-safe).
    let projectId: string | null = null;
    if (data.projectId) {
      const { data: proj } = await context.supabase
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (proj) projectId = data.projectId;
    }
    const thesis = await compileThesis(context.supabase, context.userId, data.query, projectId);

    const channels = data.deliveryChannels?.length
      ? [...new Set(data.deliveryChannels)]
      : ["in_app"];
    const icp: CampaignIcp = {
      signal_prompt: data.query,
      schedule: data.schedule,
      signal_mode: classified.signalMode,
      signal_family: classified.signalFamily,
      last_results_count: 0,
      last_error: null,
      notify: true,
    };
    const name =
      data.name?.trim() || (data.query.length > 60 ? `${data.query.slice(0, 57)}…` : data.query);

    const { data: row, error } = await context.supabase
      .from("campaigns")
      .insert({
        user_id: context.userId,
        name,
        query: data.query,
        icp,
        project_id: projectId,
        thesis: thesis.spec,
        thesis_context_version: thesis.contextVersion,
        change_mode: data.changeMode ?? "new_entity",
        delivery: { channels },
      })
      .select(WATCH_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

// ---------------------------------------------------------------------------
// listSignalWatches / deleteSignalWatch
// ---------------------------------------------------------------------------

export const listSignalWatches = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("campaigns")
      .select(WATCH_COLUMNS)
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteSignalWatch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => WatchId.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("campaigns")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// setSignalWatchPaused — pause/resume WITHOUT a schema change: the flag lives
// in the icp jsonb the scheduler already reads (WatchIcp.paused). watchIsDue
// returns false for paused watches, so the cron and run-due paths skip them.
// Manual "Run now" stays allowed (explicit user action).
// ---------------------------------------------------------------------------

export const setSignalWatchPaused = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), paused: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: camp, error } = await context.supabase
      .from("campaigns")
      .select("id, icp")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!camp) throw new Error("Watch not found");
    const icp = { ...((camp.icp as WatchIcp) || {}), paused: data.paused };
    const { error: updErr } = await context.supabase
      .from("campaigns")
      .update({ icp })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, paused: data.paused };
  });

// ---------------------------------------------------------------------------
// runSignalWatch — manual "Run now": enqueue ONE watch job (idempotent slot).
// Free-plan gate kept; no quota charge — one watch run IS one job.
// ---------------------------------------------------------------------------

const WATCH_COLUMNS_WITH_THESIS = `${WATCH_COLUMNS}, thesis`;

export const runSignalWatch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => WatchId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: camp, error } = await context.supabase
      .from("campaigns")
      .select(WATCH_COLUMNS_WITH_THESIS)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!camp) throw new Error("Watch not found");

    const limit = await freePlanBlocked(context.supabase, context.userId, context.user?.email);
    if (limit) return { id: camp.id, jobId: null as string | null, status: null, error: "limit" as const, message: limit };

    // Compile-and-cache the thesis on first run (legacy rows have none).
    let thesis = camp.thesis as Awaited<ReturnType<typeof compileThesis>>["spec"] | null;
    if (!thesis) {
      const compiled = await compileThesis(context.supabase, context.userId, camp.query, camp.project_id);
      thesis = compiled.spec;
      await context.supabase
        .from("campaigns")
        .update({ thesis: compiled.spec, thesis_context_version: compiled.contextVersion })
        .eq("id", camp.id)
        .eq("user_id", context.userId);
    }

    const slot = scheduleSlotFor();
    const job = await createWatchJob(
      {
        id: camp.id,
        user_id: context.userId,
        name: camp.name,
        query: camp.query,
        project_id: camp.project_id,
        change_mode: (camp.change_mode ?? "new_entity") as WatchChangeMode,
        delivery: (camp.delivery ?? null) as { channels?: WatchDeliveryChannel[] } | null,
        thesis,
        icp: (camp.icp ?? {}) as WatchIcp,
      },
      context.userId,
      { slot },
    );

    const icp = { ...((camp.icp as WatchIcp) || {}) };
    icp.last_scheduled_at = slot;
    icp.last_error = null;
    await context.supabase
      .from("campaigns")
      .update({ icp, last_run_at: camp.last_run_at ?? new Date().toISOString() })
      .eq("id", camp.id)
      .eq("user_id", context.userId);

    return {
      id: camp.id,
      jobId: job?.id ?? null,
      status: job?.status ?? "queued",
      error: null,
      message: null,
    };
  });

// ---------------------------------------------------------------------------
// runDueSignalWatches — manual trigger for the current user's due watches
// ---------------------------------------------------------------------------

export const runDueSignalWatches = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data: camps, error } = await context.supabase
      .from("campaigns")
      .select(WATCH_COLUMNS_WITH_THESIS)
      .eq("user_id", context.userId)
      .limit(20);
    if (error) throw new Error(error.message);

    const slot = scheduleSlotFor();
    const results: Array<{ id: string; jobId: string | null }> = [];
    for (const camp of camps ?? []) {
      if (!watchIsDue({ icp: (camp.icp ?? {}) as WatchIcp, last_run_at: camp.last_run_at })) continue;

      const limit = await freePlanBlocked(context.supabase, context.userId, context.user?.email);
      if (limit) break;

      let thesis = camp.thesis as Awaited<ReturnType<typeof compileThesis>>["spec"] | null;
      if (!thesis) {
        const compiled = await compileThesis(context.supabase, context.userId, camp.query, camp.project_id);
        thesis = compiled.spec;
        await context.supabase
          .from("campaigns")
          .update({ thesis: compiled.spec, thesis_context_version: compiled.contextVersion })
          .eq("id", camp.id)
          .eq("user_id", context.userId);
      }
      const job = await createWatchJob(
        {
          id: camp.id,
          user_id: context.userId,
          name: camp.name,
          query: camp.query,
          project_id: camp.project_id,
          change_mode: (camp.change_mode ?? "new_entity") as WatchChangeMode,
          delivery: (camp.delivery ?? null) as { channels?: WatchDeliveryChannel[] } | null,
          thesis,
          icp: (camp.icp ?? {}) as WatchIcp,
        },
        context.userId,
        { slot },
      );
      const icp = { ...((camp.icp as WatchIcp) || {}) };
      icp.last_scheduled_at = slot;
      await context.supabase
        .from("campaigns")
        .update({ icp, last_run_at: camp.last_run_at ?? new Date().toISOString() })
        .eq("id", camp.id)
        .eq("user_id", context.userId);
      results.push({ id: camp.id, jobId: job?.id ?? null });
    }
    return { ran: results.length, results };
  });

// ---------------------------------------------------------------------------
// Free-plan gate — kept from the legacy path, but a watch run is never charged
// against searches_used (one watch run = one job; the job engine owns budget).
// ---------------------------------------------------------------------------

async function freePlanBlocked(
  supabase: SupabaseClient,
  userId: string,
  ownerEmail?: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, email, searches_used, searches_reset_at")
    .eq("id", userId)
    .maybeSingle();
  const { isOwnerEmail } = await import("./owner");
  const owner = isOwnerEmail(ownerEmail ?? (profile as { email?: string } | null)?.email ?? "");
  if (owner || profile?.plan !== "free") return null;
  const resetAt = profile?.searches_reset_at ? new Date(profile.searches_reset_at) : new Date(0);
  const used = resetAt.getTime() < Date.now() - 86_400_000 ? 0 : (profile?.searches_used ?? 0);
  if (used >= 5) return "Free plan: 5 searches per day. Watch skipped.";
  return null;
}
