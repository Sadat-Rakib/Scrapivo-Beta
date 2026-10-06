import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { UnderstandingFrame } from "@/lib/understanding/frame";
import type { JsonValue } from "@/lib/research-agent/types";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(JsonValueSchema),
]));

const SessionStatus = z.enum(["running", "done", "cancelled", "failed"]);
const ResearchEventResponse = z.object({
  sessionId: z.string(),
  timestamp: z.string(),
  type: z.string(),
  phase: z.string(),
  internal: z.record(JsonValueSchema),
  message: z.string(),
  domain: z.string().nullable().optional(),
  screenshotRef: z.string().nullable().optional(),
  candidateCount: z.number().optional(),
});
const ResearchResultResponse = z.object({
  sessionId: z.string(),
  plan: z.record(JsonValueSchema),
  candidates: z.array(z.record(JsonValueSchema)),
  events: z.array(ResearchEventResponse),
  needsMore: z.boolean(),
  exhausted: z.boolean(),
  cancelled: z.boolean(),
  continuationToken: z.string().nullable(),
  metrics: z.record(JsonValueSchema),
});
const ResearchSessionResponse = z.object({
  id: z.string(),
  ownerId: z.string(),
  scopeId: z.string(),
  status: SessionStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  eventCount: z.number().int().nonnegative(),
  events: z.array(ResearchEventResponse),
  result: ResearchResultResponse.nullable(),
  error: z.string().nullable(),
});
const StartResearchResponse = z.object({
  sessionId: z.string(),
  status: SessionStatus,
  targetQuantity: z.number().int().positive(),
});
const ContinueResearchResponse = z.object({
  sessionId: z.string(),
  status: SessionStatus,
});
const ResearchEventsResponse = z.object({
  events: z.array(ResearchEventResponse),
  nextCursor: z.number().int().nonnegative(),
  sessionStatus: SessionStatus,
  done: z.boolean(),
  result: ResearchResultResponse.nullable(),
  error: z.string().nullable(),
});
const WorkerError = z.object({ error: z.string().optional() });

export const researchWorkerResponseSchemas = {
  start: StartResearchResponse,
  session: ResearchSessionResponse,
  events: ResearchEventsResponse,
  continue: ContinueResearchResponse,
};

async function researchWorker<T>(path: string, init: RequestInit, responseSchema: z.ZodType<T>): Promise<T> {
  const base = process.env.BROWSER_WORKER_URL?.replace(/\/$/, "");
  const token = process.env.BROWSER_WORKER_TOKEN;
  if (!base || !token) throw new Error("RESEARCH_SERVICE_UNAVAILABLE");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(125_000),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(WorkerError.safeParse(value).data?.error || "RESEARCH_SERVICE_UNAVAILABLE");
  return responseSchema.parse(value);
}

const SpecInput = z.custom<SearchSpec>((value) => {
  if (!value || typeof value !== "object") return false;
  const spec = value as Partial<SearchSpec>;
  return typeof spec.raw_query === "string" && typeof spec.entity === "string" && Array.isArray(spec.criteria);
}, "Invalid SearchSpec");

const StartInput = z.object({
  spec: SpecInput,
  frame: z.custom<UnderstandingFrame>().nullable().optional(),
  scopeId: z.string().min(1).max(120),
});

const SessionInput = z.object({ sessionId: z.string().min(12).max(100) });

export const startResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => StartInput.parse(value))
  .handler(async ({ data, context }) => researchWorker("/research/start", {
    method: "POST",
    body: JSON.stringify({ ownerId: context.userId, ...data }),
  }, StartResearchResponse));

export const getResearchSession = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}?ownerId=${encodeURIComponent(context.userId)}`, { method: "GET" }, ResearchSessionResponse));

export const getResearchEvents = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.extend({ after: z.number().int().min(0).default(0) }).parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}/events?ownerId=${encodeURIComponent(context.userId)}&after=${data.after}`, { method: "GET" }, ResearchEventsResponse));

export const continueResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}/continue`, {
    method: "POST",
    body: JSON.stringify({ ownerId: context.userId }),
  }, ContinueResearchResponse));

export const cancelResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ ownerId: context.userId }),
  }, ResearchSessionResponse));

export const getResearchAgentDiscoverFlag = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async () => ({ enabled: process.env.USE_RESEARCH_AGENT_DISCOVER === "true" }));
