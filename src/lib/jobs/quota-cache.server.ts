/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Jobs quota + cache — per-user daily search limit (free-tier politeness) and
 * a 7-day result cache so searches return bigger lists, refetch less, and
 * quota-exhausted users can still browse recent jobs read-only.
 */
import type { JobPosting } from "./types";

export const JOB_SEARCH_DAILY_LIMIT = Number(process.env.JOB_SEARCH_DAILY_LIMIT ?? 3);
const CACHE_TTL_MS = 7 * 86_400_000;

export type QuotaState = { used: number; limit: number; remaining: number; exhausted: boolean };

/** Read-and-advance the caller's daily job-search budget (24h rolling reset). */
export async function consumeJobSearchQuota(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<QuotaState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("job_searches_used, job_searches_reset_at")
    .eq("id", userId)
    .maybeSingle();

  let used = profile?.job_searches_used ?? 0;
  const resetAt = profile?.job_searches_reset_at ? new Date(profile.job_searches_reset_at) : null;
  if (!resetAt || Date.now() - resetAt.getTime() > 86_400_000) used = 0;

  const nextUsed = used + 1;
  await supabase
    .from("profiles")
    .update({
      job_searches_used: nextUsed,
      job_searches_reset_at: resetAt ?? new Date().toISOString(),
    })
    .eq("id", userId);

  return {
    used: nextUsed,
    limit: JOB_SEARCH_DAILY_LIMIT,
    remaining: Math.max(0, JOB_SEARCH_DAILY_LIMIT - nextUsed),
    exhausted: nextUsed >= JOB_SEARCH_DAILY_LIMIT,
  };
}

/** Peek without consuming — for UI counters. */
export async function peekJobSearchQuota(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<QuotaState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("job_searches_used, job_searches_reset_at")
    .eq("id", userId)
    .maybeSingle();
  let used = profile?.job_searches_used ?? 0;
  const resetAt = profile?.job_searches_reset_at ? new Date(profile.job_searches_reset_at) : null;
  if (!resetAt || Date.now() - resetAt.getTime() > 86_400_000) used = 0;
  return {
    used,
    limit: JOB_SEARCH_DAILY_LIMIT,
    remaining: Math.max(0, JOB_SEARCH_DAILY_LIMIT - used),
    exhausted: used >= JOB_SEARCH_DAILY_LIMIT,
  };
}

// ── cache ───────────────────────────────────────────────────────────────────

export async function loadCachedJobs(supabase: {
  from: (t: string) => any;
}): Promise<JobPosting[]> {
  try {
    const since = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data } = await supabase
      .from("jobs_cache")
      .select("id,payload")
      .gte("fetched_at", since)
      .limit(3000);
    return ((data ?? []) as Array<{ payload: unknown }>)
      .map((r) => r.payload as JobPosting)
      .filter((j) => j && typeof j.id === "string" && typeof j.url === "string");
  } catch {
    return [];
  }
}

export async function upsertCachedJobs(
  supabase: { from: (t: string) => any },
  jobs: JobPosting[],
): Promise<void> {
  if (!jobs.length) return;
  const rows = jobs.map((j) => ({
    id: j.id,
    payload: j,
    fetched_at: new Date().toISOString(),
  }));
  const now = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  for (let i = 0; i < rows.length; i += 400) {
    try {
      await supabase.from("jobs_cache").upsert(rows.slice(i, i + 400));
    } catch {
      /* cache is best-effort */
    }
  }
  // Opportunistic prune of stale rows (best-effort).
  try {
    await supabase.from("jobs_cache").delete().lt("fetched_at", now);
  } catch {
    /* ignore */
  }
}
