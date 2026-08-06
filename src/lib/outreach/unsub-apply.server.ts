import { getAdmin } from "@/integrations/my-supabase/admin.server";
import { verifyUnsubscribeToken } from "@/lib/outreach/unsub-token.server";

export async function applyUnsubscribe(token: string) {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) {
    return { ok: false as const, error: "Invalid or expired unsubscribe link." };
  }

  const admin = getAdmin();
  await admin.from("email_suppressions").upsert(
    {
      user_id: parsed.userId,
      email: parsed.email,
      reason: "unsubscribe",
      source: "one_click",
    },
    { onConflict: "user_id,email" },
  );

  if (parsed.sendId) {
    await admin
      .from("email_sends")
      .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
      .eq("id", parsed.sendId)
      .eq("user_id", parsed.userId);

    const { data: send } = await admin
      .from("email_sends")
      .select("saved_lead_id")
      .eq("id", parsed.sendId)
      .maybeSingle();

    await admin.from("lead_activity").insert({
      user_id: parsed.userId,
      saved_lead_id: send?.saved_lead_id ?? null,
      kind: "email_unsubscribed",
      detail: `${parsed.email} unsubscribed`,
      metadata: { email: parsed.email, send_id: parsed.sendId },
    });
  }

  await admin
    .from("email_sequences")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("user_id", parsed.userId)
    .eq("status", "active");

  return { ok: true as const, email: parsed.email };
}
