// =====================================================================
// Process due email sequence steps (Vercel cron / manual)
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendLeadEmailCore } from "@/lib/outreach/send.server";

const MAX_PER_RUN = 10;

export async function processDueSequenceSteps(
  admin: SupabaseClient,
): Promise<{ claimed: number; sent: number; failed: number; errors: string[] }> {
  const now = new Date().toISOString();
  const { data: steps, error } = await admin
    .from("email_sequence_steps")
    .select("id, sequence_id, user_id, subject, body, status")
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return { claimed: 0, sent: 0, failed: 0, errors: [error.message] };
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const step of steps ?? []) {
    // Claim
    const { data: claimed } = await admin
      .from("email_sequence_steps")
      .update({ status: "sending" })
      .eq("id", step.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: seq } = await admin
      .from("email_sequences")
      .select("id, saved_lead_id, status")
      .eq("id", step.sequence_id)
      .maybeSingle();

    if (!seq || seq.status !== "active") {
      await admin.from("email_sequence_steps").update({ status: "skipped" }).eq("id", step.id);
      continue;
    }

    const result = await sendLeadEmailCore(admin, step.user_id, {
      savedLeadId: seq.saved_lead_id,
      subject: step.subject || undefined,
      body: step.body || undefined,
    });

    if (result.ok) {
      sent += 1;
      await admin
        .from("email_sequence_steps")
        .update({ status: "sent", email_send_id: result.sendId })
        .eq("id", step.id);

      // Mark sequence complete after this follow-up (single-step for now)
      await admin
        .from("email_sequences")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", seq.id);
    } else {
      failed += 1;
      const msg = result.reasons.join("; ");
      errors.push(`${step.id}: ${msg}`);
      await admin.from("email_sequence_steps").update({ status: "failed" }).eq("id", step.id);
      // Pause sequence on gate failure so we don't keep retrying forever
      await admin
        .from("email_sequences")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", seq.id);
    }
  }

  return { claimed: steps?.length ?? 0, sent, failed, errors };
}
