import { describe, expect, it } from "vitest";
import { craftMatches } from "@/lib/canonical/businesses.server";
import { rowSatisfiesSpec } from "@/lib/spec-search.functions";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { craftFromTag } from "@/lib/search/live-gapfill";

// UI acceptance (Portland dentists) showed OSM amenity=clinic rows such as
// "Maternal-Fetal Medicine Center" delivered as dentists: the query alias
// clinic→dentist was also applied to the OBSERVED row category.
describe("observed clinic category keeps its meaning", () => {
  it("a general clinic is not a dentist, a dentist still is", () => {
    expect(craftMatches("clinic", "dentist")).toBe(false);
    expect(craftMatches("clinic", "dentists")).toBe(false);
    expect(craftMatches("dentist", "dentist")).toBe(true);
    expect(craftMatches("general_dentistry", "dentist")).toBe(true);
  });

  it("asking for clinics still finds clinic rows (and dentists, as before)", () => {
    expect(craftMatches("clinic", "clinics")).toBe(true);
    expect(craftMatches("clinic", "clinic")).toBe(true);
    expect(craftMatches("dentist", "clinic")).toBe(true);
  });

  it("the delivery judge rejects a medical clinic for a dentist query", () => {
    const spec = extractSearchSpec("find me dentists in canada");
    const base = { kind: "business" as const, detail: "1 Main St", location: "Toronto", country: "CA" };
    expect(rowSatisfiesSpec(spec, { ...base, title: "Maternal-Fetal Medicine Center", category: "clinic" })).toBe(false);
    expect(rowSatisfiesSpec(spec, { ...base, title: "Bright Smile Dental", category: "dentist" })).toBe(true);
  });

  it("OSM clinic rows become dentists only when their own name says dental", () => {
    expect(craftFromTag("clinic", "dentist", "Pearl District Dental Clinic")).toBe("dentist");
    expect(craftFromTag("clinic", "dentist", "Portland Orthodontics")).toBe("dentist");
    expect(craftFromTag("clinic", "dentist", "Everywoman's Health")).toBe("clinic");
    expect(craftFromTag("dental_clinic", "dentist", "Anything")).toBe("dentist");
  });
});
