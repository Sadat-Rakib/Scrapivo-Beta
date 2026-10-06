import { describe, expect, it } from "vitest";
import { researchWorkerResponseSchemas } from "./research-agent.functions";

const event = {
  sessionId: "research-1",
  timestamp: "2026-10-06T00:00:00.000Z",
  type: "RESEARCH_STARTED",
  phase: "UNDERSTANDING",
  internal: { source: "worker", retry: false, count: 1 },
  message: "Research started.",
  domain: null,
  screenshotRef: null,
  candidateCount: 0,
};

const result = {
  sessionId: "research-1",
  plan: { entity: "company", location: "Windhoek", targetQuantity: 5 },
  candidates: [{ id: "candidate-1", row: { title: "Solar Co", website_url: "https://solar.example" }, state: "QUALIFIED" }],
  events: [event],
  needsMore: false,
  exhausted: true,
  cancelled: false,
  continuationToken: null,
  metrics: { storedCandidates: 1, totalLatencyMs: 42 },
};

describe("research worker response contracts", () => {
  it("keeps every serialized session, event, result, and cursor field", () => {
    const snapshot = {
      id: "research-1",
      ownerId: "user-1",
      scopeId: "discover",
      status: "done",
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:01.000Z",
      eventCount: 1,
      events: [event],
      result,
      error: null,
    };
    const events = { events: [event], nextCursor: 1, sessionStatus: "done", done: true, result, error: null };

    expect(researchWorkerResponseSchemas.start.parse({ sessionId: "research-1", status: "running", targetQuantity: 5 })).toEqual({ sessionId: "research-1", status: "running", targetQuantity: 5 });
    expect(researchWorkerResponseSchemas.continue.parse({ sessionId: "research-2", status: "running" })).toEqual({ sessionId: "research-2", status: "running" });
    expect(researchWorkerResponseSchemas.session.parse(snapshot)).toEqual(snapshot);
    expect(researchWorkerResponseSchemas.events.parse(events)).toEqual(events);
  });

  it("rejects malformed worker envelopes before server-function serialization", () => {
    expect(() => researchWorkerResponseSchemas.start.parse({ sessionId: "research-1", status: "running", targetQuantity: 0 })).toThrow();
    expect(() => researchWorkerResponseSchemas.events.parse({ events: [], nextCursor: -1, sessionStatus: "done", done: true, result: null, error: null })).toThrow();
  });
});
