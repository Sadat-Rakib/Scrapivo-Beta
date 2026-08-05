// =====================================================================
// Phone parsing & structural validation (dependency-free)
//
// The asymmetry that shapes this whole module: emails are DERIVABLE, phones
// are not. Nothing generates +1-403-555-0182 from a name — every number has to
// be found somewhere. So there is no "guess and verify" tier here; there is
// only "we found it, is it structurally real?".
//
// What this file does: normalise to E.164, check the country calling code,
// check the national length against that country's plan, and apply the
// structural rules that catch the overwhelming majority of junk scraped off
// web pages (NANP N11 area codes, fictional 555-01xx numbers, repeated digits,
// timestamps and prices that regexes mistake for phone numbers).
//
// What it does NOT do: tell you whether the line is live, mobile, or VoIP.
// That needs carrier/HLR data — see lookupPhone() in verify-contact.server.ts,
// which uses Twilio's free Basic Lookup. Format-only validation catches roughly
// 70–80% of bad numbers; carrier lookup gets you to 95%+.
//
// If `libphonenumber-js` is ever added to package.json, parsePhone upgrades to
// it automatically via a dynamic import (see phoneWithLibrary in
// verify-contact.server.ts). This module stays the always-available floor.
// =====================================================================

export type PhoneStatus =
  | "valid" // structurally sound for its country plan
  | "possible" // plausible but the country's rules aren't modelled here
  | "too_short"
  | "too_long"
  | "unknown_country"
  | "invalid_prefix" // e.g. NANP area code starting with 0/1, or an N11 code
  | "fictional" // 555-01xx and friends — reserved for drama, not people
  | "not_a_number";

export type ParsedPhone = {
  /** +14035550182 — the only form worth storing. */
  e164: string | null;
  /** ISO-3166 alpha-2 when derivable from the calling code. */
  country?: string;
  country_code?: string; // "1", "44", "880" …
  national: string;
  status: PhoneStatus;
  /** 0..1 confidence that this is a real, dialable number. */
  confidence: number;
  /** Human-readable reason — surfaced in the UI, not just logs. */
  reason: string;
  /** Best-effort pretty form for display. */
  formatted?: string;
};

