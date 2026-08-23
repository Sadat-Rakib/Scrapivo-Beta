/**
 * Scrapivo — canonical money parsing & formatting.
 *
 * Every currency value rendered anywhere in the app (cards, list rows,
 * filters, Details drawer, summaries, CSV exports, search results) must flow
 * through this module so magnitude units (K/M/B) are preserved exactly as the
 * source states them. `$1M` must never become `$1`; a parsed value is never
 * divided or multiplied twice.
 */

export type MoneyUnit = "K" | "M" | "B";

export interface ParsedMoney {
  /** Numeric part exactly as written in the source (1.5 for "$1.5B"). */
  amount: number;
  /** Magnitude unit exactly as written in the source; null when absent. */
  unit: MoneyUnit | null;
  /** Canonical short display text, e.g. "$1.5B". */
  text: string;
  /** Approximate USD value — for comparisons/sorting only, never shown. */
  usd: number;
}

const UNIT_MULT: Record<MoneyUnit, number> = { K: 1e3, M: 1e6, B: 1e9 };

const WORD_UNITS: Record<string, MoneyUnit> = {
  thousand: "K",
  k: "K",
  million: "M",
  m: "M",
  billion: "B",
  b: "B",
};

function fromParts(amount: number, unit: MoneyUnit | null): ParsedMoney | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const text = `$${trimNum(amount)}${unit ?? ""}`;
  return { amount, unit, text, usd: amount * (unit ? UNIT_MULT[unit] : 1) };
}

const trimNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

/**
 * Parse a single money token ("$1.5B", "200M", "$50K", 500000, "1 million").
 * Returns null for ranges, malformed, or non-positive input — callers must
 * never silently coerce a range or garbage into a single value.
 */
export function parseMoney(raw: unknown): ParsedMoney | null {
  if (typeof raw === "number") return fromParts(raw, null);
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || /[-–—]|\bto\b/i.test(s)) return null; // a range, not a single value
  const m = s.match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*(K|M|B|thousand|million|billion)?\s*$/i);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  const unit = m[2] ? (WORD_UNITS[m[2].toLowerCase()] ?? null) : null;
  return fromParts(amount, unit);
}

export interface ParsedMoneyRange {
  min: ParsedMoney | null;
  max: ParsedMoney | null;
  /** Canonical display text preserving both magnitudes. */
  text: string;
}

/** Parse "$100K - $1.5M" style ranges, preserving each endpoint's unit. */
export function parseMoneyRange(raw: unknown): ParsedMoneyRange | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(/\s+[-–—]\s+|\s+to\s+/i).map((p) => p.trim());
  if (parts.length !== 2) return null;
  const min = parseMoney(parts[0]);
  const max = parseMoney(parts[1]);
  if (!min && !max) return null;
  return { min, max, text: `${min?.text ?? "?"} - ${max?.text ?? "?"}` };
}

/**
 * Format a plain USD number with an appropriate magnitude unit
 * (500000 → "$500K", 7000000 → "$7M"). Used only for numeric source fields;
 * string fields keep their own unit via {@link displayMoney}.
 */
export function formatUsd(raw: unknown): string | null {
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `$${trimNum(n / 1e9)}B`;
  if (n >= 1e6) return `$${trimNum(n / 1e6)}M`;
  if (n >= 1e3) return `$${trimNum(n / 1e3)}K`;
  return `$${trimNum(n)}`;
}

/**
 * The display text for a money field: the source's own string when it carries
 * a value (units preserved verbatim), otherwise a numeric field formatted
 * with magnitude. Never strips a K/M/B suffix, never invents one.
 */
export function displayMoney(raw: unknown): string | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    const range = parseMoneyRange(s);
    if (range) return range.text;
    const single = parseMoney(s);
    if (single) return single.text;
    // Not parseable as money at all — return the source text untouched
    // rather than guessing (e.g. "Undisclosed", "Varies").
    return s;
  }
  return formatUsd(raw);
}

/** Range from numeric min/max endpoints, preferring the source raw string. */
export function displayMoneyRange(raw: unknown, min?: unknown, max?: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) {
    const parsed = parseMoneyRange(raw);
    if (parsed) return parsed.text;
    const single = parseMoney(raw);
    if (single) return single.text;
    return raw.trim();
  }
  const lo = formatUsd(min ?? undefined);
  const hi = formatUsd(max ?? undefined);
  if (lo && hi) return `${lo} - ${hi}`;
  return lo ?? hi ?? null;
}
