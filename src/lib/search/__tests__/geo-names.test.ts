/** Corpus-complete country names: every matrix ISO typable by name, with the
 *  documented Georgia-state exception. */
import { describe, expect, it } from "vitest";
import { COUNTRY_ISO, extractSearchSpec } from "@/lib/search/search-spec-extract";

const locationOf = (query: string) =>
  extractSearchSpec(query).criteria.find((c) => c.field === "location")?.value ?? null;

describe("country-name resolution", () => {
  it("newly covered names resolve (Austria, Nepal, Argentina)", () => {
    expect(locationOf("dentists in Austria")).toBe("Austria");
    expect(locationOf("businesses in Nepal")).toBe("Nepal");
    expect(locationOf("plumbers in Argentina")).toBe("Argentina");
  });

  it("resolved names are stated, not missing", () => {
    const spec = extractSearchSpec("dentists in Austria");
    expect(spec.missing).not.toContain("location");
  });

  it("Georgia stays out of the country map (US-state wording wins)", () => {
    // Unknown words are stated verbatim and gated downstream (no silent
    // country substitution) — but 'georgia' must never map to ISO GE.
    expect(COUNTRY_ISO["georgia"]).toBeUndefined();
    expect(locationOf("plumbers in Georgia")).toBe("Georgia");
  });

  it("existing names unaffected (USA, UK, India, Bangladesh)", () => {
    expect(locationOf("dentists in USA")).toBe("USA");
    expect(locationOf("companies in UK")).toBe("UK");
    expect(locationOf("dentists in India")).toBe("India");
    expect(locationOf("dentists in Bangladesh")).toBe("Bangladesh");
  });
});
