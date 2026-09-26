const ORGANIZATIONS = new Set(["business", "company", "organization"]);

export function isOrganization(value: string): boolean {
  return ORGANIZATIONS.has(value);
}

/** Canonical day count for duration spellings used by UnderstandingFrame. */
export function normalizedDurationDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(d|day|days|w|week|weeks|mo|month|months)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) return null;
  if (unit === "d" || unit === "day" || unit === "days") return amount;
  if (unit === "w" || unit === "week" || unit === "weeks") return amount * 7;
  return amount * 30;
}

export function equivalentDuration(
  actual: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = normalizedDurationDays(actual);
  const b = normalizedDurationDays(expected);
  return a !== null && b !== null && a === b;
}
