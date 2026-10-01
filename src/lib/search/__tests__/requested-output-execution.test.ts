import { describe, expect, it } from "vitest";
import { queryRequiredFields } from "../canonical-contract";
import { computeResearchNeeds } from "../browser-research";
import { buildSpec } from "../search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Qualification } from "../qualify";

describe("requested output execution", () => {
  const spec = {
    ...buildSpec({ entity: "company", criteria: [], raw_query: "companies" }),
    requested_fields: ["email", "phone", "website", "socials"],
  };

  it("keeps requested fields in the qualification contract", () => {
    expect(queryRequiredFields(spec)).toEqual(expect.arrayContaining(["email", "phone", "website", "socials"]));
  });

  it("asks browser research for missing website, contact, and social evidence", () => {
    const row: SpecRow = { kind: "company", title: "Acme", detail: "Acme", entity_resolved: true,
      website_url: null, email: null, phone: null, evidence: [] };
    const qualification = { disposition: "potential_match" } as Qualification;
    expect(computeResearchNeeds(row, spec, qualification)).toEqual(expect.arrayContaining(["website", "contact", "social"]));
  });
});
