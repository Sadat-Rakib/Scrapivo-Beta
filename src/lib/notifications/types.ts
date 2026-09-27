/**
 * Notification channel contract (Workstream 6). Design FROZEN.
 *
 * A channel adapter turns one outbox intent into one delivery attempt and
 * reports an honest outcome: delivered (provider confirmed), delivery_unknown
 * (the request may or may not have landed — ambiguity is NOT failure and is
 * never auto-retried), or failed (deterministic provider rejection).
 */
export type NotificationChannelType = "in_app" | "email" | "slack";

export type NotificationDeliveryStatus = "delivered" | "delivery_unknown" | "failed";

export interface OutboxNotification {
  idempotencyKey: string;
  userId: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

export interface NotificationChannel {
  readonly type: NotificationChannelType;
  send(notification: OutboxNotification): Promise<{
    status: NotificationDeliveryStatus;
    error?: string;
  }>;
}
