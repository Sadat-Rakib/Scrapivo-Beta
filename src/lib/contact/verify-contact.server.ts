// =====================================================================
// Contact verification — email and phone
//
// Verification is the commoditised half of this system, so the goal here isn't
// to beat ZeroBounce on accuracy. It's to be HONEST, which most tools are not:
//
//   • Catch-all detection runs FIRST, not last. If a domain accepts mail for
//     kj3h4kjh@, then every SMTP "yes" is meaningless, and any tool that
//     reports "verified" for that domain is lying to its user. We label the
//     record inferred-and-unconfirmable and say why.
//   • Provider behaviour is part of the score. Google Workspace tenants and
//     Microsoft 365 answer RCPT probes very differently from a self-hosted
//     Postfix; a raw 250 means different things on each.
//   • Every verdict carries `evidence[]` — the actual checks that ran — so the
//     UI can show "MX + Reacher: deliverable" instead of a bare number.
//
// Cost model this is designed around: Exa charges ~$0.02/email and ~$0.07/phone
// for DISCOVERY. Self-hosting verification only wins below a few thousand
// lookups a month once ops time is counted — so everything here is free-first
// and degrades gracefully when nothing is configured.
//
// Self-hosted backends, both optional:
//   REACHER_URL  — check-if-email-exists HTTP backend (Rust). Needs outbound
//                  port 25; Gmail returns false negatives, which we handle.
//                  Licensing: the project is dual-licensed (AGPL-3.0 / commercial)
//                  — confirm the commercial terms before shipping it in SaaS.
//   TRUEMAIL_URL — Truemail (Ruby) validation server; regex + DNS + SMTP.
// Phone: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN uses Lookup v2 Basic, which is
// free; line-type/caller-name packages are paid and stay off by default.
// =====================================================================
import { promises as dns } from "node:dns";
import { parsePhone, type ParsedPhone } from "./phone";

// ── shared shapes ───────────────────────────────────────────────────────────

export type VerificationTier = "verified" | "probable" | "risky" | "invalid" | "unconfirmable";

export type EmailVerification = {
  email: string;
  syntax_valid: boolean;
  disposable: boolean;
  mx_found: boolean;
  smtp_ok: boolean | null;
  catch_all: boolean | null;
  role_account: boolean;
  confidence: number;
  tier: VerificationTier;
  method: string;
  /** Mail host family — explains why smtp_ok is or isn't trustworthy. */
  provider?: string;
  /** Every check that ran, in order, for display and for the audit trail. */
  evidence: string[];
  /** Plain-language verdict for the UI. Never overstates what we know. */
  label: string;
};

const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
  "getnada.com",
  "temp-mail.org",
  "throwawaymail.com",
  "sharklasers.com",
  "maildrop.cc",
  "dispostable.com",
  "mohmal.com",
  "fakeinbox.com",
  "tempr.email",
  "emailondeck.com",
  "spamgourmet.com",
  "mailnesia.com",
  "burnermail.io",
  "moakt.com",
  "tempmailo.com",
  "1secmail.com",
  "inboxkitten.com",
  "harakirimail.com",
]);

const ROLE_LOCALPARTS = new Set([
  "info",
  "support",
  "hello",
  "contact",
  "admin",
  "sales",
  "team",
  "office",
  "help",
  "billing",
  "careers",
  "jobs",
  "hr",
  "press",
  "media",
  "marketing",
  "noreply",
  "no-reply",
  "webmaster",
  "postmaster",
  "enquiries",
  "inquiries",
  "accounts",
  "accounting",
  "finance",
  "legal",
  "privacy",
  "security",
  "abuse",
  "dmarc",
  "hostmaster",
  "mail",
  "service",
  "customerservice",
  "partnerships",
]);

/**
 * Providers whose SMTP answers can't be taken at face value.
 * - Google Workspace: many tenants accept every RCPT (catch-all-ish behaviour)
 *   or reject probes outright; a 250 is weak evidence either way.
 * - Microsoft 365: tarpits and greylists probes; a 550 often means "we don't
 *   like you", not "no such user".
 * - Yahoo/AOL: notoriously return 250 for unknown users.
 */
const UNRELIABLE_SMTP =
  /google|googlemail|aspmx|outlook|office365|protection\.outlook|yahoodns|yahoo|proofpoint|mimecast|barracuda/i;

