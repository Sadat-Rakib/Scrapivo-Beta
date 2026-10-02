/**
 * Focused extraction tests for the OSM local-business source (L05 forensic
 * follow-up): multi-value phone tags, contact:phone / contact:mobile
 * variants, and the guarded `url` website fallback must all survive
 * elementsToLeads. The qualification gate itself is never touched here.
 */
import { describe, expect, it } from "vitest";
import { craftTags, elementsToLeads, nameNeedleFor, splitOsmContactValues } from "../osm-local-businesses.server";

type El = { type: string; id: number; tags: Record<string, string> };

describe("splitOsmContactValues", () => {
  it("splits the OSM semicolon list convention into individual values", () => {
    expect(splitOsmContactValues("+1 905-555-1234;+1 905-555-5678")).toEqual([
      "+1 905-555-1234",
      "+1 905-555-5678",
    ]);
  });

  it("trims whitespace around entries and drops empties", () => {
    expect(splitOsmContactValues(" +1-905-555-1234 ; 905-555-5678 ;")).toEqual([
      "+1-905-555-1234",
      "905-555-5678",
    ]);
  });

  it("returns [] for missing values", () => {
    expect(splitOsmContactValues(undefined)).toEqual([]);
    expect(splitOsmContactValues(null)).toEqual([]);
    expect(splitOsmContactValues("")).toEqual([]);
  });
});

describe("elementsToLeads contact extraction", () => {
  it("keeps the first number of a semicolon multi-phone tag and preserves the rest", () => {
    const els: El[] = [{
      type: "node",
      id: 1,
      tags: { name: "Multi Phone Roofing", craft: "roofer", phone: "+1-905-230-2969;+1 905 230 2970" },
    }];
    const leads = elementsToLeads(els, "Mississauga", "roofers", 10);
    expect(leads).toHaveLength(1);
    const phones = (leads[0] as typeof leads[0] & { phones?: string[] }).phones ?? [];
    expect(phones[0]).toBe("+1-905-230-2969");
    expect(phones).toHaveLength(2);
    expect(leads[0].snippet).toContain("+1-905-230-2969");
  });

  it("falls back to contact:phone and then contact:mobile", () => {
    const viaContactPhone = elementsToLeads([{
      type: "node",
      id: 2,
      tags: { name: "Contact Phone Roofing", craft: "roofer", "contact:phone": "905-555-0101" },
    }], "Mississauga", "roofers", 10);
    expect((viaContactPhone[0] as typeof viaContactPhone[0] & { phones?: string[] }).phones).toEqual(["905-555-0101"]);

    const viaContactMobile = elementsToLeads([{
      type: "node",
      id: 3,
      tags: { name: "Contact Mobile Roofing", craft: "roofer", "contact:mobile": "+1 647-555-0102" },
    }], "Mississauga", "roofers", 10);
    expect((viaContactMobile[0] as typeof viaContactMobile[0] & { phones?: string[] }).phones).toEqual(["+1 647-555-0102"]);
  });

  it("accepts the `url` tag as a website fallback and keeps the directory veto", () => {
    const viaUrlTag = elementsToLeads([{
      type: "node",
      id: 4,
      tags: { name: "Url Tag Roofing", craft: "roofer", url: "roofingtexas.example" },
    }], "Mississauga", "roofers", 10);
    expect(viaUrlTag[0].full_post_url).toBe("https://roofingtexas.example");
    expect((viaUrlTag[0] as typeof viaUrlTag[0] & { company_domain?: string }).company_domain).toBe("roofingtexas.example");

    const directoryUrl = elementsToLeads([{
      type: "node",
      id: 5,
      tags: { name: "Directory Url Roofing", craft: "roofer", url: "https://www.yelp.com/biz/x" },
    }], "Mississauga", "roofers", 10);
    expect(directoryUrl[0].full_post_url).toBeUndefined();
    expect((directoryUrl[0] as typeof directoryUrl[0] & { structured_website_absent?: boolean }).structured_website_absent).toBe(true);
  });

  it("prefers website over contact:website over url", () => {
    const lead = elementsToLeads([{
      type: "node",
      id: 6,
      tags: {
        name: "Preference Roofing",
        craft: "roofer",
        website: "https://first.example",
        "contact:website": "https://second.example",
        url: "https://third.example",
      },
    }], "Mississauga", "roofers", 10);
    expect(lead[0].full_post_url).toBe("https://first.example");
  });
});

describe("acquisition vocabulary for the V2 manual-QA trades", () => {
  it("maps solar/photovoltaic skills to solar-specific OSM tags, not the generic office dump", () => {
    const tags = craftTags("solar panel installer");
    expect(tags).toContain('"craft"="photovoltaic"');
    expect(tags).not.toEqual(['"office"="company"', '"shop"="yes"']);
    expect(nameNeedleFor("solar panel installer")).toMatch(/solar/);
  });

  it("maps construction, photographer and freight-forwarding skills (Banja Luka / Cebu / Tbilisi classes)", () => {
    expect(craftTags("construction companies")).toContain('"office"="construction_company"');
    expect(nameNeedleFor("construction companies")).toMatch(/construct/);
    expect(craftTags("wedding photographers")).toContain('"shop"="photo"');
    expect(nameNeedleFor("wedding photographers")).toMatch(/photo/);
    expect(craftTags("freight forwarding companies")).toContain('"office"="forwarding_agent"');
    expect(nameNeedleFor("freight forwarding companies")).toMatch(/freight|forward/);
  });

  it("keeps the existing mappings intact (no regressions)", () => {
    expect(craftTags("roofers")).toContain('"craft"="roofer"');
    expect(craftTags("plumbers")).toContain('"craft"="plumber"');
    expect(nameNeedleFor("roofers")).toBe("roof");
  });
});