// Calling code → { primary ISO country, national significant number length range }.
// Covers the codes that actually show up in B2B lead data; anything outside the
// table still parses, it just returns "possible" instead of "valid" rather than
// pretending to know a plan it doesn't.
type PlanEntry = { country: string; min: number; max: number };
const CALLING_CODES: Record<string, PlanEntry> = {
  "1": { country: "US", min: 10, max: 10 }, // NANP: US/CA + Caribbean
  "7": { country: "RU", min: 10, max: 10 },
  "20": { country: "EG", min: 9, max: 10 },
  "27": { country: "ZA", min: 9, max: 9 },
  "30": { country: "GR", min: 10, max: 10 },
  "31": { country: "NL", min: 9, max: 9 },
  "32": { country: "BE", min: 8, max: 9 },
  "33": { country: "FR", min: 9, max: 9 },
  "34": { country: "ES", min: 9, max: 9 },
  "36": { country: "HU", min: 8, max: 9 },
  "39": { country: "IT", min: 6, max: 11 },
  "40": { country: "RO", min: 9, max: 9 },
  "41": { country: "CH", min: 9, max: 9 },
  "43": { country: "AT", min: 7, max: 13 },
  "44": { country: "GB", min: 9, max: 10 },
  "45": { country: "DK", min: 8, max: 8 },
  "46": { country: "SE", min: 7, max: 9 },
  "47": { country: "NO", min: 8, max: 8 },
  "48": { country: "PL", min: 9, max: 9 },
  "49": { country: "DE", min: 6, max: 13 },
  "51": { country: "PE", min: 8, max: 9 },
  "52": { country: "MX", min: 10, max: 10 },
  "53": { country: "CU", min: 6, max: 8 },
  "54": { country: "AR", min: 10, max: 11 },
  "55": { country: "BR", min: 10, max: 11 },
  "56": { country: "CL", min: 9, max: 9 },
  "57": { country: "CO", min: 10, max: 10 },
  "58": { country: "VE", min: 10, max: 10 },
  "60": { country: "MY", min: 9, max: 10 },
  "61": { country: "AU", min: 9, max: 9 },
  "62": { country: "ID", min: 9, max: 12 },
  "63": { country: "PH", min: 10, max: 10 },
  "64": { country: "NZ", min: 8, max: 10 },
  "65": { country: "SG", min: 8, max: 8 },
  "66": { country: "TH", min: 9, max: 9 },
  "81": { country: "JP", min: 9, max: 10 },
  "82": { country: "KR", min: 9, max: 10 },
  "84": { country: "VN", min: 9, max: 10 },
  "86": { country: "CN", min: 11, max: 11 },
  "90": { country: "TR", min: 10, max: 10 },
  "91": { country: "IN", min: 10, max: 10 },
  "92": { country: "PK", min: 10, max: 10 },
  "93": { country: "AF", min: 9, max: 9 },
  "94": { country: "LK", min: 9, max: 9 },
  "95": { country: "MM", min: 8, max: 10 },
  "98": { country: "IR", min: 10, max: 10 },
  "212": { country: "MA", min: 9, max: 9 },
  "213": { country: "DZ", min: 9, max: 9 },
  "216": { country: "TN", min: 8, max: 8 },
  "218": { country: "LY", min: 9, max: 9 },
  "220": { country: "GM", min: 7, max: 7 },
  "233": { country: "GH", min: 9, max: 9 },
  "234": { country: "NG", min: 10, max: 10 },
  "251": { country: "ET", min: 9, max: 9 },
  "254": { country: "KE", min: 9, max: 9 },
  "255": { country: "TZ", min: 9, max: 9 },
  "256": { country: "UG", min: 9, max: 9 },
  "260": { country: "ZM", min: 9, max: 9 },
  "263": { country: "ZW", min: 9, max: 9 },
  "351": { country: "PT", min: 9, max: 9 },
  "352": { country: "LU", min: 6, max: 11 },
  "353": { country: "IE", min: 7, max: 9 },
  "354": { country: "IS", min: 7, max: 9 },
  "355": { country: "AL", min: 8, max: 9 },
  "356": { country: "MT", min: 8, max: 8 },
  "357": { country: "CY", min: 8, max: 8 },
  "358": { country: "FI", min: 5, max: 12 },
  "359": { country: "BG", min: 8, max: 9 },
  "370": { country: "LT", min: 8, max: 8 },
  "371": { country: "LV", min: 8, max: 8 },
  "372": { country: "EE", min: 7, max: 8 },
  "375": { country: "BY", min: 9, max: 9 },
  "380": { country: "UA", min: 9, max: 9 },
  "381": { country: "RS", min: 8, max: 9 },
  "385": { country: "HR", min: 8, max: 9 },
  "386": { country: "SI", min: 8, max: 8 },
  "420": { country: "CZ", min: 9, max: 9 },
  "421": { country: "SK", min: 9, max: 9 },
  "852": { country: "HK", min: 8, max: 8 },
  "855": { country: "KH", min: 8, max: 9 },
  "856": { country: "LA", min: 8, max: 10 },
  "880": { country: "BD", min: 10, max: 10 },
  "886": { country: "TW", min: 9, max: 9 },
  "961": { country: "LB", min: 7, max: 8 },
  "962": { country: "JO", min: 9, max: 9 },
  "963": { country: "SY", min: 9, max: 9 },
  "964": { country: "IQ", min: 10, max: 10 },
  "965": { country: "KW", min: 8, max: 8 },
  "966": { country: "SA", min: 9, max: 9 },
  "968": { country: "OM", min: 8, max: 8 },
  "971": { country: "AE", min: 9, max: 9 },
  "972": { country: "IL", min: 8, max: 9 },
  "973": { country: "BH", min: 8, max: 8 },
  "974": { country: "QA", min: 8, max: 8 },
  "975": { country: "BT", min: 8, max: 8 },
  "976": { country: "MN", min: 8, max: 8 },
  "977": { country: "NP", min: 9, max: 10 },
  "992": { country: "TJ", min: 9, max: 9 },
  "994": { country: "AZ", min: 9, max: 9 },
  "995": { country: "GE", min: 9, max: 9 },
  "998": { country: "UZ", min: 9, max: 9 },
};

// Longest-prefix-first so "1" doesn't swallow "1xx"-shaped 3-digit codes.
const SORTED_CODES = Object.keys(CALLING_CODES).sort((a, b) => b.length - a.length);

/** ISO-2 → calling code, for the `defaultCountry` path. */
const COUNTRY_TO_CODE: Record<string, string> = Object.entries(CALLING_CODES).reduce(
  (acc, [code, plan]) => {
    if (!acc[plan.country]) acc[plan.country] = code;
    return acc;
  },
  { CA: "1", PR: "1", GB: "44" } as Record<string, string>,
);