// ── MX / provider ───────────────────────────────────────────────────────────

type MxInfo = { found: boolean; hosts: string[]; provider: string; reliableSmtp: boolean };

const mxCache = new Map<string, { info: MxInfo; at: number }>();
const MX_TTL_MS = 30 * 60 * 1000;

async function mxInfo(domain: string): Promise<MxInfo> {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_TTL_MS) return cached.info;

  let info: MxInfo = { found: false, hosts: [], provider: "none", reliableSmtp: false };
  try {
    const mx = await dns.resolveMx(domain);
    if (mx?.length) {
      const hosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase());
      const joined = hosts.join(" ");
      const provider = /google|aspmx/i.test(joined)
        ? "google_workspace"
        : /outlook|office365|microsoft/i.test(joined)
          ? "microsoft365"
          : /zoho/i.test(joined)
            ? "zoho"
            : /proton/i.test(joined)
              ? "proton"
              : /messagingengine|fastmail/i.test(joined)
                ? "fastmail"
                : /yahoodns|yahoo/i.test(joined)
                  ? "yahoo"
                  : /mimecast|proofpoint|barracuda/i.test(joined)
                    ? "gateway"
                    : "self_hosted";
      info = {
        found: true,
        hosts: hosts.slice(0, 3),
        provider,
        reliableSmtp: !UNRELIABLE_SMTP.test(joined),
      };
    } else {
      // Implicit MX: some domains accept mail on their A record.
      const a = await dns.resolve(domain).catch(() => []);
      if (Array.isArray(a) && a.length) {
        info = { found: true, hosts: [domain], provider: "self_hosted", reliableSmtp: true };
      }
    }
  } catch {
    try {
      const a = await dns.resolve(domain);
      if (Array.isArray(a) && a.length) {
        info = { found: true, hosts: [domain], provider: "self_hosted", reliableSmtp: true };
      }
    } catch {
      /* no mail */
    }
  }
  mxCache.set(domain, { info, at: Date.now() });
  return info;
}

// ── SMTP probing (gated) ────────────────────────────────────────────────────

type SmtpResult = { rcptOk: boolean | null; code: number | null; note: string };

/**
 * One RCPT TO probe against the domain's primary MX. Never sends mail (we QUIT
 * before DATA), which is what makes SMTP validation legitimate rather than
 * spammy. Gated behind SMTP_PROBE because most hosts — including nearly every
 * cloud provider — block outbound port 25 and the probe just times out.
 */
async function smtpRcpt(host: string, email: string, timeoutMs = 7000): Promise<SmtpResult> {
  const net = await import("node:net");
  const helo = process.env.SMTP_PROBE_HELO || "scrapivo.app";
  const mailFrom = process.env.SMTP_PROBE_FROM || `probe@${helo}`;

  return new Promise<SmtpResult>((resolve) => {
    let settled = false;
    const finish = (r: SmtpResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      resolve(r);
    };
    const socket = net.connect(25, host);
    let stage = 0;
    socket.setTimeout(timeoutMs, () =>
      finish({ rcptOk: null, code: null, note: "SMTP probe timed out (port 25 likely blocked)" }),
    );
    socket.on("error", (e) =>
      finish({ rcptOk: null, code: null, note: `SMTP probe failed: ${(e as Error).message}` }),
    );
    socket.on("data", (buf) => {
      const line = buf.toString();
      const code = parseInt(line.slice(0, 3), 10);
      if (stage === 0) {
        if (code !== 220)
          return finish({ rcptOk: null, code, note: `unexpected greeting ${code}` });
        socket.write(`EHLO ${helo}\r\n`);
        stage = 1;
      } else if (stage === 1) {
        socket.write(`MAIL FROM:<${mailFrom}>\r\n`);
        stage = 2;
      } else if (stage === 2) {
        if (code >= 400)
          return finish({
            rcptOk: null,
            code,
            note: `server rejected MAIL FROM (${code}) — probe inconclusive`,
          });
        socket.write(`RCPT TO:<${email}>\r\n`);
        stage = 3;
      } else if (stage === 3) {
        socket.write("QUIT\r\n");
        if (code >= 200 && code < 300)
          finish({ rcptOk: true, code, note: `RCPT accepted (${code})` });
        else if (code >= 500 && code < 600)
          finish({ rcptOk: false, code, note: `RCPT rejected (${code})` });
        else
          finish({
            rcptOk: null,
            code,
            note: `RCPT deferred (${code}) — greylisted, inconclusive`,
          });
      }
    });
  });
}

