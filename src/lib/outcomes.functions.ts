// Task 4.2 — Scoring feedback hook (STRUCTURE ONLY, no tuning logic).
//
// Plumbing so we can eventually track which leads led to real replies/outcomes
// and tune intent-scorer weights against real results later. This pass only
// makes the outcome data land somewhere (the lead_outcome table); the tuning
// logic itself is intentionally NOT built here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

const OUTCOMES = ["saved", "contacted", "replied", "won", "lost", "ignored"] as const;

export const recordLeadOutcome = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lead_url: z.string().min(1).max(2000),
        lead_title: z.string().max(500).optional(),
        outcome: z.enum(OUTCOMES),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("lead_outcome")
      .insert({
        user_id: userId,
        lead_url: data.lead_url,
        lead_title: data.lead_title ?? null,
        outcome: data.outcome,
        metadata: data.metadata ?? {},
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listLeadOutcomes = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("lead_outcome")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
