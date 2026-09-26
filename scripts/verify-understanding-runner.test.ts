import { describe, expect, it } from "vitest";
import { mustAbortRequiredLlmRun, sameLocation } from "./verify-understanding-runner";

describe("Gate 1 verifier boundaries", () => {
  it("accepts harmless canonical location formatting but rejects suffix contamination", () => {
    expect(sameLocation("surabaya", "Surabaya")).toBe(true);
    expect(sameLocation("trois-rivières", "Trois-Rivieres")).toBe(true);
    expect(sameLocation("Surabaya", "Surabaya money")).toBe(false);
    expect(sameLocation("New York", "New York hiring")).toBe(false);
    expect(sameLocation("Brno", "Brno last month")).toBe(false);
  });

  it("stops formal validation on fallback but not a successful bounded repair", () => {
    expect(mustAbortRequiredLlmRun(true, false, true)).toBe(true);
    expect(mustAbortRequiredLlmRun(true, false, false)).toBe(false);
    expect(mustAbortRequiredLlmRun(false, false, true)).toBe(false);
  });
});
