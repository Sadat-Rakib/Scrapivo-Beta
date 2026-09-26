import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { UnderstandingFrame } from "@/lib/understanding/frame";

async function researchWorker<T>(path: string, init: RequestInit): Promise<T> {
  const base = process.env.BROWSER_WORKER_URL?.replace(/\/$/, "");
  const token = process.env.BROWSER_WORKER_TOKEN;
  if (!base || !token) throw new Error("RESEARCH_SERVICE_UNAVAILABLE");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(125_000),
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "RESEARCH_SERVICE_UNAVAILABLE");
  return value;
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
  }));

export const getResearchSession = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}?ownerId=${encodeURIComponent(context.userId)}`, { method: "GET" }));

export const getResearchEvents = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.extend({ after: z.number().int().min(0).default(0) }).parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}/events?ownerId=${encodeURIComponent(context.userId)}&after=${data.after}`, { method: "GET" }));

export const continueResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}/continue`, {
    method: "POST",
    body: JSON.stringify({ ownerId: context.userId }),
  }));

export const cancelResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchWorker(`/research/${encodeURIComponent(data.sessionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ ownerId: context.userId }),
  }));

export const getResearchAgentDiscoverFlag = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async () => ({ enabled: process.env.USE_RESEARCH_AGENT_DISCOVER === "true" }));
