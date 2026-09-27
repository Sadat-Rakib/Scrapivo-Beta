/**
 * Durable notification outbox (Workstream 6).
 *
 * enqueueNotification is the ONLY way an intent enters the pipeline: one row
 * per idempotency_key (UNIQUE + ON CONFLICT DO NOTHING), so duplicate watch
 * completions and retries can never double-notify.
 *
 * processOutbox claims pending work with a per-row compare-and-set (status
 * pending/failed + attempts CAS), dispatches through the channel adapter
 * resolved from notification_connections, and records an honest outcome:
 *   delivered        → final.
 *   delivery_unknown → final, NEVER auto-retried (may have landed).
 *   failed           → available_at pushed out (exponential backoff); retried
 *                      only while attempts < 5.
 * Rows stuck in 'sending' past the staleness window are marked
 * delivery_unknown — the worker died mid-send, so the remote outcome is
 * genuinely unknown and a retry could double-deliver.
 *
 * All writes are service-side (admin client); RLS grants users read-only
 * access to their own outbox rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdmin } from "@/integrations/my-supabase/admin.server";
import { decryptCredentials } from "./crypto.server";
import {
  EmailNotificationChannel,
  InAppNotificationChannel,
  SlackWebhookChannel,
} from "./adapters.server";
import type { NotificationChannel, NotificationChannelType } from "./types";

const OUTBOX = "notification_outbox";
const CONNECTIONS = "notification_connections";

const MAX_ATTEMPTS = 5;
/** A 'sending' row older than this was owned by a dead worker. */
const SENDING_STALE_MS = 5 * 60_000;

export interface EnqueueNotificationInput {
  idempotencyKey: string;
  userId: string;
  channel: NotificationChannelType;
  payload: Record<string, unknown>;
}

/** INSERT ... ON CONFLICT (idempotency_key) DO NOTHING — single internal intent per key. */
export async function enqueueNotification(
  input: EnqueueNotificationInput,
  client: SupabaseClient = getAdmin(),
): Promise<{ enqueued: boolean }> {
  const { error } = await client.from(OUTBOX).insert({
    idempotency_key: input.idempotencyKey,
    user_id: input.userId,
    channel: input.channel,
    payload: input.payload,
  });
  //23505 = idempotency_key already present → intent already recorded.
  if (error && error.code !== "23505") {
    throw new Error(`[notifications outbox] enqueue failed: ${error.message}`);
  }
  return { enqueued: !error };
}

export interface OutboxRunSummary {
  claimed: number;
  delivered: number;
  failed: number;
  unknown: number;
}

/** Test seam: adapters keyed by channel type override connection resolution. */
export type AdapterOverride = Partial<Record<NotificationChannelType, NotificationChannel>>;

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

async function resolveAdapter(
  row: { channel: string; user_id: string; payload: Record<string, unknown> },
  client: SupabaseClient,
  overrides: AdapterOverride,
): Promise<NotificationChannel> {
  const override = overrides[row.channel as NotificationChannelType];
  if (override) return override;

  const type = row.channel as NotificationChannelType;
  if (type === "in_app") return new InAppNotificationChannel(client);

  // email/slack need an enabled connection owned by the same user.
  const connectionId = typeof row.payload.connection_id === "string" ? row.payload.connection_id : null;
  if (!connectionId) throw new Error("payload.connection_id missing for remote channel");
  const { data: conn, error } = await client
    .from(CONNECTIONS)
    .select("id, user_id, type, enabled, encrypted_credentials")
    .eq("id", connectionId)
    .eq("user_id", row.user_id)
    .eq("type", type)
    .maybeSingle();
  if (error) throw new Error(`connection lookup failed: ${error.message}`);
  if (!conn || !conn.enabled) throw new Error(`no enabled ${type} connection for this user`);
  const creds = decryptCredentials<Record<string, string>>(conn.encrypted_credentials);
  if (type === "email") {
    const to = creds.email;
    if (!to) throw new Error("email connection credentials missing 'email'");
    return new EmailNotificationChannel(to);
  }
  const url = creds.webhook_url;
  if (!url) throw new Error("slack connection credentials missing 'webhook_url'");
  return new SlackWebhookChannel(url);
}

