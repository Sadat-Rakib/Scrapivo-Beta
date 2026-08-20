// =====================================================================
// Send a CASL-gated outreach email via Resend
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { runComplianceGate } from "@/lib/outreach/compliance-gate.server";
import {
  appBaseUrl,
  buildCaslFooter,
  DAILY_SEND_CAP,
  resendSendEmail,
  signUnsubscribeToken,
} from "@/lib/outreach/resend.server";
import type { ContactProvenance } from "@/lib/contact/provenance";

export type SendLeadEmailInput = {
  savedLeadId: string;
  /** Override draft subject/body (otherwise use saved_leads). */
  subject?: string;
  body?: string;
  toEmail?: string;
};

export type SendLeadEmailResult =
  | { ok: true; sendId: string; resendId: string; complianceId: string }
  | { ok: false; reasons: string[]; error?: string };

type DiscoveryEmailMeta = {
  email?: string;
  role_title?: string;
  provenance?: ContactProvenance[];
  consent?: { outreach_ready?: boolean };
};

function discoveryEmails(meta: unknown): DiscoveryEmailMeta[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as Record<string, unknown>).discovery_emails;
  return Array.isArray(raw) ? (raw as DiscoveryEmailMeta[]) : [];
}

/** Prefer provenance for the exact recipient — never launder another address's basis. */
function provenanceFromMeta(meta: unknown, toEmail?: string): ContactProvenance[] {
  if (!meta || typeof meta !== "object") return [];
  const m = meta as Record<string, unknown>;
  const emails = discoveryEmails(meta);
  const target = (toEmail || "").trim().toLowerCase();
  if (target && emails.length) {
    const match = emails.find((e) => (e.email || "").toLowerCase() === target);
    if (match?.provenance?.length) return match.provenance;
  }
  if (Array.isArray(m.provenance) && (m.provenance as ContactProvenance[]).length) {
    return m.provenance as ContactProvenance[];
  }
  // No matching published record for this address — empty provenance fails CASL gate.
  return [];
}

function roleFromMeta(meta: unknown, toEmail?: string | null): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const target = (toEmail || "").trim().toLowerCase();
  const emails = discoveryEmails(meta);
  if (target && emails.length) {
    const match = emails.find((e) => (e.email || "").toLowerCase() === target);
    if (match?.role_title?.trim()) return match.role_title;
  }
  if (typeof m.role_title === "string" && m.role_title.trim()) return m.role_title;
  const rows = m.compliance_rows;
  if (Array.isArray(rows)) {
    const rowMatch = target
      ? rows.find((r: any) => (r?.value || "").toLowerCase() === target)
      : rows[0];
    if (rowMatch && typeof (rowMatch as any).role_title === "string") {
      return (rowMatch as any).role_title;
    }
  }
  if (emails[0]?.role_title?.trim()) return emails[0].role_title!;
  return null;
}

export async function countSendsToday(supabase: SupabaseClient, userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("email_sends")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", start.toISOString())
    .neq("status", "failed");
  if (error) return 0;
  return count ?? 0;
}

