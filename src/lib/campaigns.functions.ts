/**
 * Signal watches — persist buying-signal prompts as campaigns and re-run on schedule.
 * No auto-send; drafts stay manual. Schedule metadata lives in `icp` jsonb.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

export type WatchSchedule = "daily" | "weekly";

export type CampaignIcp = {
  signal_prompt?: string;
  schedule?: WatchSchedule;
  signal_mode?: string;
  signal_family?: string | null;
  last_results_count?: number;
  last_error?: string | null;
  notify?: boolean;
};

const CreateWatch = z.object({
  name: z.string().min(1).max(120).optional(),
  query: z.string().min(2).max(200),
  schedule: z.enum(["daily", "weekly"]).default("daily"),
});

const WatchId = z.object({ id: z.string().uuid() });

function scheduleDue(lastRunAt: string | null, schedule: WatchSchedule): boolean {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt).getTime();
  const ms = schedule === "weekly" ? 7 * 86400_000 : 86400_000;
  return Date.now() - last >= ms;
}

export const createSignalWatch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => CreateWatch.parse(d))
  .handler(async ({ data, context }) => {
    const { classifyQuery } = await import("./search/query-classifier");
    const classified = classifyQuery(data.query);
    const icp: CampaignIcp = {
      signal_prompt: data.query,
      schedule: data.schedule,
      signal_mode: classified.signalMode,
      signal_family: classified.signalFamily,
      last_results_count: 0,
      notify: true,
    };
    const name =
      data.name?.trim() ||
      (data.query.length > 60 ? `${data.query.slice(0, 57)}…` : data.query);

    const { data: row, error } = await context.supabase
      .from("campaigns")
      .insert({
        user_id: context.userId,
        name,
        query: data.query,
        icp,
      })
      .select("id, name, query, icp, last_run_at, created_at")
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

export const listSignalWatches = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("campaigns")
      .select("id, name, query, icp, last_run_at, created_at, updated_at")
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

/** Re-run one watch immediately (counts against search quota like a normal search). */
export const runSignalWatch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => WatchId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: camp, error } = await context.supabase
      .from("campaigns")
      .select("id, query, icp, last_run_at")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!camp) throw new Error("Watch not found");

    const result = await executeWatchSearch(context.supabase, context.userId, camp.query);

    const icp = { ...((camp.icp as CampaignIcp) || {}) };
    icp.last_results_count = result.leads.length;
    icp.last_error = result.error ?? null;

    await context.supabase
      .from("campaigns")
      .update({
        icp,
        last_run_at: new Date().toISOString(),
      })
      .eq("id", camp.id)
      .eq("user_id", context.userId);

    return {
      id: camp.id,
      query: camp.query,
      results_count: result.leads.length,
      leads: result.leads,
      error: result.error,
      message: result.message,
    };
  });

/** Run all due watches for the current user (manual trigger / cron-compatible). */
export const runDueSignalWatches = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data: camps, error } = await context.supabase
      .from("campaigns")
      .select("id, query, icp, last_run_at")
      .eq("user_id", context.userId)
      .limit(20);
    if (error) throw new Error(error.message);

    const due = (camps ?? []).filter((c) => {
      const schedule = ((c.icp as CampaignIcp)?.schedule || "daily") as WatchSchedule;
      return scheduleDue(c.last_run_at, schedule);
    });

    const results: Array<{ id: string; query: string; results_count: number }> = [];
    for (const camp of due) {
      const result = await executeWatchSearch(context.supabase, context.userId, camp.query);
      const icp = { ...((camp.icp as CampaignIcp) || {}) };
      icp.last_results_count = result.leads.length;
      icp.last_error = result.error ?? null;
      await context.supabase
        .from("campaigns")
        .update({ icp, last_run_at: new Date().toISOString() })
        .eq("id", camp.id)
        .eq("user_id", context.userId);
      results.push({
        id: camp.id,
        query: camp.query,
        results_count: result.leads.length,
      });
    }
    return { ran: results.length, results };
  });

async function executeWatchSearch(
  supabase: any,
  userId: string,
  query: string,
): Promise<{
  leads: any[];
  error: string | null;
  message: string | null;
}> {
  const { searchAllSources } = await import("./search/sources.server");
  const { classifyQuery, getSubredditBoostsForQuery } = await import("./search/query-classifier");
  const { expandFromClassified } = await import("./search/query-expander");
  const { dedupeByUrl, fuzzyDedupeLeads, diversifiedTop12 } = await import("./scoring");
  const { validateLeads } = await import("./validation");

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, searches_used, searches_reset_at, years_experience")
    .eq("id", userId)
    .maybeSingle();

  let used = profile?.searches_used ?? 0;
  const resetAt = profile?.searches_reset_at ? new Date(profile.searches_reset_at) : new Date(0);
  const now = new Date();
  if (resetAt < new Date(now.getTime() - 86400_000)) {
    used = 0;
    await supabase.from("profiles").update({ searches_used: 0, searches_reset_at: now.toISOString() }).eq("id", userId);
  }
  const plan = profile?.plan ?? "free";
  if (plan === "free" && used >= 5) {
    return {
      leads: [],
      error: "limit",
      message: "Free plan: 5 searches per day. Watch skipped.",
    };
  }

  const classified = classifyQuery(query);
  const expanded = expandFromClassified(classified);
  const subredditBoosts = getSubredditBoostsForQuery(classified);
  const yoe = profile?.years_experience ?? null;
  const prefs = {
    yearsExperience: yoe,
    preferJunior: yoe == null || yoe <= 1,
    preferMid: yoe != null && yoe >= 2 && yoe <= 4,
    preferSenior: yoe != null && yoe >= 5,
    preferRemote: true,
  };

  const { leads: raw, sources } = await searchAllSources({
    classified,
    expanded,
    subredditBoosts,
    prefs,
  });
  const deduped = fuzzyDedupeLeads(dedupeByUrl(raw));
  const validated = validateLeads(deduped, classified, expanded, prefs);
  const leads = diversifiedTop12(validated, {
    directoryMode: classified.intentMode === "directory_smb",
  });

  await supabase.from("profiles").update({ searches_used: used + 1 }).eq("id", userId);
  await supabase.from("search_history").insert({
    user_id: userId,
    query: `[watch] ${query}`,
    results_count: leads.length,
    sources_searched: sources,
  });

  return { leads, error: null, message: null };
}