// ── catch-all detection ─────────────────────────────────────────────────────

const catchAllCache = new Map<string, { value: boolean | null; at: number }>();
const CATCH_ALL_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Does this domain accept mail for addresses that don't exist?
 *
 * This runs BEFORE any per-address verdict, because on a catch-all domain no
 * amount of SMTP probing can distinguish a real inbox from a guess. Getting
 * this wrong in the optimistic direction is the single most common way lead
 * tools produce confidently-wrong data.
 *
 * Returns null when we couldn't determine it (no probe available) — which is
 * an honest "unknown", not a "no".
 */
export async function detectCatchAll(domain: string): Promise<boolean | null> {
  const cached = catchAllCache.get(domain);
  if (cached && Date.now() - cached.at < CATCH_ALL_TTL_MS) return cached.value;

  let value: boolean | null = null;
  const probeLocal = `no-such-user-${Math.random().toString(36).slice(2, 12)}`;
  const probeAddress = `${probeLocal}@${domain}`;

  // Prefer a self-hosted verifier if one is configured — it owns the SMTP
  // connection pool and handles greylisting better than a one-shot socket.
  const viaReacher = await reacherCheck(probeAddress).catch(() => null);
  if (viaReacher?.is_reachable === "safe") {
    value = true;
  } else if (
    viaReacher &&
    (viaReacher.is_reachable === "invalid" || viaReacher.smtp_ok === false)
  ) {
    value = false;
  } else if (process.env.SMTP_PROBE === "true") {
    const mx = await mxInfo(domain);
    if (mx.found && mx.hosts[0]) {
      const probe = await smtpRcpt(mx.hosts[0], probeAddress).catch(() => null);
      if (probe?.rcptOk === true) value = true;
      else if (probe?.rcptOk === false) value = false;
    }
  }

  catchAllCache.set(domain, { value, at: Date.now() });
  return value;
}

// ── self-hosted verifier backends ───────────────────────────────────────────

type ReacherResult = {
  is_reachable?: "safe" | "risky" | "invalid" | "unknown";
  smtp_ok?: boolean | null;
  is_catch_all?: boolean | null;
  is_disposable?: boolean;
  is_role_account?: boolean;
  has_mx?: boolean;
};

/**
 * check-if-email-exists / Reacher self-hosted backend.
 * Free and unlimited when self-hosted, but it needs outbound port 25 and it
 * cannot verify Gmail reliably (Google answers every probe the same way), so
 * we treat "unknown" from Reacher as genuinely unknown rather than negative.
 */
export async function reacherCheck(email: string): Promise<ReacherResult | null> {
  const base = process.env.REACHER_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v0/check_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.REACHER_TOKEN ? { Authorization: process.env.REACHER_TOKEN } : {}),
      },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, any>;
    return {
      is_reachable: d.is_reachable,
      smtp_ok: d.smtp?.is_deliverable ?? null,
      is_catch_all: d.smtp?.is_catch_all ?? null,
      is_disposable: d.misc?.is_disposable ?? undefined,
      is_role_account: d.misc?.is_role_account ?? undefined,
      has_mx: d.mx?.accepts_mail ?? undefined,
    };
  } catch {
    return null;
  }
}

