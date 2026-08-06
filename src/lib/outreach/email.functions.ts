import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

const LeadId = z.object({
  savedLeadId: z.string().uuid(),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  toEmail: z.string().email().optional(),
});

export const checkEmailGate = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => LeadId.parse(d))
  .handler(async ({ data, context }) => {
    const { previewComplianceGate } = await import("@/lib/outreach/send.server");
    return previewComplianceGate(context.supabase, context.userId, data);
  });

export const sendLeadEmail = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => LeadId.parse(d))
  .handler(async ({ data, context }) => {
    const { sendLeadEmailCore } = await import("@/lib/outreach/send.server");
    const result = await sendLeadEmailCore(context.supabase, context.userId, data);
    if (!result.ok) {
      const msg = result.reasons[0] || result.error || "Send blocked by compliance gate";
      throw new Error(
        msg + (result.reasons.length > 1 ? ` (+${result.reasons.length - 1} more)` : ""),
      );
    }
    return result;
  });

export const getSendQuota = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { countSendsToday } = await import("@/lib/outreach/send.server");
    const { DAILY_SEND_CAP } = await import("@/lib/outreach/resend.server");
    const sentToday = await countSendsToday(context.supabase, context.userId);
    return { sentToday, dailyCap: DAILY_SEND_CAP };
  });

const SeqStart = z.object({
  savedLeadId: z.string().uuid(),
  followUpDelayDays: z.number().int().min(1).max(30).optional(),
  followUpSubject: z.string().max(200).optional(),
  followUpBody: z.string().max(8000).optional(),
});

/** Enroll lead in a light 1-step follow-up sequence after a successful first send. */
export const startEmailSequence = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => SeqStart.parse(d))
  .handler(async ({ data, context }) => {
    const delay = data.followUpDelayDays ?? 3;
    const due = new Date(Date.now() + delay * 86_400_000);

    const { data: seq, error: seqErr } = await context.supabase
      .from("email_sequences")
      .insert({
        user_id: context.userId,
        saved_lead_id: data.savedLeadId,
        name: "follow_up",
        status: "active",
      })
      .select("id")
      .single();
    if (seqErr || !seq) throw new Error(seqErr?.message || "Could not create sequence");

    const { data: lead } = await context.supabase
      .from("saved_leads")
      .select("outreach_email_subject, outreach_email_body")
      .eq("id", data.savedLeadId)
      .maybeSingle();

    const subject =
      data.followUpSubject ||
      (lead?.outreach_email_subject
        ? `Re: ${lead.outreach_email_subject}`
        : "Following up");
    const body =
      data.followUpBody ||
      "Just bumping this in case it got buried — happy to share a short example if useful.";

    const { error: stepErr } = await context.supabase.from("email_sequence_steps").insert({
      sequence_id: seq.id,
      user_id: context.userId,
      step_index: 1,
      delay_days: delay,
      subject,
      body,
      due_at: due.toISOString(),
      status: "pending",
    });
    if (stepErr) throw new Error(stepErr.message);

    return { ok: true, sequenceId: seq.id, dueAt: due.toISOString() };
  });
