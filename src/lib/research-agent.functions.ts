import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { UnderstandingFrame } from "@/lib/understanding/frame";
import { retrievalPlanFromInputs } from "@/lib/research-agent/plan";
import { researchSessions } from "@/lib/research-agent/session.server";

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
  .handler(async ({ data, context }) => {
    const plan = retrievalPlanFromInputs({ spec: data.spec, frame: data.frame ?? null });
    const session = researchSessions.start({ ownerId: context.userId, scopeId: data.scopeId, plan });
    return { sessionId: session.id, status: session.status, targetQuantity: plan.targetQuantity };
  });

export const getResearchSession = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchSessions.get(data.sessionId, context.userId));

export const continueResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => {
    const session = researchSessions.continue(data.sessionId, context.userId);
    return { sessionId: session.id, status: session.status };
  });

export const cancelResearchSession = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((value: unknown) => SessionInput.parse(value))
  .handler(async ({ data, context }) => researchSessions.cancel(data.sessionId, context.userId));