/** Truemail validation server (Ruby). Same role as Reacher; whichever is up wins. */
export async function truemailCheck(email: string): Promise<{ success: boolean } | null> {
  const base = process.env.TRUEMAIL_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/?email=${encodeURIComponent(email)}`, {
      headers: process.env.TRUEMAIL_TOKEN ? { Authorization: process.env.TRUEMAIL_TOKEN } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, any>;
    const success = d.success ?? d.result?.success;
    return typeof success === "boolean" ? { success } : null;
  } catch {
    return null;
  }
}

/** ZeroBounce — paid last resort, unchanged in spirit from the original waterfall. */
async function zeroBounce(email: string): Promise<{ valid: boolean; status: string } | null> {
  const key = process.env.ZEROBOUNCE_KEY;
  if (!key) return null;
  try {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${key}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { status?: string };
    return { valid: d.status === "valid", status: d.status ?? "unknown" };
  } catch {
    return null;
  }
}

// ── the email waterfall ─────────────────────────────────────────────────────

export type VerifyOptions = {
  /**
   * True when the address was generated rather than harvested. A derived
   * address can never be reported as "verified" on a catch-all domain, and its
   * label always says it was inferred.
   */
  derived?: boolean;
  /** Skip paid fallback even when a key is present. */
  freeOnly?: boolean;
};

/**
 * Verify an email address through the free-first waterfall.
 *
 * Order: syntax → disposable → role → MX/provider → self-hosted verifier →
 * SMTP probe → catch-all interpretation → (paid, only if still inconclusive).
 */
export async function verifyEmailDeep(
  email: string,
  opts: VerifyOptions = {},
): Promise<EmailVerification> {
  const e = (email || "").trim().toLowerCase();
  const evidence: string[] = [];
  const base: EmailVerification = {
    email: e,
    syntax_valid: false,
    disposable: false,
    mx_found: false,
    smtp_ok: null,
    catch_all: null,
    role_account: false,
    confidence: 0,
    tier: "invalid",
    method: "syntax",
    evidence,
    label: "Invalid address",
  };

  if (!EMAIL_RE.test(e)) {
    evidence.push("Failed RFC-shaped syntax check");
    return base;
  }
  base.syntax_valid = true;
  evidence.push("Syntax valid");

  const [local, domain] = e.split("@");

  if (DISPOSABLE_DOMAINS.has(domain)) {
    evidence.push(`${domain} is a known disposable-mail provider`);
    return {
      ...base,
      disposable: true,
      tier: "invalid",
      confidence: 0.05,
      method: "disposable",
      label: "Disposable address",
    };
  }

  base.role_account = ROLE_LOCALPARTS.has(local);
  if (base.role_account) evidence.push(`"${local}@" is a shared role inbox, not a person`);

  const mx = await mxInfo(domain);
  base.mx_found = mx.found;
  base.provider = mx.provider;
  if (!mx.found) {
    evidence.push(`${domain} has no MX or A record — it cannot receive mail`);
    return {
      ...base,
      tier: "invalid",
      confidence: 0.05,
      method: "mx",
      label: "Domain cannot receive mail",
    };
  }
  evidence.push(`MX found (${mx.provider.replace(/_/g, " ")})`);

  let method = "mx";
  let smtpOk: boolean | null = null;

  // 1) Self-hosted verifier, if configured. Always tried — it's free, so
  //    freeOnly has no bearing on it.
  const reacher = await reacherCheck(e);
  if (reacher) {
    method = "reacher";
    if (reacher.is_reachable === "safe") {
      smtpOk = true;
      evidence.push("Reacher: deliverable");
    } else if (reacher.is_reachable === "invalid") {
      smtpOk = false;
      evidence.push("Reacher: undeliverable");
    } else if (reacher.is_reachable === "risky") {
      smtpOk = reacher.smtp_ok ?? null;
      evidence.push("Reacher: risky (accepts mail but cannot confirm the mailbox)");
    } else evidence.push("Reacher: unknown (provider does not answer probes)");
    if (reacher.is_catch_all != null) base.catch_all = reacher.is_catch_all;
  } else {
    const truemail = await truemailCheck(e);
    if (truemail) {
      method = "truemail";
      smtpOk = truemail.success;
      evidence.push(`Truemail: ${truemail.success ? "valid" : "invalid"}`);
    }
  }

  // 2) Direct SMTP probe when nothing else answered and it's enabled.
  if (smtpOk === null && process.env.SMTP_PROBE === "true" && mx.hosts[0]) {
    const probe = await smtpRcpt(mx.hosts[0], e).catch(() => null);
    if (probe) {
      smtpOk = probe.rcptOk;
      method = "smtp";
      evidence.push(`SMTP: ${probe.note}`);
    }
  }
  base.smtp_ok = smtpOk;

  // 3) Catch-all: decides what an SMTP "yes" is even worth.
  if (base.catch_all == null && (smtpOk === true || opts.derived)) {
    base.catch_all = await detectCatchAll(domain);
    if (base.catch_all === true)
      evidence.push(
        `${domain} accepts mail for addresses that don't exist (catch-all) — a positive result proves nothing here`,
      );
    else if (base.catch_all === false)
      evidence.push("Domain rejects unknown addresses, so a positive result is meaningful");
  }
  if (!mx.reliableSmtp) {
    evidence.push(`${mx.provider.replace(/_/g, " ")} does not answer mailbox probes reliably`);
  }

  // 4) Score. The rules encode the honesty constraints stated at the top.
  let confidence: number;
  let tier: VerificationTier;
  let label: string;

  if (smtpOk === false) {
    confidence = 0.05;
    tier = "invalid";
    label = "Mailbox rejected by the server";
  } else if (base.catch_all === true) {
    // Cannot be confirmed, ever, by SMTP. Say so.
    confidence = opts.derived ? 0.35 : 0.55;
    tier = "unconfirmable";
    label = opts.derived
      ? "Pattern-inferred — domain is catch-all, so it cannot be confirmed"
      : "Published address — domain is catch-all, so delivery cannot be confirmed";
  } else if (smtpOk === true && base.catch_all === false) {
    confidence = mx.reliableSmtp ? 0.92 : 0.75;
    tier = "verified";
    label = mx.reliableSmtp
      ? "Mailbox confirmed by the mail server"
      : "Mailbox accepted (provider probes are unreliable)";
  } else if (smtpOk === true) {
    confidence = mx.reliableSmtp ? 0.8 : 0.65;
    tier = "probable";
    label = "Mailbox accepted, catch-all status unknown";
  } else if (opts.derived) {
    confidence = 0.3;
    tier = "risky";
    label = "Pattern-inferred, unverified";
  } else {
    confidence = 0.55;
    tier = "probable";
    label = "Published address, domain accepts mail (not probed)";
  }

  // Role inboxes are reachable but they are not a person — cap them so they
  // never outrank a named address in the merge.
  if (base.role_account) {
    confidence = Math.min(confidence, 0.5);
    label = `${label} — shared inbox`;
  }

  let out: EmailVerification = {
    ...base,
    confidence: Number(confidence.toFixed(2)),
    tier,
    method,
    evidence,
    label,
  };

  // 5) Paid last resort, only when the free path stayed genuinely inconclusive.
  const inconclusive = smtpOk === null && tier !== "verified" && tier !== "invalid";
  if (inconclusive && !opts.freeOnly && process.env.ZEROBOUNCE_KEY) {
    const zb = await zeroBounce(e);
    if (zb) {
      evidence.push(`ZeroBounce: ${zb.status}`);
      out = {
        ...out,
        smtp_ok: zb.valid,
        method: "zerobounce",
        confidence: zb.valid ? 0.95 : 0.1,
        tier: zb.valid ? "verified" : "invalid",
        label: zb.valid ? "Verified by ZeroBounce" : `Rejected by ZeroBounce (${zb.status})`,
      };
    }
  }

  return out;
}

