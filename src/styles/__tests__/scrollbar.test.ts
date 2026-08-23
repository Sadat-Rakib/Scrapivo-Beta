/**
 * PRD §2/§13 — the dark integrated scrollbar must stay wired into the
 * global stylesheet (dark tokens, rounded thumb, no white track).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../../styles.css", import.meta.url)), "utf8");

describe("dark integrated scrollbar", () => {
  it("styles the webkit thumb with a subtle dark-theme appearance", () => {
    expect(css).toContain("*::-webkit-scrollbar-thumb");
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*{[^}]*border-radius:\s*9999px/s);
    // Track must not be a bright/white strip.
    expect(css).toMatch(/::-webkit-scrollbar-track\s*{[^}]*background:\s*transparent/s);
  });

  it("uses dark scrollbar tokens for Firefox as well", () => {
    expect(css).toContain("scrollbar-color: var(--bg-elevated-2) var(--bg-base)");
  });

  it("keeps the opt-out helper for horizontally scrolling chip rows", () => {
    expect(css).toContain(".no-scrollbar");
  });
});
