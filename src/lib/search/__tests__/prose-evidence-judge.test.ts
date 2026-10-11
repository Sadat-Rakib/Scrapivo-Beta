import { describe, expect, it } from "vitest";
import { rowSatisfiesSpec, postResearchRejectReason, type SpecRow } from "../../spec-search.functions";
import type { SearchSpec } from "../search-spec";

/** Lifecycle regression (Master PRD §1): a researched business whose prose
 *  detail carries the trade and the place must survive the strict judge, and
 *  a foreign business that never names the requested place must not. Both
 *  shapes were observed live in Windhoek runs (Pomwene Solar Link reached the
 *  judge as a valid consultancy and was lost to literal substring matching;
 *  A&R Solar fragments had no location proof at all). */

const spec: SearchSpec = {
  entity: "business",
  criteria: [
    { field: "category", value: "solar installer", stated: true, confidence: 0.8 },
    { field: "location", value: "Windhoek", stated: true, confidence: 0.5 },
  ],
  raw_query: "Solar installers in Windhoek",
  missing: [], status: "ready_to_search", signal_required: false, signal_types: [], signal_recency: null,
};

const row = (over: Partial<SpecRow>): SpecRow => ({
  kind: "business", title: "Acme", entity_id: "acme", entity_resolved: true,
  page_type: "company_page", category: null, location: null, country: null,
  detail: "", evidence: [], ...over,
} as SpecRow);

describe("prose evidence survives the strict judge", () => {
  it("qualifies a researched row whose detail names trade and place", () => {
    const candidate = row({
      title: "Pomwene Solar Link",
      detail: "Pomwene Solar Link is an independent solar consultancy in Windhoek. We design and install systems.",
      website_url: "https://pomwene.example",
      evidence: [{
        subject: "acme", source_url: "https://pomwene.example", source_type: "web",
        evidence_type: "identity", supports: "identity", extraction_method: "research",
        confidence: 0.8, observed_at: "2026-10-11",
        excerpt: "Pomwene Solar Link is an independent solar consultancy in Windhoek.",
      }],
    });
    expect(rowSatisfiesSpec(spec, candidate)).toBe(true);
  });

  it("qualifies a researched row whose evidence excerpt alone proves both", () => {
    const candidate = row({
      title: "Cedar Solar",
      detail: "",
      evidence: [{
        subject: "acme", source_url: "https://cedar.example", source_type: "web",
        evidence_type: "identity", supports: "identity", extraction_method: "research",
        confidence: 0.8, observed_at: "2026-10-11",
        excerpt: "Cedar Solar — solar panel installation and maintenance, Windhoek, Namibia.",
      }],
    });
    expect(rowSatisfiesSpec(spec, candidate)).toBe(true);
    expect(postResearchRejectReason(spec, candidate)).toBeNull();
  });

  it("still rejects a foreign business that never proves the requested place", () => {
    const foreign = row({
      title: "A&R Solar",
      detail: "5,000 A&R Solar Projects Installed",
      evidence: [{
        subject: "acme", source_url: "https://a-rsolar.example", source_type: "web",
        evidence_type: "identity", supports: "identity", extraction_method: "research",
        confidence: 0.8, observed_at: "2026-10-11",
        excerpt: "A&R Solar — Washington and Oregon solar installer since 2007.",
      }],
    });
    expect(rowSatisfiesSpec(spec, foreign)).toBe(false);
    expect(postResearchRejectReason(spec, foreign)).toContain("location");
  });

  it("still rejects a row with neither trade nor place", () => {
    const vague = row({ title: "Battery Storage", detail: "Keep the lights on during outages." });
    expect(rowSatisfiesSpec(spec, vague)).toBe(false);
  });
});
