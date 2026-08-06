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
    z
      .object({
        id: z.string(),
        status: z.string().optional(),
        notes: z.string().optional(),
        outreach_dm: z.string().optional(),
        outreach_email_subject: z.string().optional(),
        outreach_email_body: z.string().optional(),
        outreach_call: z.string().optional(),
        contact_name: z.string().max(200).nullable().optional(),
        contact_email: z.string().max(200).nullable().optional(),
        contact_phone: z.string().max(80).nullable().optional(),
        contact_company: z.string().max(200).nullable().optional(),
        contact_meta: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("saved_leads").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PIPELINE_STAGES = ["saved", "contacted", "replied", "won", "lost", "ignored"] as const;

export const setPipelineStage = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string(),
        status: z.enum(PIPELINE_STAGES),
        lead_url: z.string().max(2000).optional(),
        lead_title: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("saved_leads")
      .update({ status: data.status })
      .eq("id", data.id)
      .select("id, full_post_url, title, status")
      .single();
    if (error) throw new Error(error.message);

    const url = data.lead_url || row.full_post_url;
    await supabase.from("lead_outcome").insert({
      user_id: userId,
      lead_url: url,
      lead_title: data.lead_title || row.title || null,
      outcome: data.status,
      metadata: { saved_lead_id: data.id },
    });

    const { error: actErr } = await supabase.from("lead_activity").insert({
      user_id: userId,
      saved_lead_id: data.id,
      lead_url: url,
      kind: "stage_change",
      detail: `Moved to ${data.status}`,
      metadata: { status: data.status },
    });
    if (actErr) console.warn("[crm] lead_activity insert", actErr.message);

    return { ok: true, status: data.status };
  });

export const saveLeadContact = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string(),
        contact_name: z.string().max(200).optional(),
        contact_email: z.string().max(200).optional(),
        contact_phone: z.string().max(80).optional(),
        contact_company: z.string().max(200).optional(),
        contact_meta: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { id, ...contact } = data;
    const { data: row, error } = await supabase
      .from("saved_leads")
      .update(contact)
      .eq("id", id)
      .select("id, full_post_url, contact_email, contact_name")
      .single();
    if (error) throw new Error(error.message);

    const bits = [
      contact.contact_name,
      contact.contact_email,
      contact.contact_phone,
      contact.contact_company,
    ].filter(Boolean);
    await supabase.from("lead_activity").insert({
      user_id: userId,
      saved_lead_id: id,
      lead_url: row.full_post_url,
      kind: "contact_saved",
      detail: bits.length ? `Contact saved: ${bits.join(" · ")}` : "Contact saved",
      metadata: contact,
    });

    return { ok: true };
  });

export const listLeadActivity = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        saved_lead_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("lead_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data?.limit ?? 40);
    if (data?.saved_lead_id) q = q.eq("saved_lead_id", data.saved_lead_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const logLeadActivity = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        saved_lead_id: z.string().optional(),
        lead_url: z.string().max(2000).optional(),
        kind: z.string().min(1).max(40),
        detail: z.string().max(500).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("lead_activity").insert({
      user_id: context.userId,
      saved_lead_id: data.saved_lead_id ?? null,
      lead_url: data.lead_url ?? null,
      kind: data.kind,
      detail: data.detail ?? null,
      metadata: data.metadata ?? {},
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const PIPELINE_STAGE_LABELS: Record<(typeof PIPELINE_STAGES)[number], string> = {
  saved: "Saved",
  contacted: "Contacted",
  replied: "Replied",
  won: "Won",
  lost: "Lost",
  ignored: "Ignored",
};

export { PIPELINE_STAGES };

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