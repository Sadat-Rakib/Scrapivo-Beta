import { describe, expect, it } from "vitest";
import { constrainFilesToCityCountry, constrainStemsToCountry, localityMatches, normPlace } from "../businesses.server";

describe("constrainStemsToCountry (Bahrain fix)", () => {
  it("country query keeps only its ISO stems", () => {
    expect(constrainStemsToCountry(["pk", "bh", "in", "ae"], ["bh"])).toEqual(["bh"]);
  });
  it("multi-ISO countries keep all their stems", () => {
    expect(constrainStemsToCountry(["gb", "uk", "us"], ["gb", "uk"])).toEqual(["gb", "uk"]);
  });
  it("city queries (empty isoList) pass through untouched", () => {
    expect(constrainStemsToCountry(["in", "bd"], [])).toEqual(["in", "bd"]);
  });
  it("no ISO match returns [] so caller tries ISO stems directly", () => {
    expect(constrainStemsToCountry(["pk"], ["bh"])).toEqual([]);
  });
  it("matching is case-insensitive", () => {
    expect(constrainStemsToCountry(["BH", "PK"], ["bh"])).toEqual(["BH"]);
  });
});

describe("normPlace", () => {
  it("normalizes Latin diacritics consistently", () => {
    expect(normPlace("São Paulo")).toBe("sao paulo");
    expect(normPlace("Trois-Rivières")).toBe("trois rivieres");
  });
  it("preserves non-Latin locality names instead of collapsing them", () => {
    expect(normPlace("ঢাকা")).toBe("ঢাকা");
    expect(normPlace("دبي")).toBe("دبي");
  });
});

describe("constrainFilesToCityCountry", () => {
  it("keeps the known home-country shard plus a direct city shard", () => {
    const keys = ["by_country/us.parquet", "by_country/ca.parquet", "by_country/austin.parquet"];
    expect(constrainFilesToCityCountry(keys, "US", "by_country/austin.parquet")).toEqual([
      "by_country/us.parquet", "by_country/austin.parquet",
    ]);
  });
  it("does not guess when geography is unresolved", () => {
    const keys = ["by_country/us.parquet", "by_country/gb.parquet"];
    expect(constrainFilesToCityCountry(keys, null)).toEqual(keys);
  });
});

describe("localityMatches", () => {
  it("accepts diacritic variants but rejects longer namesake localities", () => {
    expect(localityMatches("São Paulo", "Sao Paulo")).toBe(true);
    expect(localityMatches("São Paulo das Missões", "Sao Paulo")).toBe(false);
  });
});
