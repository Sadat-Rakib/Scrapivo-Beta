/**
 * Legitimacy scoring — "verified and valid, not some scammer".
 *
 * Pure module (no network): scores each lead on red flags (scam patterns)
 * vs green flags (identity/corroboration). Leads classified "scam" are
 * dropped by the pipeline; the rest carry a verification level shown on
 * their card: verified > checked > unverified.
 */
import type { Lead } from "../scoring";

export type VerificationLevel = "verified" | "checked" | "unverified" | "scam";

// Hard scam patterns — any 1 of these plus one soft flag (or 2 hard) = scam.
const HARD_RED_FLAGS: Array<{ re: RegExp; flag: string }> = [
  {
    re: /\b(registration|processing|training|application|starter|kit)\s+fee\b/i,
    flag: "asks for an upfront fee",
  },
  {
    re: /\bpay\s+to\s+apply\b|\bsend\s+(us\s+)?money\b|\bdeposit\s+required\b/i,
    flag: "asks for money to apply",
  },
  { re: /\bgift\s?cards?\b/i, flag: "gift-card payment" },
  { re: /\b(crypto|bitcoin|usdt|btc)\s+(payment|only)\b/i, flag: "crypto-only payment" },
  {
    re: /\bsend\s+(your\s+)?(bank|card|ssn|passport|id)\b/i,
    flag: "requests sensitive credentials",
  },
  { re: /\bearn\s+\$?\d{3,}\s*(\/|per\s*)(day|hour)\b/i, flag: "unrealistic pay promise" },
  {
    re: /\bno\s+(experience|skills?|interview)\s+(needed|required)\b.{0,40}\b(earn|\$)/i,
    flag: "no-experience easy-money pitch",
  },
  { re: /\bguaranteed\s+income\b|\bmake\s+money\s+fast\b/i, flag: "guaranteed-income pitch" },
];

// Soft red flags — suspicious alone, damning in combination.
const SOFT_RED_FLAGS: Array<{ re: RegExp; flag: string }> = [
  { re: /\b(telegram|t\.me\/)\b(?!.*(interview|call|meeting))/i, flag: "Telegram-only contact" },
  { re: /\bwhatsapp\s+(me|only|\+?\d)/i, flag: "WhatsApp-only contact" },
  { re: /\b(dm|message)\s+me\s+(now|fast|quick|asap)\b/i, flag: "pressure to DM immediately" },
  { re: /\bweekly\s+payout\b.{0,40}\bno\b/i, flag: "payout promise without scope" },
  { re: /\blimited\s+slots?\b|\bonly\s+\d+\s+spots?\b/i, flag: "artificial scarcity" },
  {
    re: /\bwestern\s+union\b|\bwire\s+transfer\s+(first|upfront)\b/i,
    flag: "irregular payment channel",
  },
];

// Sources whose content is platform-moderated listings — inherently "checked".
const MODERATED_SOURCES = new Set([
  "remoteok",
  "remotive",
  "jobicy",
  "arbeitnow",
  "themuse",
  "weworkremotely",
  "usajobs",
  "samgov",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "greenhouse",
  "upwork",
  "workatastartup",
  "secedgar",
  "news",
  "linkedin",
  "githubjobs",
]);

export type LegitimacyResult = {
  level: VerificationLevel;
  flags: string[]; // red flags found (shown on hover/detail)
  proofs: string[]; // green signals backing the level
};

const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;

export function scoreLegitimacy(lead: Lead): LegitimacyResult {
  const text = `${lead.title || ""}\n${lead.snippet || ""}`;
  const flags: string[] = [];
  const proofs: string[] = [];

  let hard = 0;
  let soft = 0;
  for (const { re, flag } of HARD_RED_FLAGS) {
    if (re.test(text)) {
      hard++;
      flags.push(flag);
    }
  }
  for (const { re, flag } of SOFT_RED_FLAGS) {
    if (re.test(text)) {
      soft++;
      flags.push(flag);
    }
  }

  if (hard >= 2 || (hard >= 1 && soft >= 1)) {
    return { level: "scam", flags, proofs };
  }

  // Green signals
  let green = 0;
  if (MODERATED_SOURCES.has(lead.source)) {
    green += 2;
    proofs.push("Listed on a moderated platform");
  }
  if (DOMAIN_RE.test(lead.snippet || "") || DOMAIN_RE.test(lead.author_url || "")) {
    green += 1;
    proofs.push("Company/site identity present");
  }
  if ((lead.also_seen_on?.length ?? 0) > 0) {
    green += 2;
    proofs.push("Corroborated on multiple platforms");
  }
  if (lead.is_decision_maker) {
    green += 1;
    proofs.push("Decision-maker identity");
  }
  if ((lead.engagement ?? 0) >= 10) {
    green += 1;
    proofs.push("Real engagement on the post");
  }
  if (lead.has_budget) {
    green += 1;
    proofs.push("Concrete budget/compensation");
  }
  if (lead.ai_intent === "hiring" || lead.ai_intent === "buying") {
    green += 1;
    proofs.push("AI-verified buyer intent");
  }

  // A hard flag alone (no corroborating soft flag) → heavily distrusted.
  if (hard >= 1) return { level: "unverified", flags, proofs };

  const level: VerificationLevel =
    green >= 4 && soft === 0 ? "verified" : green >= 2 && soft <= 1 ? "checked" : "unverified";
  return { level, flags, proofs };
}