/**
 * Verify a ranked list of derived candidates and return the first that holds
 * up, plus every result for the audit trail.
 *
 * Short-circuits on a catch-all domain: probing five candidates against a
 * domain that says yes to everything just burns time and produces five equally
 * meaningless "hits". One candidate, honestly labelled, is the correct output.
 */
export async function verifyCandidates(
  candidates: Array<{ email: string; prior: number; reason: string }>,
  opts: VerifyOptions = {},
): Promise<{
  best: EmailVerification | null;
  all: EmailVerification[];
  catch_all: boolean | null;
}> {
  const all: EmailVerification[] = [];
  if (!candidates.length) return { best: null, all, catch_all: null };

  const domain = candidates[0].email.split("@")[1];
  const catchAll = await detectCatchAll(domain);

  if (catchAll === true) {
    const top = await verifyEmailDeep(candidates[0].email, { ...opts, derived: true });
    all.push(top);
    return { best: top, all, catch_all: true };
  }

  for (const c of candidates) {
    const v = await verifyEmailDeep(c.email, { ...opts, derived: true });
    all.push(v);
    if (v.tier === "verified") return { best: v, all, catch_all: catchAll };
  }

  const best =
    all.filter((v) => v.tier !== "invalid").sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  return { best, all, catch_all: catchAll };
}

// ── phone verification ──────────────────────────────────────────────────────

export type PhoneVerification = {
  phone: string;
  e164: string | null;
  valid: boolean;
  country?: string;
  /** Only populated when a paid Lookup package is explicitly enabled. */
  line_type?: string;
  carrier?: string;
  confidence: number;
  method: "structural" | "libphonenumber" | "twilio_lookup";
  evidence: string[];
  label: string;
};

