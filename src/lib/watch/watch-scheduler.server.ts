/**
 * Watch v2 scheduler + completion processing (Workstream 5). Design FROZEN.
 *
 * The job ENGINE is never modified. Watches ride it end to end:
 *   enqueue   → createWatchJob inserts a search_jobs row (mode 'watch') with
 *               the watch's frozen thesis; the partial UNIQUE
 *               (watch_id, scheduled_for) makes a schedule slot idempotent —
 *               a second create for the same slot returns the existing row.
 *   execution → the existing worker (ensureJobWorkerStarted) + engine run the
 *               job exactly like any other search.
 *   aftermath → a small 60s poller (same lazy-singleton pattern as
 *               worker.server.ts) picks up completed watch jobs whose id is
 *               NOT yet recorded in campaigns.icp.last_job_id, then:
 *               fingerprints qualified candidates, diffs against
 *               watch_seen_matches, inserts unseen rows, enqueues one
 *               notification intent per delivery channel, and stamps the
 *               watch's icp (last_job_id) so the job is never reprocessed.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdmin } from "@/integrations/my-supabase/admin.server";
import {
  SearchJobConflictError,
  parseSearchJobRow,
  type SearchJobRow,
} from "@/lib/jobs/search-job.types";
import { getSearchJobsStore } from "@/lib/jobs/search-jobs.server";
import { ensureJobWorkerStarted } from "@/lib/jobs/worker.server";
import { compileThesisDeterministic } from "./compile-thesis";
import {
  enqueueNotification,
  ensureNotificationTickerStarted,
} from "@/lib/notifications/outbox.server";import type { SearchSpec } from "@/lib/search/search-spec";

export type WatchChangeMode = "new_entity" | "new_signal";
export type WatchDeliveryChannel = "in_app" | "email" | "slack";
export type WatchSchedule = "daily" | "weekly";

/** icp jsonb fields WS5 owns (legacy fields ride along untouched). */
export interface WatchIcp {
  schedule?: WatchSchedule;
  last_scheduled_at?: string | null;
  last_job_id?: string | null;
  last_run_at?: string | null;
  last_results_count?: number;
  last_error?: string | null;
  [key: string]: unknown;
}

export interface WatchRecord {
  id: string;
  user_id: string;
  name: string | null;
  query: string;
  project_id: string | null;
  change_mode: WatchChangeMode;
  delivery: { channels?: WatchDeliveryChannel[] } | null;
  thesis: SearchSpec | null;
  icp: WatchIcp | null;
}

const WATCH_TARGET = 10;

// ---------------------------------------------------------------------------
// Schedule slot + enqueue
// ---------------------------------------------------------------------------

