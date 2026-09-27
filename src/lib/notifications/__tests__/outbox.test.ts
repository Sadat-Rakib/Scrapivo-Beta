/**
 * Outbox tests (Workstream 6) — offline via a minimal thenable fake of the
 * supabase-js query builder. Covers: idempotent enqueue, honest outcomes
 * (delivery_unknown never retried, failed retried up to the cap), adapter
 * selection by connection type, and user-scoped connection resolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueNotification, processOutbox } from "../outbox.server";
import type { AdapterOverride } from "../outbox.server";
import type { NotificationChannel } from "../types";

// ---------------------------------------------------------------------------
// Minimal supabase-js fake (thenable builder)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Unique keys mirroring the notifications migration. */
const UNIQUE_KEYS: Record<string, string[]> = {
  notification_outbox: ["idempotency_key"],
};

/** notification_outbox column defaults (mimic the DB). */
function outboxColumnDefaults(): Row {
  return {
    status: "pending",
    attempts: 0,
    last_error: null,
    available_at: new Date().toISOString(),
    delivered_at: null,
  };
}

class Builder {
  private op: "select" | "insert" | "update" | "delete" | null = null;
  private values: Row | Row[] | null = null;
  private filters: Array<[string, string, unknown]> = [];
  private want: "none" | "single" | "maybeSingle" = "none";
  private limitN: number | null = null;

  constructor(
    private client: FakeSupabase,
    private table: string,
  ) {}

