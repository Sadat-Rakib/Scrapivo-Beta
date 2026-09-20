import type { FieldEvidence, OperationalStatus } from "./types";

const TEMPORARY = /\b(temporarily closed|temporarily unavailable|closed temporarily)\b/i;
const PERMANENT = /\b(permanently closed|closed permanently|out of business|ceased operations)\b/i;
const INACTIVE = /\b(inactive|dissolved|struck off|no longer operating)\b/i;
const ACTIVE = /\b(open now|currently open|business hours|open today|accepting (new )?(customers|clients)|operating)\b/i;

export function detectOperationalStatus(observations: string[]): OperationalStatus {
  const text = observations.filter(Boolean).join("\n");
  if (TEMPORARY.test(text)) return "TEMPORARILY_CLOSED";
  if (PERMANENT.test(text)) return "PERMANENTLY_CLOSED";
  if (INACTIVE.test(text)) return "INACTIVE";
  if (ACTIVE.test(text)) return "ACTIVE";
  return "UNKNOWN";
}

export function operationalStatusAccepted(
  status: OperationalStatus,
  includeInactive = false,
): boolean {
  if (includeInactive) return true;
  return status !== "TEMPORARILY_CLOSED" &&
    status !== "PERMANENTLY_CLOSED" &&
    status !== "INACTIVE";
}

export function statusEvidence(args: {
  status: OperationalStatus;
  sourceUrl: string;
  observation: string;
  observedAt?: string;
}): FieldEvidence {
  return {
    field: "operational_status",
    value: args.status,
    sourceUrl: args.sourceUrl,
    sourceType: "browser",
    observedAt: args.observedAt ?? new Date().toISOString(),
    evidenceGrade: "A",
    confidence: args.status === "UNKNOWN" ? 0.2 : 0.9,
    note: args.observation,
  };
}
