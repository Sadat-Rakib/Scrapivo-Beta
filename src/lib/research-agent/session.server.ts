import { ResearchOrchestrator } from "./orchestrator.server";
import type { ResearchEvent, ResearchResult, RetrievalPlan } from "./types";

export type ResearchSessionStatus = "running" | "done" | "cancelled" | "failed";

export interface ResearchSessionSnapshot {
  id: string;
  ownerId: string;
  scopeId: string;
  status: ResearchSessionStatus;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  events: ResearchEvent[];
  result: ResearchResult | null;
  error: string | null;
}

type SessionRecord = ResearchSessionSnapshot & {
  plan: RetrievalPlan;
  controller: AbortController;
  subscribers: Set<(event: ResearchEvent) => void>;
};

export class ResearchSessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly activeByScope = new Map<string, string>();

  constructor(private readonly orchestrator = new ResearchOrchestrator()) {}

  start(args: { ownerId: string; scopeId: string; plan: RetrievalPlan; continuationToken?: string | null }): ResearchSessionSnapshot {
    const activeId = this.activeByScope.get(`${args.ownerId}:${args.scopeId}`);
    if (activeId) this.cancel(activeId, args.ownerId);
    const id = `research-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      ownerId: args.ownerId,
      scopeId: args.scopeId,
      plan: args.plan,
      status: "running",
      createdAt: now,
      updatedAt: now,
      eventCount: 0,
      events: [],
      result: null,
      error: null,
      controller: new AbortController(),
      subscribers: new Set(),
    };
    this.sessions.set(id, record);
    this.activeByScope.set(`${args.ownerId}:${args.scopeId}`, id);
    void this.execute(record, args.continuationToken ?? null);
    return this.snapshot(record);
  }

  continue(id: string, ownerId: string): ResearchSessionSnapshot {
    const prior = this.requireOwned(id, ownerId);
    if (!prior.result?.continuationToken) throw new Error("RESEARCH_SESSION_NOT_CONTINUABLE");
    return this.start({
      ownerId,
      scopeId: prior.scopeId,
      plan: prior.plan,
      continuationToken: prior.result.continuationToken,
    });
  }

  cancel(id: string, ownerId: string): ResearchSessionSnapshot {
    const record = this.requireOwned(id, ownerId);
    if (record.status === "running") {
      record.controller.abort();
      record.status = "cancelled";
      record.updatedAt = new Date().toISOString();
    }
    return this.snapshot(record);
  }

  get(id: string, ownerId: string): ResearchSessionSnapshot {
    return this.snapshot(this.requireOwned(id, ownerId));
  }

  subscribe(id: string, ownerId: string, listener: (event: ResearchEvent) => void): () => void {
    const record = this.requireOwned(id, ownerId);
    record.subscribers.add(listener);
    return () => record.subscribers.delete(listener);
  }

  stream(id: string, ownerId: string, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
    const record = this.requireOwned(id, ownerId);
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (event: ResearchEvent) => controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        for (const event of record.events) send(event);
        if (record.status !== "running") {
          controller.close();
          return;
        }
        const unsubscribe = this.subscribe(id, ownerId, (event) => {
          send(event);
          if (event.type === "DONE" || event.type === "CANCELLED") {
            unsubscribe();
            controller.close();
          }
        });
        signal?.addEventListener("abort", () => {
          unsubscribe();
          controller.close();
        }, { once: true });
      },
    });
  }

  private async execute(record: SessionRecord, token: string | null): Promise<void> {
    try {
      const result = await this.orchestrator.run({
        plan: record.plan,
        sessionId: record.id,
        continuationToken: token,
        signal: record.controller.signal,
        onEvent: (event) => this.recordEvent(record, event),
      });
      record.result = result;
      record.status = result.cancelled ? "cancelled" : "done";
    } catch (error) {
      record.status = record.controller.signal.aborted ? "cancelled" : "failed";
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      record.updatedAt = new Date().toISOString();
      const scopeKey = `${record.ownerId}:${record.scopeId}`;
      if (this.activeByScope.get(scopeKey) === record.id) this.activeByScope.delete(scopeKey);
    }
  }

  private recordEvent(record: SessionRecord, event: ResearchEvent): void {
    record.events.push(event);
    if (record.events.length > 2_000) record.events.splice(0, record.events.length - 2_000);
    record.eventCount += 1;
    record.updatedAt = event.timestamp;
    for (const subscriber of record.subscribers) subscriber(event);
  }

  private requireOwned(id: string, ownerId: string): SessionRecord {
    const record = this.sessions.get(id);
    if (!record || record.ownerId !== ownerId) throw new Error("RESEARCH_SESSION_NOT_FOUND");
    return record;
  }

  private snapshot(record: SessionRecord): ResearchSessionSnapshot {
    return {
      id: record.id,
      ownerId: record.ownerId,
      scopeId: record.scopeId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      eventCount: record.eventCount,
      events: [...record.events],
      result: record.result,
      error: record.error,
    };
  }
}

export const researchSessions = new ResearchSessionRegistry();
