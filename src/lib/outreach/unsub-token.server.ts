// =====================================================================
// Unsubscribe HMAC tokens (server-only — do not import from client routes)
// =====================================================================
import { createHmac, timingSafeEqual } from "node:crypto";

const DAY_MS = 86_400_000;
/** Tokens valid for 2 years — CASL opt-out must remain reachable. */
const TOKEN_TTL_MS = 730 * DAY_MS;

function secret(): string {
  return (
    process.env.RESEND_WEBHOOK_SECRET ||
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.MY_SUPABASE_SERVICE_ROLE_KEY ||
    "scrapivo-dev-unsub-secret"
  );
}

export function appBaseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    "https://scrapivo-beta.vercel.app"
  ).replace(/\/$/, "");
}

export function signUnsubscribeToken(payload: {
  userId: string;
  email: string;
  sendId?: string;
}): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = Buffer.from(
    JSON.stringify({ u: payload.userId, e: payload.email.toLowerCase(), s: payload.sendId, exp }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { userId: string; email: string; sendId?: string } | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      u: string;
      e: string;
      s?: string;
      exp: number;
    };
    if (!data.u || !data.e || !data.exp || Date.now() > data.exp) return null;
    return { userId: data.u, email: data.e.toLowerCase(), sendId: data.s };
  } catch {
    return null;
  }
}

export function buildCaslFooter(opts: {
  senderName: string;
  physicalAddress: string;
  unsubscribeUrl: string;
}): string {
  return [
    "",
    "—",
    `Sent by ${opts.senderName}`,
    opts.physicalAddress,
    `Unsubscribe: ${opts.unsubscribeUrl}`,
  ].join("\n");
}
