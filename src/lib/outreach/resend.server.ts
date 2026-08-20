// =====================================================================
// Resend HTTP send helpers (server-only)
// =====================================================================
export {
  appBaseUrl,
  buildCaslFooter,
  signUnsubscribeToken,
} from "@/lib/outreach/unsub-token.server";

export async function resendSendEmail(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<{ id: string } | { error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: "RESEND_API_KEY is not configured" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      headers: {
        "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    return { error: json.message || `Resend HTTP ${res.status}` };
  }
  if (!json.id) return { error: "Resend returned no message id" };
  return { id: json.id };
}

/** Soft daily cap for free-tier ramp. */
export const DAILY_SEND_CAP = Number(process.env.OUTREACH_DAILY_CAP || 50);