export async function sendLeadEmailCore(
  supabase: SupabaseClient,
  userId: string,
  input: SendLeadEmailInput,
): Promise<SendLeadEmailResult> {
  const { data: lead, error: leadErr } = await supabase
    .from("saved_leads")
    .select(
      "id, status, contact_email, contact_name, contact_meta, outreach_email_subject, outreach_email_body, full_post_url, title",
    )
    .eq("id", input.savedLeadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (leadErr || !lead) {
    return { ok: false, reasons: ["Lead not found."] };
  }

  const subject = (input.subject ?? lead.outreach_email_subject ?? "").trim();
  const body = (input.body ?? lead.outreach_email_body ?? "").trim();
  const toEmail = (input.toEmail ?? lead.contact_email ?? "").trim().toLowerCase();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, sender_name, sender_physical_address, outreach_from_email")
    .eq("id", userId)
    .maybeSingle();

  const senderName = (profile?.sender_name || profile?.full_name || "").trim() || null;
  const address = (profile?.sender_physical_address || "").trim() || null;
  const fromEmail =
    (profile?.outreach_from_email || process.env.OUTREACH_FROM_EMAIL || "").trim() || null;

  const sentToday = await countSendsToday(supabase, userId);
  if (sentToday >= DAILY_SEND_CAP) {
    return {
      ok: false,
      reasons: [
        `Daily send cap reached (${DAILY_SEND_CAP}/day). Try again tomorrow or raise OUTREACH_DAILY_CAP.`,
      ],
    };
  }

  const meta = lead.contact_meta;
  const gate = await runComplianceGate(supabase, {
    userId,
    savedLeadId: lead.id,
    toEmail,
    subject,
    body,
    roleTitle: roleFromMeta(meta, toEmail),
    provenance: provenanceFromMeta(meta, toEmail),
    offeringRelevantToRole: true,
    senderName,
    senderPhysicalAddress: address,
    fromEmail,
  });

  if (!gate.ok || !gate.complianceId) {
    return { ok: false, reasons: gate.ok ? ["Missing compliance id"] : gate.reasons };
  }

  // Insert queued send first so the unsubscribe token can reference it.
  const { data: sendRow, error: sendInsErr } = await supabase
    .from("email_sends")
    .insert({
      user_id: userId,
      saved_lead_id: lead.id,
      compliance_id: gate.complianceId,
      to_email: toEmail,
      subject,
      status: "queued",
    })
    .select("id")
    .single();

  if (sendInsErr || !sendRow) {
    return {
      ok: false,
      reasons: [`Could not create send record: ${sendInsErr?.message || "unknown"}`],
    };
  }

  const token = signUnsubscribeToken({
    userId,
    email: toEmail,
    sendId: sendRow.id,
  });
  const unsubscribeUrl = `${appBaseUrl()}/unsubscribe?t=${encodeURIComponent(token)}`;
  const footer = buildCaslFooter({
    senderName: senderName!,
    physicalAddress: address!,
    unsubscribeUrl,
  });
  const fullText = `${body}\n${footer}`;

  const fromHeader = senderName ? `${senderName} <${fromEmail}>` : fromEmail!;

  const sent = await resendSendEmail({
    from: fromHeader,
    to: toEmail,
    subject,
    text: fullText,
    unsubscribeUrl,
  });

  if ("error" in sent) {
    await supabase
      .from("email_sends")
      .update({ status: "failed", error: sent.error, updated_at: new Date().toISOString() })
      .eq("id", sendRow.id);
    return { ok: false, reasons: [sent.error], error: sent.error };
  }

  await supabase
    .from("email_sends")
    .update({
      status: "sent",
      resend_id: sent.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sendRow.id);

  await supabase.from("lead_activity").insert({
    user_id: userId,
    saved_lead_id: lead.id,
    lead_url: lead.full_post_url,
    kind: "email_sent",
    detail: `Email sent to ${toEmail}: ${subject}`,
    metadata: {
      email_send_id: sendRow.id,
      resend_id: sent.id,
      compliance_id: gate.complianceId,
    },
  });

  if (!lead.status || lead.status === "saved") {
    await supabase
      .from("saved_leads")
      .update({ status: "contacted" })
      .eq("id", lead.id)
      .eq("user_id", userId);
    await supabase.from("lead_activity").insert({
      user_id: userId,
      saved_lead_id: lead.id,
      lead_url: lead.full_post_url,
      kind: "stage_change",
      detail: "Stage → Contacted (email sent)",
      metadata: { status: "contacted", via: "email_send" },
    });
  }

  return {
    ok: true,
    sendId: sendRow.id,
    resendId: sent.id,
    complianceId: gate.complianceId,
  };
}

/** Preview gate without persisting (for UI disable reasons). */
export async function previewComplianceGate(
  supabase: SupabaseClient,
  userId: string,
  input: SendLeadEmailInput,
): Promise<{ ok: boolean; reasons: string[]; sentToday: number; dailyCap: number }> {
  const { data: lead } = await supabase
    .from("saved_leads")
    .select(
      "id, contact_email, contact_name, contact_meta, outreach_email_subject, outreach_email_body",
    )
    .eq("id", input.savedLeadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!lead)
    return { ok: false, reasons: ["Lead not found."], sentToday: 0, dailyCap: DAILY_SEND_CAP };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, sender_name, sender_physical_address, outreach_from_email")
    .eq("id", userId)
    .maybeSingle();

  const sentToday = await countSendsToday(supabase, userId);
  const reasons: string[] = [];
  if (sentToday >= DAILY_SEND_CAP) {
    reasons.push(`Daily send cap reached (${DAILY_SEND_CAP}/day).`);
  }

  const subject = (input.subject ?? lead.outreach_email_subject ?? "").trim();
  const body = (input.body ?? lead.outreach_email_body ?? "").trim();
  const toEmail = (input.toEmail ?? lead.contact_email ?? "").trim().toLowerCase();

  const gate = await runComplianceGate(supabase, {
    userId,
    savedLeadId: lead.id,
    toEmail,
    subject,
    body,
    roleTitle: roleFromMeta(lead.contact_meta, toEmail),
    provenance: provenanceFromMeta(lead.contact_meta, toEmail),
    offeringRelevantToRole: true,
    senderName: (profile?.sender_name || profile?.full_name || "").trim() || null,
    senderPhysicalAddress: (profile?.sender_physical_address || "").trim() || null,
    fromEmail:
      (profile?.outreach_from_email || process.env.OUTREACH_FROM_EMAIL || "").trim() || null,
    dryRun: true,
  });

  const allReasons = [...reasons, ...(gate.ok ? [] : gate.reasons)];
  return {
    ok: gate.ok && reasons.length === 0,
    reasons: allReasons,
    sentToday,
    dailyCap: DAILY_SEND_CAP,
  };
}
