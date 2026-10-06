import { describe, expect, it } from "vitest";
import { extractBusinessModel, extractSearchSpec } from "../search-spec-extract";
import { businessModelMatches, rowSatisfiesSpec } from "@/lib/spec-search.functions";
import type { SearchSpec } from "../search-spec";

/** Phase 2: entity taxonomy (agency/brands/D2C/B2B/B2C). */
describe("extractBusinessModel", () => {
  it("detects agency, brand, d2c, b2b, b2c", () => {
    expect(extractBusinessModel("B2B marketing agencies")).toBe("b2b");
    expect(extractBusinessModel("D2C brands")).toBe("d2c");
    expect(extractBusinessModel("b2c companies")).toBe("b2c");
    expect(extractBusinessModel("design agency in Berlin")).toBe("agency");
    expect(extractBusinessModel("skincare brands in NYC")).toBe("brand");
    expect(extractBusinessModel("plumbers in Austin")).toBeNull();
  });
});

describe("taxonomy extraction", () => {
  it("'D2C brands in New York' → company + business_model=d2c, still ready", () => {
    const s = extractSearchSpec("D2C brands in New York");
    expect(s.entity).toBe("company");
    expect(s.criteria).toContainEqual({
      field: "business_model",
      value: "d2c",
      stated: true,
      confidence: 1,
    });
    expect(s.criteria).toContainEqual({
      field: "location",
      value: "New York",
      stated: true,
      confidence: 1,
    });
    // Optional taxonomy never blocks: no new required fields.
    expect(s.missing).toEqual([]);
    expect(s.status).toBe("ready_to_search");
  });

  it("'B2B agencies' → company + business_model, no location invented", () => {
    const s = extractSearchSpec("B2B agencies");
    expect(s.entity).toBe("company");
    const fields = s.criteria.map((c) => c.field);
    expect(fields).toContain("business_model");
    expect(fields).not.toContain("location");
  });

  it("existing contracts unchanged: trades stay business, bare stays clarify", () => {
    expect(extractSearchSpec("plumbers in Austin").entity).toBe("business");
    const s = extractSearchSpec("bro i need businesses plz asap");
    expect(s.missing).toEqual(["category", "location"]);
  });

  it("explicit broad local-business intent does not require category narrowing", () => {
    expect(extractSearchSpec("all businesses in Austin").missing).toEqual([]);
    expect(extractSearchSpec("any type of businesses in Austin").missing).toEqual([]);
  });
});

describe("businessModelMatches + rowSatisfiesSpec", () => {
  it("matches model signals leniently, unknown model never rejects", () => {
    expect(businessModelMatches("Acme Agency — marketing", "agency")).toBe(true);
    expect(businessModelMatches("Acme Corp — software", "agency")).toBe(false);
    expect(businessModelMatches("anything", "something-new")).toBe(true);
  });

  it("company validation filters on business_model when stated", () => {
    const spec = {
      entity: "company",
      criteria: [{ field: "business_model", value: "agency", stated: true, confidence: 1 }],
    } as SearchSpec;
    expect(
      rowSatisfiesSpec(spec, {
        kind: "company",
        title: "Acme Agency",
        detail: "marketing",
      }),
    ).toBe(true);
    expect(
      rowSatisfiesSpec(spec, {
        kind: "company",
        title: "Acme Corp",
        detail: "software",
      }),
    ).toBe(false);
  });
});
