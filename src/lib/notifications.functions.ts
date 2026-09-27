/**
 * Notification server fns (Workstream 6). All requireMyAuth; every read/write
 * is scoped to context.userId. Credentials are NEVER returned to clients —
 * list fns project only {id, type, display_name, enabled}.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { encryptCredentials, notificationsKeyConfigured } from "@/lib/notifications/crypto.server";
import { enqueueNotification, ensureNotificationTickerStarted, processOutbox } from "@/lib/notifications/outbox.server";
import { getAdmin } from "@/integrations/my-supabase/admin.server";

const CreateSlack = z.object({
  webhookUrl: z
    .string()
    .url()
    .regex(/^https:\/\/hooks\.slack\.com\//, "Must be a Slack webhook URL (https://hooks.slack.com/…)"),
  displayName: z.string().min(1).max(120).optional(),
});

const CreateEmail = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(120).optional(),
});

const ConnectionId = z.object({ id: z.string().uuid() });

const CONNECTION_COLUMNS = "id, type, display_name, enabled, created_at";

// ---------------------------------------------------------------------------
// listConnections — shape only, no credentials
// ---------------------------------------------------------------------------

export const listConnections = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    ensureNotificationTickerStarted();
    const { data, error } = await context.supabase
      .from("notification_connections")
      .select(CONNECTION_COLUMNS)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------------------------------------------------------------------------
// createSlackConnection / createEmailConnection
// ---------------------------------------------------------------------------

function keyMissing(): never {
  throw new Error(
    "Cannot save connection: the deployment has no SCRAPIVO_NOTIFICATIONS_KEY configured. Ask the operator to set a 32-byte hex key.",
  );
}

export const createSlackConnection = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => CreateSlack.parse(d))
  .handler(async ({ data, context }) => {
    if (!notificationsKeyConfigured()) keyMissing();
    const encrypted = encryptCredentials({ webhook_url: data.webhookUrl });
    const { data: row, error } = await context.supabase
      .from("notification_connections")
      .insert({
        user_id: context.userId,
        type: "slack",
        encrypted_credentials: encrypted,
        display_name: data.displayName?.trim() || "Slack",
      })
      .select(CONNECTION_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => CreateEmail.parse(d))
  .handler(async ({ data, context }) => {
    if (!notificationsKeyConfigured()) keyMissing();
    const encrypted = encryptCredentials({ email: data.email.toLowerCase() });
    const { data: row, error } = await context.supabase
      .from("notification_connections")
      .insert({
        user_id: context.userId,
        type: "email",
        encrypted_credentials: encrypted,
        display_name: data.displayName?.trim() || data.email,
      })
      .select(CONNECTION_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------------------------------------------------------------------------
// testConnection — one real test intent through the outbox (unique key), then
// an immediate processing tick so the user gets fast feedback.
// ---------------------------------------------------------------------------

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => ConnectionId.parse(d))
  .handler(async ({ data, context }) => {
    ensureNotificationTickerStarted();
    const admin = getAdmin();
    const { data: conn } = await admin
      .from("notification_connections")
      .select("id, user_id, type, enabled")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connection not found");
    if (!conn.enabled) throw new Error("Connection is disabled");

    const key = `test:${context.userId}:${data.id}:${Date.now()}`;
    await enqueueNotification({
      idempotencyKey: key,
      userId: context.userId,
      channel: conn.type as "email" | "slack" | "in_app",
      payload: {
        connection_id: data.id,
        title: "Test notification",
        body: "This is a test notification from Scrapivo. If you can read this, the channel works.",
        matches: 0,
      },
    });
    await processOutbox(5, admin);
    const { data: outboxRow } = await admin
      .from("notification_outbox")
      .select("status, last_error")
      .eq("idempotency_key", key)
      .maybeSingle();
    return { ok: true, status: outboxRow?.status ?? "pending", error: outboxRow?.last_error ?? null };
  });

// ---------------------------------------------------------------------------
// deleteConnection
// ---------------------------------------------------------------------------

export const deleteConnection = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => ConnectionId.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// in-app feed
// ---------------------------------------------------------------------------

export const listInAppNotifications = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    ensureNotificationTickerStarted();
    const { data, error } = await context.supabase
      .from("in_app_notifications")
      .select("id, title, body, payload, read_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markInAppRead = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("in_app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
