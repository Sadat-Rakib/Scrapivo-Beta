import { describe, expect, it } from "vitest";
import { buildSpec } from "@/lib/search/search-spec";
import { documentSatisfiesRetrievalPlan, retrievalPlanFromSpec } from "./retrieval-plan";
import type { CompactSearchDocument } from "./types";

const document = {
  doc_id: 1,
  entity: "business",
  registry_key: "business:1",
  name: "Toronto HVAC",
  city: "Toronto",
  country: "CA",
  latitude: 43.6532,
  longitude: -79.3832,
  quality_score: 90,
  source_object: "fixture",
  source_row: 0,
} satisfies CompactSearchDocument;

describe("Gate-2 retrieval spatial contract", () => {
  it("applies radius deterministically", () => {
    const spec = buildSpec({ entity: "business", raw_query: "fixture", criteria: [
      { field: "category", value: "hvac", stated: true, confidence: 1 },
      { field: "location", value: "Toronto", stated: true, confidence: 1 },
      { field: "radius_km", value: "50", stated: true, confidence: 1 },
      { field: "location_latitude", value: "43.65", stated: true, confidence: 1 },
      { field: "location_longitude", value: "-79.38", stated: true, confidence: 1 },
    ] });
    expect(documentSatisfiesRetrievalPlan(document, retrievalPlanFromSpec(spec))).toBe(true);
  });

  it("rejects structured excluded locations", () => {
    const spec = buildSpec({ entity: "business", raw_query: "fixture", criteria: [
      { field: "category", value: "hvac", stated: true, confidence: 1 },
      { field: "location", value: "Canada", stated: true, confidence: 1 },
      { field: "excluded_location", value: "Toronto", stated: true, confidence: 1 },
    ] });
    expect(documentSatisfiesRetrievalPlan(document, retrievalPlanFromSpec(spec))).toBe(false);
  });
});

