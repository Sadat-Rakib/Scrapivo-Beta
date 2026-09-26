/**
 * Conversation transcripts (Step 3): persist every turn's inputs + frozen
 * outputs so nothing is lost on refresh, and history entries reopen exact
 * transcripts. One row per conversation, upserted by conversation_id.
 *
 * Shape mirrors Discover's ConversationTurn 1:1 (results OR counts, ts).
 * Cap 50 turns/conversation (sanitized before save AND before apply).
 * Only New chat starts a new conversation; rows are never deleted by save.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export const MAX_TURNS = 50;
/** Payload guard: transcripts stay well under POST/JSONB limits. */
const MAX_PAYLOAD_BYTES = 900_000;

export interface TranscriptTurn {
  id: string;
  text: string;
  results?: {
    leads: Json[];
    companies: Json[];
    people: Json[];
    local: Json[];
  };
  counts?: { posts: number; companies: number; people: number; local: number };
  ts?: number;
}

/** Pure, unit-tested: cap length, drop malformed turns, never throw. */
export function sanitizeTurns(input: unknown, cap = MAX_TURNS): TranscriptTurn[] {
  if (!Array.isArray(input)) return [];
  const out: TranscriptTurn[] = [];
  for (const t of input) {
    if (!t || typeof t !== "object") continue;
    const row = t as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.text !== "string") continue;
    const clean: TranscriptTurn = { id: row.id, text: row.text };
    if (row.results && typeof row.results === "object") {
      const r = row.results as Record<string, unknown>;
      clean.results = {
        leads: Array.isArray(r.leads) ? r.leads : [],
        companies: Array.isArray(r.companies) ? r.companies : [],
        people: Array.isArray(r.people) ? r.people : [],
        local: Array.isArray(r.local) ? r.local : [],
      };
    } else if (row.counts && typeof row.counts === "object") {
      const c = row.counts as Record<string, unknown>;
      clean.counts = {
        posts: Number(c.posts) || 0,
        companies: Number(c.companies) || 0,
        people: Number(c.people) || 0,
        local: Number(c.local) || 0,
      };
    }
    if (typeof row.ts === "number") clean.ts = row.ts;
    out.push(clean);
  }
  return out.slice(-cap);
}

const turnSchema: z.ZodType<TranscriptTurn> = z.object({
  // Truncate, never throw: a long query must degrade to a saved transcript,
  // not to transcript loss.
  id: z.string().transform((s) => s.slice(0, 120)),
  text: z.string().transform((s) => s.slice(0, 2000)),
  results: z
    .object({
      leads: z.array(z.unknown()),
      companies: z.array(z.unknown()),
      people: z.array(z.unknown()),
      local: z.array(z.unknown()),
    })
    .optional(),
  counts: z
    .object({
      posts: z.number(),
      companies: z.number(),
      people: z.number(),
      local: z.number(),
    })
    .optional(),
  ts: z.number().optional(),
}) as z.ZodType<TranscriptTurn>;

export const saveTranscript = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().min(1).max(120),
        turns: z.array(turnSchema).max(MAX_TURNS + 10),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    let turns = sanitizeTurns(data.turns);
    // Byte cap: drop oldest turns until the payload fits. Newest survive.
    while (
      turns.length > 1 &&
      JSON.stringify(turns).length > MAX_PAYLOAD_BYTES
    ) {
      turns = turns.slice(1);
    }
    const total = turns.reduce(
      (n, t) =>
        n +
        (t.results
          ? t.results.leads.length +
            t.results.companies.length +
            t.results.people.length +
            t.results.local.length
          : (t.counts?.posts ?? 0) +
            (t.counts?.companies ?? 0) +
            (t.counts?.people ?? 0) +
            (t.counts?.local ?? 0)),
      0,
    );
    const payload = {
      user_id: context.userId,
      conversation_id: data.conversationId,
      // Title = most recent turn (what the conversation is about now).
      query: turns[turns.length - 1]?.text ?? "Conversation",
      results_count: total,
      sources_searched: ["discover-transcript"],
      transcript: turns,
    };
    const { error } = await context.supabase
      .from("search_history")
      .upsert(payload, { onConflict: "conversation_id" });
    if (error) {
      // Fallback for RLS setups without UPDATE rights: replace own row.
      // Double-scoped to this user's conversation id; never others' rows.
      const del = await context.supabase
        .from("search_history")
        .delete()
        .eq("user_id", context.userId)
        .eq("conversation_id", data.conversationId);
      if (del.error) throw new Error(del.error.message);
      const ins = await context.supabase.from("search_history").insert(payload);
      if (ins.error) throw new Error(ins.error.message);
    }
    return { ok: true };
  });

export const getTranscript = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z.object({ conversationId: z.string().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ turns: TranscriptTurn[] }> => {
    // User-scoped read: RLS plus explicit user_id match (defense in depth;
    // conversation ids are unguessable but never solely relied upon).
    const { data: row, error } = await context.supabase
      .from("search_history")
      .select("transcript")
      .eq("user_id", context.userId)
      .eq("conversation_id", data.conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { turns: sanitizeTurns((row as { transcript?: unknown } | null)?.transcript) };
  });