/**
 * Upgrade to libphonenumber-js when it's installed. It isn't a dependency —
 * the structural validator in phone.ts is the always-available floor — but if
 * the package lands in node_modules we use its far more complete metadata.
 */
async function phoneWithLibrary(raw: string, defaultCountry?: string): Promise<ParsedPhone | null> {
  try {
    // Indirect specifier on purpose: the package is NOT a dependency, so a
    // literal import would fail typecheck and bundling. This resolves at
    // runtime only if someone has installed it.
    const specifier = "libphonenumber-js";
    const mod: any = await import(/* @vite-ignore */ specifier).catch(() => null);
    if (!mod?.parsePhoneNumberFromString) return null;
    const p = mod.parsePhoneNumberFromString(raw, defaultCountry as any);
    if (!p) return null;
    return {
      e164: p.isValid() ? p.number : null,
      country: p.country,
      country_code: String(p.countryCallingCode),
      national: p.nationalNumber,
      status: p.isValid() ? "valid" : "possible",
      confidence: p.isValid() ? 0.75 : 0.3,
      reason: p.isValid()
        ? "validated against libphonenumber metadata"
        : "possible but not valid for this country",
      formatted: p.formatInternational(),
    };
  } catch {
    return null;
  }
}

/**
 * Twilio Lookup v2 — the Basic lookup (format + validity) is free. Line Type
 * Intelligence, Caller Name, and Line Status are separately billed packages
 * and are only requested when TWILIO_LOOKUP_PACKAGES is set explicitly, so
 * nobody gets a surprise bill from a lead search.
 */
async function twilioLookup(
  e164: string,
): Promise<{ valid: boolean; country?: string; line_type?: string; carrier?: string } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    const packages = (process.env.TWILIO_LOOKUP_PACKAGES || "").trim();
    const qs = packages ? `?Fields=${encodeURIComponent(packages)}` : "";
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}${qs}`,
      {
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, any>;
    return {
      valid: d.valid === true,
      country: d.country_code,
      line_type: d.line_type_intelligence?.type,
      carrier: d.line_type_intelligence?.carrier_name,
    };
  } catch {
    return null;
  }
}

/**
 * Validate a phone number: structural first (free, instant, catches 70–80% of
 * junk), library metadata if available, carrier lookup only when Twilio creds
 * exist. There is no "guess and verify" tier here — a number that wasn't found
 * somewhere cannot be validated into existence.
 */
export async function verifyPhone(
  raw: string,
  defaultCountry?: string,
): Promise<PhoneVerification> {
  const evidence: string[] = [];
  const structural = parsePhone(raw, { defaultCountry });
  evidence.push(`Structural: ${structural.reason}`);

  const library = await phoneWithLibrary(raw, defaultCountry);
  const parsed = library?.e164 ? library : structural;
  if (library) evidence.push(`libphonenumber: ${library.reason}`);

  if (!parsed.e164) {
    return {
      phone: raw,
      e164: null,
      valid: false,
      country: parsed.country,
      confidence: 0,
      method: library ? "libphonenumber" : "structural",
      evidence,
      label: `Not a valid number — ${parsed.reason}`,
    };
  }

  const lookup = await twilioLookup(parsed.e164.split(";")[0]);
  if (lookup) {
    evidence.push(
      `Twilio Lookup: ${lookup.valid ? "valid" : "invalid"}${lookup.line_type ? ` (${lookup.line_type})` : ""}`,
    );
    return {
      phone: raw,
      e164: parsed.e164,
      valid: lookup.valid,
      country: lookup.country ?? parsed.country,
      line_type: lookup.line_type,
      carrier: lookup.carrier,
      confidence: lookup.valid ? (lookup.line_type ? 0.95 : 0.85) : 0.05,
      method: "twilio_lookup",
      evidence,
      label: lookup.valid
        ? `Valid${lookup.line_type ? ` ${lookup.line_type}` : ""} number${lookup.carrier ? ` on ${lookup.carrier}` : ""}`
        : "Carrier lookup says this number is not in service",
    };
  }

  return {
    phone: raw,
    e164: parsed.e164,
    valid: true,
    country: parsed.country,
    confidence: parsed.confidence,
    method: library ? "libphonenumber" : "structural",
    evidence,
    label: `${parsed.reason} — format only, not checked against a carrier`,
  };
}
