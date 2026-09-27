/**
 * Channel adapters (Workstream 6). One class per NotificationChannelType.
 *
 * Outcome honesty contract:
 * - delivered        — the provider confirmed receipt.
 * - delivery_unknown — the request may or may not have landed (timeout /
 *   connection reset after the request was sent, worker died mid-send).
 *   NEVER auto-retried: a retry could double-deliver.
 * - failed           — a definitive provider rejection (non-2xx, validation
 *   error). Safe to retry with backoff.
 *
 * The email adapter reuses the outreach TRANSPORT (resendSendEmail) only —
 * no outreach templates, quotas, or compliance logic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resendSendEmail, appBaseUrl } from "@/lib/outreach/resend.server";
import type { NotificationChannel, OutboxNotification } from "./types";

// ---------------------------------------------------------------------------
// in_app — writes the in-app feed; success is local, so it is always definite.
// ---------------------------------------------------------------------------

export class InAppNotificationChannel implements NotificationChannel {
  readonly type = "in_app" as const;

  constructor(private supabase: SupabaseClient) {}

  async send(n: OutboxNotification): Promise<{ status: "delivered" | "failed"; error?: string }> {
    const { error } = await this.supabase.from("in_app_notifications").insert({
      user_id: n.userId,
      title: n.title,
      body: n.body,
      payload: n.payload,
    });
    if (error) return { status: "failed", error: error.message };
    return { status: "delivered" };
  }
}

// ---------------------------------------------------------------------------
// email — via the existing Resend transport. A thrown network error means we
// never saw an HTTP response, so the remote outcome is unknown.
// ---------------------------------------------------------------------------

const NOTIFY_FROM = process.env.SCRAPIVO_NOTIFY_FROM || "Scrapivo <onboarding@resend.dev>";

export class EmailNotificationChannel implements NotificationChannel {
  readonly type = "email" as const;

  constructor(private to: string) {}

  async send(n: OutboxNotification): Promise<{ status: "delivered" | "delivery_unknown" | "failed"; error?: string }> {
    const matches = typeof n.payload.matches === "number" ? n.payload.matches : null;
    const subject =
      (typeof n.payload.email_subject === "string" && n.payload.email_subject) ||
      n.title ||
      `Scrapy found ${matches ?? "new"} new matches`;
    const unsubscribeUrl = `${appBaseUrl()}/settings/notifications`;
    try {
      const sent = await resendSendEmail({
        from: NOTIFY_FROM,
        to: this.to,
        subject,
        text: n.body,
        unsubscribeUrl,
      });
      if ("error" in sent) return { status: "failed", error: sent.error };
      return { status: "delivered" };
    } catch (err) {
      // Fetch threw without an HTTP response — the request may have reached
      // the provider. Honest outcome: unknown, never retried.
      return {
        status: "delivery_unknown",
        error: err instanceof Error ? err.message : "email transport network failure",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// slack — webhook POST with a hard 10s timeout.
// ---------------------------------------------------------------------------

export class SlackWebhookChannel implements NotificationChannel {
  readonly type = "slack" as const;

  constructor(private webhookUrl: string) {}

  async send(n: OutboxNotification): Promise<{ status: "delivered" | "delivery_unknown" | "failed"; error?: string }> {
    let res: Response;
    try {
      res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${n.title}*\n${n.body}` }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // Timeout / ECONNRESET after the request was sent — ambiguous.
      return {
        status: "delivery_unknown",
        error: err instanceof Error ? err.message : "slack webhook network failure",
      };
    }
    if (!res.ok) {
      return { status: "failed", error: `Slack webhook HTTP ${res.status}` };
    }
    return { status: "delivered" };
  }
}
