// =====================================================================
// CASL / CAN-SPAM compliance gate — must pass before any CEM is sent.
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyEmailDeep } from "@/lib/contact/verify-contact.server";
import {
  assessConsent,
  type ConsentAssessment,
  type ContactProvenance,
} from "@/lib/contact/provenance";

export type GateInput = {
  userId: string;
  savedLeadId: string;
  toEmail: string;
  subject: string;
  body: string;
  /** Role/title for CASL relevance evidence. */
  roleTitle?: string | null;
  /** Provenance from contact_meta / resolve. */
  provenance?: ContactProvenance[];
  /** Sender asserts offering is relevant to role. */
  offeringRelevantToRole?: boolean;
  senderName?: string | null;
  senderPhysicalAddress?: string | null;
  fromEmail?: string | null;
  /** When true, evaluate without inserting outreach_compliance. */
  dryRun?: boolean;
};

export type GateResult =
  | {
      ok: true;
      complianceId: string | null;
      assessment: ConsentAssessment;
      verifierTier: string;
      reasons: string[];
    }
  | {
      ok: false;
      reasons: string[];
      assessment?: ConsentAssessment;
      verifierTier?: string;
    };

function mapBasis(basis: ConsentAssessment["basis"]): string {
  if (basis === "implied_conspicuous_publication") return "conspicuous_publication";
  return "none";
}

export async function runComplianceGate(
  supabase: SupabaseClient,
  input: GateInput,
): Promise<GateResult> {
  const reasons: string[] = [];
  const email = (input.toEmail || "").trim().toLowerCase();
  const subject = (input.subject || "").trim();
  const body = (input.body || "").trim();
  const senderName = (input.senderName || "").trim();
  const address = (input.senderPhysicalAddress || "").trim();
  const fromEmail = (input.fromEmail || "").trim();

  if (!senderName) reasons.push("Set your sender name in Settings (CASL identification).");
  if (!address) reasons.push("Set your physical mailing address in Settings (CASL / CAN-SPAM).");
  if (!fromEmail) reasons.push("Set outreach from-email in Settings (must be verified in Resend).");
  if (!email) reasons.push("No recipient email on this lead — Resolve contact first.");
  if (!subject) reasons.push("Email subject is empty.");
  if (!body) reasons.push("Email body is empty.");
  if (/\b(free money|act now!!!|guaranteed income)\b/i.test(subject)) {
    reasons.push("Subject looks deceptive / spammy — revise before sending.");
  }

  if (email) {
    const { data: suppressed } = await supabase
      .from("email_suppressions")
      .select("id, reason")
      .eq("user_id", input.userId)
      .eq("email", email)
      .maybeSingle();
    if (suppressed) {
      reasons.push(`Address is suppressed (${suppressed.reason}) — do not send.`);
    }
  }

  let verifierTier = "unknown";
  if (email && !reasons.some((r) => r.includes("suppressed"))) {
    const v = await verifyEmailDeep(email, { freeOnly: !process.env.ZEROBOUNCE_KEY });
    verifierTier = v.tier;
    if (v.disposable) reasons.push("Disposable / temporary email — blocked.");
    if (v.tier === "invalid") reasons.push(`Email verification failed (${v.label}).`);
    if (v.catch_all === true && v.tier !== "verified") {
      reasons.push("Catch-all domain without strong verification — too risky for cold CEM.");
    }
    if (v.tier === "unconfirmable" || v.tier === "risky") {
      reasons.push(`Verification inconclusive (${v.label}) — resolve a published address first.`);
    }
  }

  const provenance = input.provenance ?? [];
  const assessment = assessConsent({
    provenance,
    role_title: input.roleTitle || undefined,
    offeringRelevantToRole: input.offeringRelevantToRole ?? true,
  });
  reasons.push(...assessment.reasons);
  if (!assessment.outreach_ready) {
    reasons.push("CASL gate: outreach_ready is false — conspicuous publication basis required.");
  }

  const uniqueReasons = [...new Set(reasons)];
  const hardFail =
    !senderName ||
    !address ||
    !fromEmail ||
    !email ||
    !subject ||
    !body ||
    !assessment.outreach_ready ||
    uniqueReasons.some((r) =>
      /suppressed|Disposable|verification failed|Catch-all|inconclusive|deceptive|empty|Set your|No recipient/i.test(
        r,
      ),
    );

  if (hardFail || !assessment.outreach_ready) {
    return {
      ok: false,
      reasons: uniqueReasons,
      assessment,
      verifierTier,
    };
  }

  if (input.dryRun) {
    return {
      ok: true,
      complianceId: null,
      assessment,
      verifierTier,
      reasons: uniqueReasons,
    };
  }

  const relied = assessment.relied_on;
  const { data: row, error } = await supabase
    .from("outreach_compliance")
    .insert({
      user_id: input.userId,
      saved_lead_id: input.savedLeadId,
      email,
      basis: mapBasis(assessment.basis),
      source_url: relied?.source_url ?? null,
      role_title: input.roleTitle || relied?.role_title || null,
      captured_at: relied?.captured_at ?? null,
      content_hash: relied?.content_hash ?? null,
      anti_cem_statement: relied?.anti_cem_statement ?? null,
      relevance_note: "Sender confirmed offering relevant to recipient role.",
      verifier_tier: verifierTier,
      outreach_ready: true,
      reasons: uniqueReasons,
    })
    .select("id")
    .single();

  if (error || !row) {
    return {
      ok: false,
      reasons: [...uniqueReasons, `Could not persist compliance log: ${error?.message || "unknown"}`],
      assessment,
      verifierTier,
    };
  }

  return {
    ok: true,
    complianceId: row.id,
    assessment,
    verifierTier,
    reasons: uniqueReasons,
  };
}
