/**
 * World gazetteer (Task 12 typo places; Tasks 8/9 real cities). A small
 * fixture stands in for the GeoNames map, most populous first like the real
 * file. The resolver consults it only when a caller opts in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCityGazetteer } from "../gazetteer.server";
import { registerCityGazetteer, resolveCanonicalLocation, locationSatisfies } from "../location-resolver";
import { extractFrameDeterministic } from "@/lib/understanding/fallback";
import { validateFrame } from "@/lib/understanding/validate";
import { applyClarificationToFrame, frameToSearchSpec } from "@/lib/understanding/to-search-spec";

const city = (name: string, iso2: string, aliases: string[] = []) => ({ name, iso2, aliases });
const FIXTURE = {
  bali: city("Bāli", "IN"),
  "bāli": city("Bāli", "IN"),
  portland: city("Portland", "US"),
  leipzig: city("Leipzig", "DE"),
  vilnius: city("Vilnius", "LT"),
  tallinn: city("Tallinn", "EE", ["reval", "tallinn"]),
  reval: city("Tallinn", "EE", ["reval", "tallinn"]),
  fayetteville: city("Fayetteville", "US"),
  arequipa: city("Arequipa", "PE"),
  waterford: city("Waterford", "US"),
  "waterford ie": city("Waterford", "IE"),
  cornwall: city("Cornwall", "CA"),
  camrose: city("Camrose", "CA"),
  aberystwyth: city("Aberystwyth", "GB"),
  sale: city("Salé", "MA"),
};
const gazetteer = buildCityGazetteer(FIXTURE);
const resolve = (value: string, typos = true) => resolveCanonicalLocation(value, { gazetteer: true, correctTypos: typos });

beforeAll(() => registerCityGazetteer(gazetteer));
afterAll(() => registerCityGazetteer(null));

describe("gazetteer lookup and typo repair", () => {
  it("lists every same-named city, most populous first, and ignores short aliases", () => {
    expect(gazetteer.lookup("Waterford").map((item) => item.iso2)).toEqual(["US", "IE"]);
    expect(gazetteer.lookup("Reval")[0]?.name).toBe("Tallinn");
    expect(gazetteer.lookup("Bali")[0]?.iso2).toBe("IN");
  });

  it("repairs one edit (a transposition counts as one) and nothing looser", () => {
    expect(gazetteer.fuzzy("lipzig")?.name).toBe("Leipzig");
    expect(gazetteer.fuzzy("vinlius")?.name).toBe("Vilnius");
    expect(gazetteer.fuzzy("arequippa")?.name).toBe("Arequipa");
    expect(gazetteer.fuzzy("fyetteville")?.name).toBe("Fayetteville");
    expect(gazetteer.fuzzy("aberystwyyth")?.name).toBe("Aberystwyth");
    expect(gazetteer.fuzzy("liepzgi")).toBeNull();
  });

  it("never 'repairs' a real name, a plural, a short word or a lexicon word into a town", () => {
    expect(gazetteer.fuzzy("Leipzig")).toBeNull();
    expect(gazetteer.fuzzy("sales")).toBeNull();
    expect(gazetteer.fuzzy("Bali")).toBeNull();
    expect(gazetteer.fuzzy("dentists")).toBeNull();
  });
});

describe("resolver with the gazetteer (opt-in)", () => {
  it("resolves a real city only when a region qualifier confirms its country", () => {
    expect(resolve("Tallinn, Estonia")).toMatchObject({ id: "geo:city:tallinn", kind: "city", country_code: "EE", resolution: "resolved" });
    expect(resolve("Tallinn Estonia")).toMatchObject({ id: "geo:city:tallinn", country_code: "EE" });
    expect(resolve("Camrose, AB")).toMatchObject({ id: "geo:city:camrose", country_code: "CA" });
    expect(resolve("Camrose Alberta")?.parent_ids).toContain("geo:country:ca");
    expect(resolve("Waterford, Ireland")).toMatchObject({ country_code: "IE" });
    expect(resolve("Portland, OR")).toMatchObject({ country_code: "US" });
  });

  it("resolves an unambiguous bare city, keeps ambiguous and contradicted names literal", () => {
    // Contract (master PRD): a bare name whose gazetteer hits share ONE
    // country resolves ("Windhoek" -> NA) so discovery geo-scopes; a name
    // the fixture knows in several countries or not at all stays literal,
    // and a contradicting qualifier never overrules the city's country.
    expect(resolve("Bali")).toMatchObject({ kind: "city", country_code: "IN" });
    expect(resolve("Cornwall")).toMatchObject({ kind: "city" });
    expect(resolve("Tallinn")).toMatchObject({ kind: "city", country_code: "EE" });
    expect(resolve("Leipzig, Canada")).toMatchObject({ kind: "stated" });
  });

  it("repairs a misspelled city only for callers that ask for typo repair", () => {
    expect(resolve("lipzig")).toMatchObject({ name: "Leipzig", country_code: "DE", resolution: "provisional" });
    expect(resolve("Tallin Estonia")).toMatchObject({ name: "Tallinn", country_code: "EE" });
    expect(resolve("lipzig", false)).toMatchObject({ kind: "stated" });
    // Row qualification never consults the gazetteer: candidate geography is
    // judged exactly as before.
    expect(resolveCanonicalLocation("lipzig")).toMatchObject({ kind: "stated" });
    expect(resolveCanonicalLocation("Tallinn, Estonia")).toMatchObject({ kind: "stated" });
    expect(locationSatisfies("Tallinn, Estonia", "Tallinn")).toBe(true);
  });
});

describe("understanding uses the gazetteer", () => {
  const spec = (query: string) => frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));
  const criterion = (s: ReturnType<typeof spec>, field: string) => s.criteria.find((c) => c.field === field)?.value;

  it("repairs misspelled places in chat-style queries", () => {
    for (const [query, place, iso] of [
      ["companies in fyetteville needing voiceover", "Fayetteville", "US"],
      ["need some founders round vinlius tryna bring on localistaion manager ppl rn", "Vilnius", "LT"],
      ["hi taxidermists aberystwyyth pls...", "Aberystwyth", "GB"],
      ["hi cobblers arequippa pls", "Arequipa", "PE"],
      ["any  orthotics cliinics near lipzig no proper  website  n  got phone?", "Leipzig", "DE"],
    ] as const) {
      const s = spec(query);
      expect(criterion(s, "location"), query).toBe(place);
      expect(criterion(s, "location_country"), query).toBe(iso);
      expect(s.understanding?.location?.raw ?? "", query).toMatch(new RegExp(s.understanding!.location!.value, "i"));
    }
  });

  it("resolves 'City, Region' targets to the city with its country", () => {
    const local = spec("plumbers in Camrose, Alberta without a website, with phone numbers");
    expect(criterion(local, "location")).toBe("Camrose");
    expect(criterion(local, "location_kind")).toBe("city");
    expect(criterion(local, "location_country")).toBe("CA");
    const founders = spec("Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact");
    expect(criterion(founders, "location")).toBe("Tallinn");
    expect(criterion(founders, "location_country")).toBe("EE");
  });
});