/**
 * One processing tick. `client` and `adapters` are injectable for tests;
 * production always uses the service-role admin client.
 */
export async function processOutbox(
  limit = 20,
  client: SupabaseClient = getAdmin(),
  adapters: AdapterOverride = {},
): Promise<OutboxRunSummary> {
  const summary: OutboxRunSummary = { claimed: 0, delivered: 0, failed: 0, unknown: 0 };

  // 1. Recover rows stuck in 'sending' (worker died mid-send) — ambiguous
  //    outcome, final, never retried.
  const staleCutoff = new Date(Date.now() - SENDING_STALE_MS).toISOString();
  await client
    .from(OUTBOX)
    .update({ status: "delivery_unknown", last_error: "sending worker died mid-attempt; remote outcome unknown", updated_at: new Date().toISOString() })
    .eq("status", "sending")
    .lt("updated_at", staleCutoff);

  // 2. Find claimable candidates, then CAS-claim each individually so
  //     concurrent ticks can never double-send one row.
  const nowIso = new Date().toISOString();
  const { data: candidates, error } = await client
    .from(OUTBOX)
    .select("id, attempts")
    .in("status", ["pending", "failed"])
    .lte("available_at", nowIso)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`[notifications outbox] claim select failed: ${error.message}`);

  for (const candidate of candidates ?? []) {
    const attempts = (candidate.attempts as number) + 1;
    const { data: claimed, error: claimErr } = await client
      .from(OUTBOX)
      .update({ status: "sending", attempts, updated_at: nowIso })
      .eq("id", candidate.id as string)
      .in("status", ["pending", "failed"])
      .eq("attempts", candidate.attempts as number)
      .select("id, user_id, channel, payload")
      .maybeSingle();
    if (claimErr) throw new Error(`[notifications outbox] claim failed: ${claimErr.message}`);
    if (!claimed) continue; // lost the race — another worker owns it
    summary.claimed += 1;

    let status: "delivered" | "delivery_unknown" | "failed" = "failed";
    let lastError: string | null = null;
    try {
      const adapter = await resolveAdapter(
        { channel: claimed.channel as string, user_id: claimed.user_id as string, payload: (claimed.payload ?? {}) as Record<string, unknown> },
        client,
        adapters,
      );
      const payload = (claimed.payload ?? {}) as Record<string, unknown>;
      const result = await adapter.send({
        idempotencyKey: candidate.id as string,
        userId: claimed.user_id as string,
        title: typeof payload.title === "string" ? payload.title : "Notification",
        body: typeof payload.body === "string" ? payload.body : "",
        payload,
      });
      status = result.status;
      lastError = result.error ?? null;
    } catch (err) {
      status = "failed"; // deterministic resolution failure — safe to retry
      lastError = err instanceof Error ? err.message : "unknown dispatch error";
    }

    if (status === "delivered") {
      summary.delivered += 1;
      await client
        .from(OUTBOX)
        .update({ status, last_error: null, delivered_at: nowIso, updated_at: nowIso })
        .eq("id", candidate.id as string);
    } else if (status === "delivery_unknown") {
      summary.unknown += 1;
      await client
        .from(OUTBOX)
        .update({ status, last_error: lastError, updated_at: nowIso })
        .eq("id", candidate.id as string);
    } else {
      summary.failed += 1;
      await client
        .from(OUTBOX)
        .update({
          status,
          last_error: lastError,
          // retries are gated by attempts < MAX_ATTEMPTS in the claim query
          available_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
          updated_at: nowIso,
        })
        .eq("id", candidate.id as string);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Lazy 60s ticker — same pattern as jobs/worker.server.ts. Started on the
// first notification server-fn call; also safe to call from the watch poller.
// ---------------------------------------------------------------------------

let tickerStarted = false;

export function ensureNotificationTickerStarted(): void {
  if (tickerStarted) return;
  tickerStarted = true;
  const timer = setInterval(() => {
    void processOutbox().catch((err) => {
      console.warn("[notifications outbox] tick failed:", err instanceof Error ? err.message : err);
    });
  }, 60_000);
  // Never hold the process open just for the ticker.
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}
