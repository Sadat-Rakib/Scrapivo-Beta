import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

const LeadShape = z.object({
  source: z.string(),
  platform: z.string(),
  title: z.string(),
  snippet: z.string(),
  full_post_url: z.string(),
  author: z.string().optional(),
  author_url: z.string().optional(),
  posted_at: z.string().optional(),
  engagement: z.number().optional(),
  tier: z.string().optional(),
  score: z.number().optional(),
  is_decision_maker: z.boolean().optional(),
});

export const saveLead = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => LeadShape.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("saved_leads")
      .upsert(
        { ...data, user_id: userId, status: "saved" },
        { onConflict: "user_id,full_post_url" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listSavedLeads = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("saved_leads")
      .select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).sort((a: any, b: any) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  });

export const deleteSavedLead = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("saved_leads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateSavedLead = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string(),
      status: z.string().optional(),
      notes: z.string().optional(),
      outreach_dm: z.string().optional(),
      outreach_email_subject: z.string().optional(),
      outreach_email_body: z.string().optional(),
      outreach_call: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("saved_leads").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listHistory = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("search_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });