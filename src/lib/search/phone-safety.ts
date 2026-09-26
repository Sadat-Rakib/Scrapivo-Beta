/**
 * Phone-country safety (Phase 1.5): source rows (notably Overture bulk data)
 * carry wrong-country dial codes — e.g. ~25% of `+`-prefixed phones on IN
 * rows are NANP `+1…` numbers. Displaying them is a hallucination: a Pune
 * card must never show an American number as its own.
 *
 * Rule (conservative by construction):
 *  - `+`-prefixed + row country in DIAL_MAP + code mismatch → HIDE + tag.
 *  - `+`-prefixed with <7 digits → HIDE as invalid.
 *  - No `+`, unknown country, or empty → SHOW AS-IS (`unverifiable`).
 * We only ever hide on positive evidence of wrongness — never on doubt.
 * Enforcement is serve-time (immediate, no reload, no data modification).
 */

const DIAL: Record<string, string> = {
  AE: "971",
  AM: "374",
  AR: "54",
  AT: "43",
  AU: "61",
  AZ: "994",
  BD: "880",
  BE: "32",
  BG: "359",
  BH: "973",
  BO: "591",
  BR: "55",
  CA: "1",
  CH: "41",
  CL: "56",
  CO: "57",
  CR: "506",
  CY: "357",
  CZ: "420",
  DE: "49",
  DK: "45",
  DO: "1",
  EC: "593",
  EE: "372",
  EG: "20",
  ES: "34",
  FI: "358",
  FR: "33",
  GB: "44",
  GE: "995",
  GH: "233",
  GR: "30",
  GT: "502",
  HK: "852",
  HR: "385",
  HU: "36",
  ID: "62",
  IE: "353",
  IL: "972",
  IN: "91",
  IS: "354",
  IT: "39",
  JO: "962",
  JP: "81",
  KE: "254",
  KR: "82",
  KW: "965",
  KZ: "7",
  LB: "961",
  LK: "94",
  LT: "370",
  LU: "352",
  LV: "371",
  MA: "212",
  MT: "356",
  MX: "52",
  MY: "60",
  NG: "234",
  NL: "31",
  NO: "47",
  NP: "977",
  NZ: "64",
  OM: "968",
  PA: "507",
  PE: "51",
  PH: "63",
  PK: "92",
  PL: "48",
  PR: "1",
  PT: "351",
  PY: "595",
  QA: "974",
  RO: "40",
  RS: "381",
  SA: "966",
  SE: "46",
  SG: "65",
  SI: "386",
  SK: "421",
  TH: "66",
  TN: "216",
  TR: "90",
  TW: "886",
  TZ: "255",
  UA: "380",
  US: "1",
  UY: "598",
  UZ: "998",
  VN: "84",
  ZA: "27",
};

export type PhoneStatus = "ok" | "mismatch-hidden" | "invalid-hidden" | "unverifiable";

export interface PhoneCheck {
  phone: string | null;
  status: PhoneStatus;
}

export function checkPhone(phone: unknown, countryIso: string): PhoneCheck {
  if (typeof phone !== "string") return { phone: null, status: "unverifiable" };
  const trimmed = phone.trim();
  if (!trimmed) return { phone: null, status: "unverifiable" };
  if (!trimmed.startsWith("+")) return { phone: trimmed, status: "unverifiable" };
  const digits = trimmed.slice(1).replace(/\D/g, "");
  if (digits.length < 7) return { phone: null, status: "invalid-hidden" };
  const code = DIAL[(countryIso ?? "").trim().toUpperCase()];
  if (!code) return { phone: trimmed, status: "unverifiable" };
  if (digits.startsWith(code)) return { phone: trimmed, status: "ok" };
  return { phone: null, status: "mismatch-hidden" };
}
