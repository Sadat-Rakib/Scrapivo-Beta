import { describe, expect, it } from "vitest";
import { projectInvestorLocation } from "../investor-location";
import { rowSatisfiesSpec, type SpecRow } from "../../spec-search.functions";
import type { SearchSpec } from "../../search/search-spec";

describe("investor source geography projection", () => {
  it.each([
    ["San Francisco, USA, Germany", "San Francisco", "Germany"],
    ["London, UK, Canada", "London", "Canada"],
    ["Unknown Town, USA, Germany", "Unknown Town", "Germany"],
  ])("does not assert one country from a mixed-country source: %s", (raw, city, country) => {
    const projected = projectInvestorLocation({ location_raw: raw, location_city: city, location_country: country });
    expect(projected).toEqual({ location_raw: raw, location_city: city, location_country: null });
    expect(projectInvestorLocation(projected)).toEqual(projected);
  });

  it.each([
    ["Berlin, Berlin, Germany", "Berlin", "Germany"],
    ["London Area, United Kingdom", "London Area", "United Kingdom"],
    ["Toronto, Ontario, Canada", "Toronto", "Canada"],
  ])("preserves ordinary geography and supports producer projection: %s", (raw, city, country) => {
    const expected = { location_raw: raw, location_city: city, location_country: country };
    expect(projectInvestorLocation(expected)).toEqual(expected);
    expect(projectInvestorLocation({ location_raw: raw })).toEqual(expected);
  });

  it("treats aliases for the same country as one country", () => {
    expect(projectInvestorLocation({ location_raw: "San Francisco, US, USA", location_country: "USA" }).location_country).toBe("USA");
  });

  it("leaves missing or unknown country evidence unknown", () => {
    expect(projectInvestorLocation({ location_raw: null })).toEqual({ location_raw: null, location_city: null, location_country: null });
    expect(projectInvestorLocation({ location_raw: "Unknown Town" }).location_country).toBeNull();
  });

  it("retains real city qualification after removing the conflicting scalar country", () => {
    const projected = projectInvestorLocation({ location_raw: "San Francisco, USA, Germany", location_city: "San Francisco", location_country: "Germany" });
    const row = { kind: "investor", title: "Almaz Capital", detail: projected.location_raw, location: projected.location_city, country: projected.location_country } as SpecRow;
    const spec = { entity: "investor", criteria: [{ field: "location", value: "USA", stated: true, confidence: 1 }],
      missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search", raw_query: "investors in USA" } as SearchSpec;
    expect(rowSatisfiesSpec(spec, row)).toBe(true);
  });
});