/** Hour-floored slot: the (watch_id, scheduled_for) idempotency key. */
export function scheduleSlotFor(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

/** Due gate for daily/weekly watches (used by cron + manual run-all). */
export function watchIsDue(watch: {
  icp: WatchIcp | null;
  last_run_at?: string | null;
}, now: Date = new Date()): boolean {
  const schedule = watch.icp?.schedule ?? "daily";
  const last = watch.icp?.last_scheduled_at ?? watch.icp?.last_run_at ?? watch.last_run_at ?? null;
  if (!last) return true;
  const ms = schedule === "weekly" ? 7 * 86_400_000 : 86_400_000;
  return now.getTime() - new Date(last).getTime() >= ms;
}

/**
 * Enqueue one watch run for `slot`. Idempotent: on SearchJobConflictError the
 * existing job for (watch_id, slot) is returned — a cron retry or duplicate
 * click can never create a second job for the same slot.
 */
export async function createWatchJob(
  watch: WatchRecord,
  ownerId: string,
  opts: { slot?: string; client?: SupabaseClient } = {},
): Promise<SearchJobRow | null> {
  const slot = opts.slot ?? scheduleSlotFor();
  const spec = watch.thesis ?? compileThesisDeterministic(watch.query);
  try {
    const job = await getSearchJobsStore().create({
      user_id: ownerId,
      project_id: watch.project_id ?? null,
      watch_id: watch.id,
      scheduled_for: slot,
      spec,
      target: WATCH_TARGET,
      mode: "watch",
    });
    ensureJobWorkerStarted();
    return job;
  } catch (err) {
    if (!(err instanceof SearchJobConflictError)) throw err;
    const client = opts.client ?? getAdmin();
    const { data, error } = await client
      .from("search_jobs")
      .select("*")
      .eq("watch_id", watch.id)
      .eq("scheduled_for", slot)
      .maybeSingle();
    if (error) throw new Error(`[watch-scheduler] conflict lookup failed: ${error.message}`);
    return data ? parseSearchJobRow(data) : null;
  }
}

// ---------------------------------------------------------------------------
// Fingerprints — deterministic, no timestamps
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Stable JSON stringify (recursively key-sorted) for signal payloads. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(",")}}`;
}

/**
 * Signal identity extracted from candidate data (present → sorted keys):
 * `signals` items, `signal_types` items, `evidence` object keys. Deterministic
 * and order-insensitive, so the same signal set always hashes the same.
 */
export function signalKeysFor(data: Record<string, unknown> | null | undefined): string[] {
  const keys = new Set<string>();
  if (Array.isArray(data?.signals)) {
    for (const s of data.signals) keys.add(`signal:${stableStringify(s)}`);
  }
  if (Array.isArray(data?.signal_types)) {
    for (const s of data.signal_types) keys.add(`type:${stableStringify(s)}`);
  }
  if (data?.evidence && typeof data.evidence === "object" && !Array.isArray(data.evidence)) {
    for (const k of Object.keys(data.evidence).sort()) keys.add(`evidence:${k}`);
  }
  return [...keys].sort();
}

/**
 * new_entity mode → hash(entity_id): any sighting of a new entity notifies.
 * new_signal mode → hash(entity_id + sorted signal keys): only a CHANGED
 * signal set on a known entity notifies.
 */
export function fingerprintFor(
  row: { entity_id?: string | null; candidate_key?: string; data?: Record<string, unknown> | null },
  changeMode: WatchChangeMode,
): string {
  const entityId = row.entity_id ?? row.candidate_key ?? "";
  if (changeMode !== "new_signal") return sha256(entityId);
  return sha256([entityId, ...signalKeysFor(row.data)].join("|"));
}

// ---------------------------------------------------------------------------
// Diff + completion processing
// ---------------------------------------------------------------------------

export interface WatchDiffResult {
  watchId: string;
  jobId: string;
  newCount: number;
  notifiedChannels: WatchDeliveryChannel[];
  skipped?: "already_processed" | "not_terminal" | "no_watch";
}

interface CandidateRow {
  candidate_key: string;
  entity_id: string | null;
  data: Record<string, unknown> | null;
}

/**
 * Diff one completed watch job: fingerprint every QUALIFIED candidate, insert
 * unseen (watch_id, entity_id, fingerprint) rows, return how many were new.
 */
export async function diffWatchJob(
  watch: WatchRecord,
  jobId: string,
  client: SupabaseClient,
): Promise<{ fresh: Array<CandidateRow & { fingerprint: string }>; newCount: number }> {
  const { data: candidates, error } = await client
    .from("search_job_candidates")
    .select("candidate_key, entity_id, data")
    .eq("job_id", jobId)
    .eq("state", "QUALIFIED");
  if (error) throw new Error(`[watch-scheduler] candidate load failed: ${error.message}`);

  const { data: seen, error: seenErr } = await client
    .from("watch_seen_matches")
    .select("entity_id, match_fingerprint")
    .eq("watch_id", watch.id);
  if (seenErr) throw new Error(`[watch-scheduler] seen load failed: ${seenErr.message}`);
  const seenSet = new Set((seen ?? []).map((r) => `${r.entity_id}\u0000${r.match_fingerprint}`));

  const fresh: Array<CandidateRow & { fingerprint: string }> = [];
  for (const c of (candidates ?? []) as CandidateRow[]) {
    const fp = fingerprintFor(c, watch.change_mode);
    const entityId = c.entity_id ?? c.candidate_key;
    if (seenSet.has(`${entityId}\u0000${fp}`)) continue;
    seenSet.add(`${entityId}\u0000${fp}`); // de-dupe within the same job too
    fresh.push({ ...c, fingerprint: fp });
  }

  if (fresh.length) {
    const { error: insErr } = await client.from("watch_seen_matches").insert(
      fresh.map((f) => ({
        watch_id: watch.id,
        entity_id: f.entity_id ?? f.candidate_key,
        match_fingerprint: f.fingerprint,
      })),
    );
    if (insErr) throw new Error(`[watch-scheduler] seen insert failed: ${insErr.message}`);
  }
  return { fresh, newCount: fresh.length };
}

async function enqueueWatchNotifications(
  watch: WatchRecord,
  jobId: string,
  newCount: number,
  client: SupabaseClient,
): Promise<WatchDeliveryChannel[]> {
  const channels = (watch.delivery?.channels ?? ["in_app"]).filter(
    (c): c is WatchDeliveryChannel => c === "in_app" || c === "email" || c === "slack",
  );
  const unique = [...new Set(channels)];
  const title = `Scrapy found ${newCount} new match${newCount === 1 ? "" : "es"}`;
  const body = `Watch "${watch.name || watch.query}" found ${newCount} new match${
    newCount === 1 ? "" : "es"
  } for "${watch.query}".`;
  const notified: WatchDeliveryChannel[] = [];

  for (const channel of unique) {
    const payload: Record<string, unknown> = {
      connection_id: null,
      watch_id: watch.id,
      job_id: jobId,
      matches: newCount,
      title,
      body,
    };
    if (channel !== "in_app") {
      const { data: conn } = await client
        .from("notification_connections")
        .select("id, enabled")
        .eq("user_id", watch.user_id)
        .eq("type", channel)
        .eq("enabled", true)
        .limit(1)
        .maybeSingle();
      if (!conn) continue; // no enabled connection for this channel — skip, don't fail the run
      payload.connection_id = conn.id;
    }
    await enqueueNotification(
      {
        idempotencyKey: `watch:${watch.id}:${jobId}:${channel}`,
        userId: watch.user_id,
        channel,
        payload,
      },
      client,
    );
    notified.push(channel);
  }
  return notified;
}

/**
 * Process one completed watch-mode job. Safe to call twice: the icp
 * last_job_id stamp makes the second call a no-op.
 */
export async function processWatchJob(
  jobId: string,
  client: SupabaseClient = getAdmin(),
): Promise<WatchDiffResult | null> {
  const { data: job } = await client
    .from("search_jobs")
    .select("id, watch_id, mode, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.mode !== "watch") return null;
  if (job.status !== "completed") {
    return { watchId: "", jobId, newCount: 0, notifiedChannels: [], skipped: "not_terminal" };
  }
  const { data: camp } = await client
    .from("campaigns")
    .select("id, user_id, name, query, project_id, change_mode, delivery, thesis, icp")
    .eq("id", job.watch_id as string)
    .maybeSingle();
  if (!camp) {
    return { watchId: "", jobId, newCount: 0, notifiedChannels: [], skipped: "no_watch" };
  }
  const icp = (camp.icp ?? {}) as WatchIcp;
  if (icp.last_job_id === jobId) {
    return { watchId: camp.id, jobId, newCount: 0, notifiedChannels: [], skipped: "already_processed" };
  }

  const watch: WatchRecord = {
    id: camp.id,
    user_id: camp.user_id,
    name: camp.name,
    query: camp.query,
    project_id: camp.project_id,
    change_mode: (camp.change_mode ?? "new_entity") as WatchChangeMode,
    delivery: (camp.delivery ?? null) as WatchRecord["delivery"],
    thesis: (camp.thesis ?? null) as SearchSpec | null,
    icp,
  };

  const { newCount } = await diffWatchJob(watch, jobId, client);
  const notifiedChannels =
    newCount > 0 ? await enqueueWatchNotifications(watch, jobId, newCount, client) : [];
  // Outbox intents were just written — make sure the drain ticker is alive
  // on this instance ("processOutbox after watch jobs").
  if (newCount > 0) ensureNotificationTickerStarted();

  const nowIso = new Date().toISOString();
  const { error: updErr } = await client
    .from("campaigns")
    .update({
      icp: {
        ...icp,
        last_job_id: jobId,
        last_run_at: nowIso,
        last_results_count: newCount,
        last_error: null,
      },
      last_run_at: nowIso,
    })
    .eq("id", camp.id);
  if (updErr) throw new Error(`[watch-scheduler] icp update failed: ${updErr.message}`);

  return { watchId: camp.id, jobId, newCount, notifiedChannels };
}

/** One poller tick: every completed watch job not yet stamped in its icp. */
export async function processCompletedWatchJobs(
  client: SupabaseClient = getAdmin(),
  limit = 25,
): Promise<WatchDiffResult[]> {
  const { data: jobs, error } = await client
    .from("search_jobs")
    .select("id")
    .eq("mode", "watch")
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[watch-scheduler] completed poll failed: ${error.message}`);
  const results: WatchDiffResult[] = [];
  for (const j of jobs ?? []) {
    const r = await processWatchJob(j.id as string, client);
    if (r && !r.skipped) results.push(r);
  }
  return results;
}