  select() {
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, "eq", val]);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push([col, "in", vals]);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push([col, "lt", val]);
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push([col, "lte", val]);
    return this;
  }
  isNull(col: string) {
    this.filters.push([col, "is", null]);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  order(_col: string, _opts?: { ascending?: boolean }) {
    return this;
  }
  single() {
    this.want = "single";
    return this;
  }
  maybeSingle() {
    this.want = "maybeSingle";
    return this;
  }

  private matches(rows: Row[]): Row[] {
    let out = rows.filter((r) =>
      this.filters.every(([col, op, val]) => {
        if (op === "eq") return r[col] === val;
        if (op === "in") return (val as unknown[]).includes(r[col]);
        if (op === "lt") return String(r[col]) < String(val);
        if (op === "lte") return String(r[col]) <= String(val);
        if (op === "is") return r[col] === null;
        return false;
      }),
    );
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private exec(): { data: unknown; error: unknown } {
    const rows = this.client.tables[this.table] ?? (this.client.tables[this.table] = []);
    const now = new Date().toISOString();

    if (this.op === "insert") {
      const results: Row[] = [];
      for (const value of (Array.isArray(this.values) ? this.values : [this.values]) as Row[]) {
        const stamped: Row = {
          id: this.client.nextUuid(),
          ...(this.table === "notification_outbox" ? outboxColumnDefaults() : {}),
          ...value,
          created_at: now,
          updated_at: (value.updated_at as string) ?? now,
        };
        const clash = (UNIQUE_KEYS[this.table] ?? []).some((uk) => {
          const cols = uk.split("+");
          if (!cols.every((c) => stamped[c] !== undefined && stamped[c] !== null)) return false;
          return rows.some((r) => cols.every((c) => r[c] === stamped[c]));
        });
        if (clash) {
          return { data: null, error: { code: "23505", message: "duplicate key value" } };
        }
        rows.push(stamped);
        results.push(stamped);
      }
      return { data: this.want === "single" ? results[0] : results, error: null };
    }

    if (this.op === "update") {
      const patched = this.matches(rows);
      for (const row of patched) Object.assign(row, this.values, { updated_at: now });
      if (this.want === "maybeSingle") return { data: patched[0] ?? null, error: null };
      return { data: patched, error: null };
    }
    if (this.op === "delete") {
      const doomed = this.matches(rows);
      for (const row of doomed) rows.splice(rows.indexOf(row), 1);
      return { data: doomed, error: null };
    }

    const out = this.matches(rows);
    if (this.want === "single") return { data: out[0] ?? null, error: out.length ? null : { code: "PGRST116", message: "no rows" } };
    if (this.want === "maybeSingle") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: (v: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>,
    onRejected?: (e: unknown) => TResult2 | PromiseLike<TResult2>,
  ) {
    return Promise.resolve().then(() => this.exec()).then(onFulfilled, onRejected);
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {};
  private seq = 0;
  from(table: string): Builder {
    return new Builder(this, table);
  }
  nextUuid(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";

function fakeAdapter(status: "delivered" | "delivery_unknown" | "failed", error?: string): NotificationChannel & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async send(n: never) {
      calls.push(n);
      return { status, error };
    },
  } as NotificationChannel & { calls: unknown[] };
}

function keyEnv(key: string | undefined) {
  if (key === undefined) delete process.env.SCRAPIVO_NOTIFICATIONS_KEY;
  else process.env.SCRAPIVO_NOTIFICATIONS_KEY = key;
}
const ORIGINAL_KEY = process.env.SCRAPIVO_NOTIFICATIONS_KEY;
const TEST_KEY = "cd".repeat(32);

beforeEach(() => {
  keyEnv(TEST_KEY);
});
afterEach(() => {
  keyEnv(ORIGINAL_KEY);
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outbox enqueue", () => {
  it("duplicate idempotency_key → exactly one intent", async () => {
    const client = new FakeSupabase();
    const a = await enqueueNotification({ idempotencyKey: "watch:w1:j1:in_app", userId: USER, channel: "in_app", payload: { title: "t" } }, client as unknown as SupabaseClient);
    const b = await enqueueNotification({ idempotencyKey: "watch:w1:j1:in_app", userId: USER, channel: "in_app", payload: { title: "t" } }, client as unknown as SupabaseClient);
    expect(a.enqueued).toBe(true);
    expect(b.enqueued).toBe(false);
    expect(client.tables.notification_outbox).toHaveLength(1);
  });
});

describe("outbox processing", () => {
  it("in_app channel inserts the feed row and marks the intent delivered", async () => {
    const client = new FakeSupabase();
    await enqueueNotification({ idempotencyKey: "k1", userId: USER, channel: "in_app", payload: { title: "T", body: "B" } }, client as unknown as SupabaseClient);
    const summary = await processOutbox(10, client as unknown as SupabaseClient);
    expect(summary).toMatchObject({ claimed: 1, delivered: 1 });
    expect(client.tables.in_app_notifications).toHaveLength(1);
    expect(client.tables.notification_outbox![0].status).toBe("delivered");
    expect(client.tables.notification_outbox![0].delivered_at).toBeTruthy();
  });

  it("delivery_unknown is final and NEVER retried", async () => {
    const client = new FakeSupabase();
    const overrides: AdapterOverride = { email: fakeAdapter("delivery_unknown", "timeout after send") };
    await enqueueNotification(
      { idempotencyKey: "k2", userId: USER, channel: "email", payload: { title: "T", connection_id: "c1" } },
      client as unknown as SupabaseClient,
    );
    const first = await processOutbox(10, client as unknown as SupabaseClient, overrides);
    expect(first).toMatchObject({ claimed: 1, unknown: 1 });
    const row = client.tables.notification_outbox![0];
    expect(row.status).toBe("delivery_unknown");

    // Age the row so every claimable gate would pass — it must not be claimed.
    row.available_at = new Date(Date.now() - 60_000).toISOString();
    const second = await processOutbox(10, client as unknown as SupabaseClient, overrides);
    expect(second.claimed).toBe(0);
    expect(client.tables.notification_outbox![0].status).toBe("delivery_unknown");
    expect(client.tables.notification_outbox![0].attempts).toBe(1);
    expect(overrides.email && (overrides.email as NotificationChannel & { calls: unknown[] }).calls).toHaveLength(1);
  });

  it("failed is retried with backoff up to the attempts cap", async () => {
    const client = new FakeSupabase();
    const adapter = fakeAdapter("failed", "Slack webhook HTTP 500");
    const overrides: AdapterOverride = { slack: adapter };
    await enqueueNotification(
      { idempotencyKey: "k3", userId: USER, channel: "slack", payload: { title: "T", connection_id: "c1" } },
      client as unknown as SupabaseClient,
    );

    for (let attempt = 1; attempt <= 5; attempt++) {
      const row = client.tables.notification_outbox![0];
      // Expire the backoff so the claim gate passes.
      row.available_at = new Date(Date.now() - 60_000).toISOString();
      const summary = await processOutbox(10, client as unknown as SupabaseClient, overrides);
      expect(summary.claimed).toBe(1);
      expect(client.tables.notification_outbox![0].attempts).toBe(attempt);
      expect(client.tables.notification_outbox![0].status).toBe("failed");
    }
    expect(adapter.calls).toHaveLength(5);

    // Cap reached: attempts=5 is never claimed again.
    client.tables.notification_outbox![0].available_at = new Date(Date.now() - 60_000).toISOString();
    const summary = await processOutbox(10, client as unknown as SupabaseClient, overrides);
    expect(summary.claimed).toBe(0);
    expect(adapter.calls).toHaveLength(5);
  });

  it("adapter is chosen by the connection type (email vs slack overrides)", async () => {
    const client = new FakeSupabase();
    const email = fakeAdapter("delivered");
    const slack = fakeAdapter("delivered");
    const overrides: AdapterOverride = { email, slack };
    await enqueueNotification({ idempotencyKey: "k4", userId: USER, channel: "email", payload: { title: "E" } }, client as unknown as SupabaseClient);
    await enqueueNotification({ idempotencyKey: "k5", userId: USER, channel: "slack", payload: { title: "S" } }, client as unknown as SupabaseClient);
    const summary = await processOutbox(10, client as unknown as SupabaseClient, overrides);
    expect(summary.delivered).toBe(2);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    expect((email.calls[0] as { title: string }).title).toBe("E");
    expect((slack.calls[0] as { title: string }).title).toBe("S");
  });

  it("email adapter resolves credentials from the OWNER's enabled connection only", async () => {
    const client = new FakeSupabase();
    // Connection belongs to ANOTHER user → must not be used.
    await client
      .from("notification_connections")
      .insert({ id: "c-other", user_id: OTHER_USER, type: "email", enabled: true, encrypted_credentials: "zzz" });
    await enqueueNotification(
      { idempotencyKey: "k6", userId: USER, channel: "email", payload: { title: "T", connection_id: "c-other" } },
      client as unknown as SupabaseClient,
    );
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "m1" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const summary = await processOutbox(10, client as unknown as SupabaseClient);
    expect(summary.delivered).toBe(0);
    expect(summary.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.tables.notification_outbox![0].last_error).toMatch(/no enabled email connection/);

    // Now an owned, enabled connection with encrypted creds resolves and sends.
    const { encryptCredentials } = await import("../crypto.server");
    await client
      .from("notification_connections")
      .insert({
        id: "c-own",
        user_id: USER,
        type: "email",
        enabled: true,
        encrypted_credentials: encryptCredentials({ email: "owner@example.com" }),
      });
    await enqueueNotification(
      { idempotencyKey: "k7", userId: USER, channel: "email", payload: { title: "T2", connection_id: "c-own" } },
      client as unknown as SupabaseClient,
    );
    process.env.RESEND_API_KEY = "test-key";
    const summary2 = await processOutbox(10, client as unknown as SupabaseClient);
    expect(summary2.delivered).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
    const body = JSON.parse(init.body) as { to: string[] };
    expect(body.to[0]).toBe("owner@example.com");
  });

  it("rows stuck in 'sending' are marked delivery_unknown (worker died mid-send)", async () => {
    const client = new FakeSupabase();
    await client.from("notification_outbox").insert({
      idempotency_key: "k8",
      user_id: USER,
      channel: "in_app",
      payload: { title: "T" },
      status: "sending",
      attempts: 1,
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const summary = await processOutbox(10, client as unknown as SupabaseClient);
    expect(summary.claimed).toBe(0);
    const rows = client.tables.notification_outbox!;
    expect(rows[0].status).toBe("delivery_unknown");
  });
});
