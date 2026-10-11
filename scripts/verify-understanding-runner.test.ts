import { beforeAll, describe, expect, it } from "vitest";
import { buildCityGazetteer } from "../src/lib/search/gazetteer.server";
import { registerCityGazetteer } from "../src/lib/search/location-resolver";
import { mustAbortRequiredLlmRun, sameLocation } from "./verify-understanding-runner";

beforeAll(() => {
  registerCityGazetteer(buildCityGazetteer({
    aarhus: { iso2: "DK", name: "Aarhus", aliases: ["Århus"] },
    paris_fr: { iso2: "FR", name: "Paris" },
    paris_us: { iso2: "US", name: "Paris" },
    waterford_ie: { iso2: "IE", name: "Waterford" },
  }));
});

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

  it("accepts accent aliases only when gazetteer identity and country match", () => {
    expect(sameLocation("Aarhus", "Århus", "DK")).toBe(true);
  });

  it("rejects unresolved typos without typo repair", () => {
    expect(sameLocation("Aarhus", "Arahus", "DK")).toBe(false);
  });

  it("rejects different cities and country conflicts", () => {
    expect(sameLocation("Aarhus", "Waterford", "DK")).toBe(false);
    expect(sameLocation("Aarhus", "Aarhus", "US")).toBe(false);
  });
});
