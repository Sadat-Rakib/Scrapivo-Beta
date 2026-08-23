/**
 * PRD §6 — currency magnitude must survive the whole pipeline.
 * `$1M` must never render as `$1`; ranges keep both endpoints' units.
 */
import { describe, expect, it } from "vitest";
import { displayMoney, displayMoneyRange, formatUsd, parseMoney, parseMoneyRange } from "../money";

describe("parseMoney", () => {
  it.each([
    ["$1M", 1, "M", 1_000_000],
    ["$10M", 10, "M", 10_000_000],
    ["$200M", 200, "M", 200_000_000],
    ["$1.5B", 1.5, "B", 1_500_000_000],
    ["$50K", 50, "K", 50_000],
    ["200M", 200, "M", 200_000_000],
    ["1 million", 1, "M", 1_000_000],
  ])("parses %s with its magnitude intact", (raw, amount, unit, usd) => {
    const p = parseMoney(raw);
    expect(p).not.toBeNull();
    expect(p?.amount).toBe(amount);
    expect(p?.unit).toBe(unit);
    expect(p?.usd).toBe(usd);
  });

  it("never interprets $1M as one dollar", () => {
    const p = parseMoney("$1M");
    expect(p?.usd).toBe(1_000_000);
    expect(p?.text).toBe("$1M");
  });

  it("parses plain numbers without inventing a unit", () => {
    const p = parseMoney(500000);
    expect(p?.amount).toBe(500000);
    expect(p?.unit).toBeNull();
  });

  it("rejects ranges, malformed, and non-positive input", () => {
    expect(parseMoney("$100K - $1.5M")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(-5)).toBeNull();
    expect(parseMoney("$")).toBeNull();
  });
});

describe("parseMoneyRange", () => {
  it("keeps each endpoint's unit", () => {
    const r = parseMoneyRange("$100K - $1.5M");
    expect(r?.min?.text).toBe("$100K");
    expect(r?.max?.text).toBe("$1.5M");
    expect(r?.text).toBe("$100K - $1.5M");
  });

  it("handles en-dash and 'to' separators", () => {
    expect(parseMoneyRange("$1M – $100M")?.text).toBe("$1M - $100M");
    expect(parseMoneyRange("$1M to $100M")?.text).toBe("$1M - $100M");
  });

  it("returns null for non-ranges", () => {
    expect(parseMoneyRange("$1M")).toBeNull();
    expect(parseMoneyRange(null)).toBeNull();
    expect(parseMoneyRange(123)).toBeNull();
  });
});

describe("displayMoney", () => {
  it.each([
    ["$1M", "$1M"],
    ["$10M", "$10M"],
    ["$200M", "$200M"],
    ["$1.5B", "$1.5B"],
    ["$50K", "$50K"],
    ["$100K - $1.5M", "$100K - $1.5M"],
    ["$1M - $100M", "$1M - $100M"],
  ])("renders %s as %s (full magnitude)", (raw, expected) => {
    expect(displayMoney(raw)).toBe(expected);
  });

  it("keeps unparseable source text verbatim instead of guessing", () => {
    expect(displayMoney("Undisclosed")).toBe("Undisclosed");
    expect(displayMoney("$1")).toBe("$1"); // bare values are shown as written
  });

  it("formats numeric fields with magnitude units", () => {
    expect(displayMoney(500000)).toBe("$500K");
    expect(displayMoney(7000000)).toBe("$7M");
    expect(displayMoney(2500000000)).toBe("$2.5B");
  });

  it("handles null/empty without crashing", () => {
    expect(displayMoney(null)).toBeNull();
    expect(displayMoney(undefined)).toBeNull();
    expect(displayMoney("")).toBeNull();
    expect(displayMoney(0)).toBeNull();
    expect(displayMoney("   ")).toBeNull();
  });
});

describe("displayMoneyRange", () => {
  it("prefers the source raw string", () => {
    expect(displayMoneyRange("$100K - $1.5M", 100000, 1500000)).toBe("$100K - $1.5M");
  });

  it("falls back to numeric endpoints with magnitude", () => {
    expect(displayMoneyRange(null, 100000, 1500000)).toBe("$100K - $1.5M");
    expect(displayMoneyRange(undefined, 1000000, 100000000)).toBe("$1M - $100M");
  });

  it("returns a single endpoint when only one exists", () => {
    expect(displayMoneyRange(null, 250000)).toBe("$250K");
  });

  it("returns null when nothing is populated", () => {
    expect(displayMoneyRange(null)).toBeNull();
    expect(displayMoneyRange("")).toBeNull();
  });
});

describe("formatUsd", () => {
  it("never divides twice — one magnitude conversion", () => {
    expect(formatUsd(1_000_000)).toBe("$1M");
    expect(formatUsd("7000000")).toBe("$7M");
    expect(formatUsd(950)).toBe("$950");
    expect(formatUsd(null)).toBeNull();
    expect(formatUsd("garbage")).toBeNull();
  });
});
