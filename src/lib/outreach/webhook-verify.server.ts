import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify Resend/Svix webhook signature without the svix package. */
export function verifyResendWebhook(
  payload: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject stale payloads (>5 min)
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  let key = secret;
  if (key.startsWith("whsec_")) key = key.slice(6);
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(key, "base64");
  } catch {
    return false;
  }

  const signed = `${headers.id}.${headers.timestamp}.${payload}`;
  const expected = createHmac("sha256", secretBytes).update(signed).digest("base64");

  const parts = headers.signature.split(" ");
  for (const part of parts) {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) continue;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}