let pollerStarted = false;

/** Lazy 60s singleton — the ONLY WS5 hook into job completion. */
export function ensureWatchPollerStarted(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  const timer = setInterval(() => {
    void processCompletedWatchJobs().catch((err) => {
      console.warn("[watch-scheduler] tick failed:", err instanceof Error ? err.message : err);
    });
  }, 60_000);
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}

// ---------------------------------------------------------------------------
// Cron: run due watches for ALL users (service role, admin client)
// ---------------------------------------------------------------------------

export async function runDueWatchesForAllUsers(
  client: SupabaseClient = getAdmin(),
): Promise<{ ran: number; skippedUsers: number }> {
  ensureJobWorkerStarted();
  ensureWatchPollerStarted();
  ensureNotificationTickerStarted();

  const { data: camps, error } = await client
    .from("campaigns")
    .select("id, user_id, name, query, project_id, change_mode, delivery, thesis, icp, last_run_at")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`[watch-scheduler] cron campaign load failed: ${error.message}`);
  const watches = (camps ?? []) as Array<WatchRecord & { last_run_at: string | null }>;

  // Free-plan gate per user (checked once; never charged — one run = one job).
  const userGate = new Map<string, boolean>();
  let skippedUsers = 0;
  let ran = 0;
  const slot = scheduleSlotFor();

  for (const camp of watches) {
    if (!watchIsDue(camp)) continue;
    let allowed = userGate.get(camp.user_id);
    if (allowed === undefined) {
      allowed = await userWithinFreeQuota(client, camp.user_id);
      userGate.set(camp.user_id, allowed);
      if (!allowed) skippedUsers += 1;
    }
    if (!allowed) continue;

    const job = await createWatchJob(camp as WatchRecord, camp.user_id, { slot, client });
    const icp = (camp.icp ?? {}) as WatchIcp;
    await client
      .from("campaigns")
      .update({ icp: { ...icp, last_scheduled_at: slot } })
      .eq("id", camp.id);
    ran += 1;
    void job; // existing-slot conflicts already resolved inside createWatchJob
  }
  return { ran, skippedUsers };
}

async function userWithinFreeQuota(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data: profile } = await client
    .from("profiles")
    .select("plan, email, searches_used, searches_reset_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return true;
  const { isOwnerEmail } = await import("@/lib/owner");
  if (isOwnerEmail((profile.email as string | null) ?? "")) return true;
  if (profile.plan !== "free") return true;
  // Reset window rolled over → quota is fresh.
  const resetAt = profile.searches_reset_at ? new Date(profile.searches_reset_at as string) : new Date(0);
  const used = resetAt.getTime() < Date.now() - 86_400_000 ? 0 : Number(profile.searches_used ?? 0);
  return used < 5;
}
