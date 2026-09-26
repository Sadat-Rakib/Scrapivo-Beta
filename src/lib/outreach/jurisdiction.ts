/**
 * Jurisdiction-aware outreach compliance (Phase E).
 * Maps lead geo → GDPR (EEA/UK) | CASL (Canada) | CAN-SPAM (+ CCPA when CA) | generic.
 * Never invents consent — only selects which ruleset to enforce in drafts/gates.
 */

export type OutreachJurisdiction = "gdpr" | "casl" | "can_spam" | "can_spam_ccpa" | "generic";

const EEA_ISO = new Set([
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu",
  "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es",
  "se", "is", "li", "no", // EEA extras
  "gb", "uk", // UK treated as GDPR-style for commercial email purpose
]);

const CASL_ISO = new Set(["ca"]);

const US_ISO = new Set(["us", "usa"]);

/** California signals in free-text location. */
const CALIFORNIA_RE =
  /\b(california|ca\b|los angeles|san francisco|san diego|oakland|sacramento|bay area|sf\b|la\b)/i;

export function resolveJurisdiction(opts: {
  country?: string | null;
  location?: string | null;
  region?: string | null;
}): OutreachJurisdiction {
  const country = (opts.country ?? "").trim().toLowerCase();
  const loc = `${opts.location ?? ""} ${opts.region ?? ""}`.trim();

  if (CASL_ISO.has(country) || /\bcanada\b|\bontario\b|\balberta\b|\bquebec\b|\bbc\b/i.test(loc)) {
    return "casl";
  }
  if (EEA_ISO.has(country) || /\b(united kingdom|england|scotland|wales|europe|eu\b|germany|france|spain|italy|netherlands|ireland|sweden|poland)/i.test(loc)) {
    return "gdpr";
  }
  if (US_ISO.has(country) || /\bunited states\b|\busa\b|\bu\.s\./i.test(loc)) {
    if (CALIFORNIA_RE.test(loc) || country === "ca") {
      // Ambiguous "CA": if country is US-ish or location says California → CCPA.
      if (US_ISO.has(country) || CALIFORNIA_RE.test(loc)) return "can_spam_ccpa";
    }
    return "can_spam";
  }
  if (CALIFORNIA_RE.test(loc)) return "can_spam_ccpa";
  return "generic";
}

export type JurisdictionDraftHints = {
  jurisdiction: OutreachJurisdiction;
  /** Footer / compliance lines to append to email drafts. */
  footerLines: string[];
  /** Short label for UI. */
  label: string;
};

export function jurisdictionDraftHints(j: OutreachJurisdiction): JurisdictionDraftHints {
  switch (j) {
    case "gdpr":
      return {
        jurisdiction: j,
        label: "GDPR (EEA/UK)",
        footerLines: [
          "This message is sent based on a legitimate interest in a business contact relevant to your role.",
          "You can request access, correction, or erasure of your data, or opt out of further messages, by replying STOP or using the unsubscribe link.",
        ],
      };
    case "casl":
      return {
        jurisdiction: j,
        label: "CASL (Canada)",
        footerLines: [
          "This commercial electronic message complies with CASL. You may unsubscribe at any time by replying STOP.",
          "Sender identification and a working unsubscribe mechanism are required under Canadian law.",
        ],
      };
    case "can_spam_ccpa":
      return {
        jurisdiction: j,
        label: "CAN-SPAM + CCPA (California)",
        footerLines: [
          "This is a commercial message. You can opt out by replying STOP or using the unsubscribe link.",
          "California residents may request access to or deletion of personal information under the CCPA.",
        ],
      };
    case "can_spam":
      return {
        jurisdiction: j,
        label: "CAN-SPAM (US)",
        footerLines: [
          "This is a commercial message. Reply STOP or use the unsubscribe link to opt out.",
          "A valid physical postal address of the sender is included per CAN-SPAM.",
        ],
      };
    default:
      return {
        jurisdiction: j,
        label: "Professional (general)",
        footerLines: [
          "If this isn't relevant, reply STOP and we won't contact you again.",
        ],
      };
  }
}