/** NANP area codes reserved for services, not subscribers. */
const NANP_SERVICE_NPA = new Set(["911", "411", "611", "811", "211", "311", "511", "711", "000"]);
/** Toll-free NPAs — valid, but a main line rather than a person. */
const NANP_TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** Strip UI noise that regex harvesting drags along: extensions, labels, ranges. */
function preclean(raw: string): { body: string; extension?: string } {
  let s = (raw || "").trim();
  // "+1 403 555 0182 ext. 12" / "x12" / "#12"
  const extMatch = /(?:\b(?:ext|extension|x|poste|durchwahl)\b\.?\s*|#)\s*(\d{1,6})\s*$/i.exec(s);
  let extension: string | undefined;
  if (extMatch) {
    extension = extMatch[1];
    s = s.slice(0, extMatch.index);
  }
  // Drop anything after a separator that starts a second number ("… / …").
  s = s.split(/\s*(?:\/|,|;|\bor\b)\s*/i)[0];
  // Common international prefixes → "+"
  s = s.replace(/^\s*(?:00|011)\s*/, "+");
  return { body: s, extension };
}

/**
 * Reject strings that a loose phone regex grabs but a human never would:
 * dates, prices, ISBNs, IDs, and runs of identical/sequential digits.
 */
function looksFabricated(digits: string): string | null {
  if (/^(\d)\1+$/.test(digits)) return "all digits identical";
  if (/^(?:0123456789|1234567890|9876543210)/.test(digits)) return "sequential digits";
  if (/(\d)\1{6,}/.test(digits)) return "seven or more repeated digits";
  // 2026-07-29-ish or 20260729
  if (
    /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/.test(digits) &&
    digits.length <= 10
  ) {
    return "looks like a date";
  }
  return null;
}

/** NANP structural rules — these alone kill most scraped junk in +1 land. */
function validateNanp(national: string): { ok: boolean; reason: string; tollFree: boolean } {
  const npa = national.slice(0, 3);
  const nxx = national.slice(3, 6);
  const line = national.slice(6);
  if (npa[0] === "0" || npa[0] === "1")
    return { ok: false, reason: "area code cannot start with 0 or 1", tollFree: false };
  if (NANP_SERVICE_NPA.has(npa))
    return { ok: false, reason: `${npa} is a service code, not an area code`, tollFree: false };
  if (npa[1] === "1" && npa[2] === "1")
    return { ok: false, reason: `${npa} is an N11 service code`, tollFree: false };
  if (nxx[0] === "0" || nxx[0] === "1")
    return { ok: false, reason: "exchange code cannot start with 0 or 1", tollFree: false };
  // 555-0100 through 555-0199 are permanently reserved for fiction.
  if (nxx === "555" && line >= "0100" && line <= "0199") {
    return { ok: false, reason: "555-01XX is reserved for fictional use", tollFree: false };
  }
  return { ok: true, reason: "", tollFree: NANP_TOLL_FREE.has(npa) };
}

export type ParseOptions = {
  /** ISO-2 country to assume when the number has no "+" prefix. */
  defaultCountry?: string;
};

/**
 * Parse and structurally validate a phone number.
 *
 * Numbers without a "+" are ambiguous, so we only accept them when a
 * defaultCountry is supplied (from the company's registry/address data) or
 * when the digit count matches a NANP number exactly. Guessing a country for a
 * bare 9-digit string produces garbage that looks authoritative — worse than
 * returning "unknown_country".
 */
export function parsePhone(raw: string, opts: ParseOptions = {}): ParsedPhone {
  const fail = (status: PhoneStatus, reason: string, national = ""): ParsedPhone => ({
    e164: null,
    national,
    status,
    confidence: 0,
    reason,
  });

  const { body, extension } = preclean(raw);
  if (!body || !/\d/.test(body)) return fail("not_a_number", "no digits found");

  const hasPlus = body.trim().startsWith("+");
  let digits = digitsOnly(body);
  if (!digits) return fail("not_a_number", "no digits found");

  const fabricated = looksFabricated(digits);
  if (fabricated) return fail("fictional", fabricated, digits);

  let code: string | undefined;

  if (hasPlus) {
    code = SORTED_CODES.find((c) => digits.startsWith(c));
    if (!code) {
      return {
        e164: `+${digits}`,
        national: digits,
        status: "unknown_country",
        confidence: 0.25,
        reason: "calling code not recognised",
      };
    }
    digits = digits.slice(code.length);
  } else {
    const cc = opts.defaultCountry ? COUNTRY_TO_CODE[opts.defaultCountry.toUpperCase()] : undefined;
    if (cc === "1" && digits.length === 11 && digits.startsWith("1")) {
      code = "1";
      digits = digits.slice(1);
    } else if (cc) {
      code = cc;
      // Strip a national trunk prefix ("0" in most of Europe/Asia).
      const plan = CALLING_CODES[cc];
      if (digits.startsWith("0") && digits.length > plan.max) digits = digits.replace(/^0+/, "");
    } else if (digits.length === 11 && digits.startsWith("1")) {
      code = "1";
      digits = digits.slice(1);
    } else if (digits.length === 10) {
      // Only accept a bare 10-digit string as NANP if it passes NANP rules —
      // that check is strict enough to make the assumption defensible.
      const probe = validateNanp(digits);
      if (!probe.ok) {
        return fail(
          "unknown_country",
          "no country code and the number is not a valid NANP number",
          digits,
        );
      }
      code = "1";
    } else {
      return fail("unknown_country", "no country code and no default country to assume", digits);
    }
  }

  const plan = CALLING_CODES[code];
  const national = digits;
  const e164 = `+${code}${national}`;

  if (!plan) {
    return {
      e164,
      country_code: code,
      national,
      status: "possible",
      confidence: 0.3,
      reason: "country plan not modelled",
    };
  }
  if (national.length < plan.min) {
    return {
      e164: null,
      country: plan.country,
      country_code: code,
      national,
      status: "too_short",
      confidence: 0,
      reason: `${national.length} digits — ${plan.country} numbers have ${plan.min === plan.max ? plan.min : `${plan.min}–${plan.max}`}`,
    };
  }
  if (national.length > plan.max) {
    return {
      e164: null,
      country: plan.country,
      country_code: code,
      national,
      status: "too_long",
      confidence: 0,
      reason: `${national.length} digits — ${plan.country} numbers have ${plan.min === plan.max ? plan.min : `${plan.min}–${plan.max}`}`,
    };
  }

  let confidence = 0.6;
  let reason = `valid ${plan.country} format`;
  const status: PhoneStatus = "valid";

  if (code === "1") {
    const nanp = validateNanp(national);
    if (!nanp.ok) {
      return {
        e164: null,
        country: plan.country,
        country_code: code,
        national,
        status: nanp.reason.includes("fictional") ? "fictional" : "invalid_prefix",
        confidence: 0,
        reason: nanp.reason,
      };
    }
    confidence = nanp.tollFree ? 0.55 : 0.7;
    reason = nanp.tollFree
      ? "valid NANP toll-free number (likely a main line)"
      : "valid NANP number";
  }

  return {
    e164: extension ? `${e164};ext=${extension}` : e164,
    country: plan.country,
    country_code: code,
    national,
    status,
    confidence,
    reason,
    formatted: formatPhone(code, national, extension),
  };
}

/** Light international formatting — NANP gets its familiar grouping. */
export function formatPhone(code: string, national: string, extension?: string): string {
  const ext = extension ? ` ext. ${extension}` : "";
  if (code === "1" && national.length === 10) {
    return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}${ext}`;
  }
  const groups = national.replace(/(\d{2,3})(?=\d)/g, "$1 ").trim();
  return `+${code} ${groups}${ext}`;
}

/** True when the number is a company main line rather than a person's direct dial. */
export function isLikelyMainLine(parsed: ParsedPhone): boolean {
  if (!parsed.e164) return false;
  if (parsed.country_code === "1" && NANP_TOLL_FREE.has(parsed.national.slice(0, 3))) return true;
  // A trailing run of zeros is the classic switchboard shape (…555 0000).
  return /0{3}$/.test(parsed.national);
}

/**
 * Normalise + dedupe a batch of harvested numbers, keeping only structurally
 * sound ones. Returns them E.164-keyed so the same number written four
 * different ways on four pages collapses to one record.
 */
export function normalizePhones(raws: string[], opts: ParseOptions = {}): ParsedPhone[] {
  const byE164 = new Map<string, ParsedPhone>();
  for (const raw of raws) {
    const p = parsePhone(raw, opts);
    if (!p.e164 || (p.status !== "valid" && p.status !== "possible")) continue;
    const existing = byE164.get(p.e164);
    if (!existing || p.confidence > existing.confidence) byE164.set(p.e164, p);
  }
  return [...byE164.values()].sort((a, b) => b.confidence - a.confidence);
}
