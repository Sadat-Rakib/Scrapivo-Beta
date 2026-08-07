/**
 * MillionVerifier real-time email verification.
 * Docs: https://developer.millionverifier.com/ — GET /api/v3/?api=&email=
 *
 * Prefer this over ZeroBounce when MILLIONVERIFIER_API_KEY is set.
 * Never log the API key.
 */

export type MillionVerifierResult = {
  email: string;
  result: string;
  quality?: string;
  free?: boolean;
  role?: boolean;
  credits?: number;
  valid: boolean;
  catchAll: boolean;
  unknown: boolean;
  disposable: boolean;
};

const DAILY_CAP = Number(process.env.MILLIONVERIFIER_DAILY_CAP || 40);
let usedToday = 0;
let dayKey = "";

function bumpCap(): boolean {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== dayKey) {
    dayKey = d;
    usedToday = 0;
  }
  if (usedToday >= DAILY_CAP) return false;
  usedToday += 1;
  return true;
}

export function millionVerifierConfigured(): boolean {
  return !!(process.env.MILLIONVERIFIER_API_KEY || "").trim();
}

/**
 * Verify one email. Returns null on missing key, cap, or transport error.
 */
export async function verifyWithMillionVerifier(
  email: string,
): Promise<MillionVerifierResult | null> {
  const key = (process.env.MILLIONVERIFIER_API_KEY || "").trim();
  if (!key) return null;
  const e = (email || "").trim().toLowerCase();
  if (!e.includes("@")) return null;
  if (!bumpCap()) {
    console.info("[millionverifier] daily cap reached — skipping");
    return null;
  }

  const url = new URL("https://api.millionverifier.com/api/v3/");
  url.searchParams.set("api", key);
  url.searchParams.set("email", e);
  url.searchParams.set("timeout", "10");

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      email?: string;
      result?: string;
      quality?: string;
      free?: boolean;
      role?: boolean;
      credits?: number;
      error?: string;
    };
    if (data.error) return null;
    const result = (data.result || "").toLowerCase();
    // ok | catch_all | unknown | invalid | disposable | …
    const valid = result === "ok";
    const catchAll = result === "catch_all";
    const unknown = result === "unknown" || result === "unverified";
    const disposable = result === "disposable";
    return {
      email: data.email || e,
      result,
      quality: data.quality,
      free: data.free,
      role: data.role,
      credits: data.credits,
      valid,
      catchAll,
      unknown,
      disposable,
    };
  } catch {
    return null;
  }
}
