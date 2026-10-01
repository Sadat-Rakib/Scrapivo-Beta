import { describe, expect, it } from "vitest";
import { rowCouldSatisfySpec, rowSatisfiesSpec, type SpecRow } from "@/lib/spec-search.functions";
import { buildSpec } from "../search-spec";

describe("canonical exclusions reach execution", () => {
  const spec = buildSpec({
    entity: "company",
    raw_query: "companies, not agencies",
    criteria: [{ field: "exclude_business_model", value: "agency", stated: true, confidence: 1 }],
  });

  it("rejects an excluded agency in both retrieval and research gates", () => {
    const agency: SpecRow = { kind: "company", title: "Acme Staffing Agency", category: "Staffing agency", detail: "Acme" };
    expect(rowSatisfiesSpec(spec, agency)).toBe(false);
    expect(rowCouldSatisfySpec(spec, agency)).toBe(false);
  });

  it("keeps an unrelated brand", () => {
    const brand: SpecRow = { kind: "company", title: "Acme Skincare", category: "Skincare brand", detail: "Acme" };
    expect(rowSatisfiesSpec(spec, brand)).toBe(true);
    expect(rowCouldSatisfySpec(spec, brand)).toBe(true);
  });
});
