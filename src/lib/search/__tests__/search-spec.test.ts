import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";

/** Phase 1 acceptance assertions — literal contract with the user. */
describe("Phase 1 assertion prompts", () => {
  it("'I need SaaS founders in New York' extracts fully, zero questions", () => {
    const s = extractSearchSpec("I need SaaS founders in New York");
    expect(s.entity).toBe("person");
    expect(s.criteria).toContainEqual({ field: "role", value: "founder", stated: true, confidence: 1 });
    expect(s.criteria).toContainEqual({ field: "industry", value: "SaaS", stated: true, confidence: 1 });
    expect(s.criteria).toContainEqual({ field: "location", value: "New York", stated: true, confidence: 1 });
    expect(s.missing).toEqual([]);
    expect(s.status).toBe("ready_to_search");
  });

  it("'bro i need businesses' asks for category and location", () => {
    const s = extractSearchSpec("bro i need businesses plz asap");
    expect(s.entity).toBe("business");
    expect(s.missing).toEqual(["category", "location"]);
    expect(s.status).toBe("needs_clarification");
  });

  it("businesses in Canada ask for a category even with a location", () => {
    const s = extractSearchSpec("businesses in Canada with a website");
    expect(s.entity).toBe("business");
    expect(s.criteria.find((field) => field.field === "category")).toBeUndefined();
    expect(s.missing).toEqual(["category"]);
    expect(s.status).toBe("needs_clarification");
  });

  it("'companies looking for website developers' is signal-required", () => {
    const s = extractSearchSpec("companies looking for website developers");
    expect(s.entity).toBe("company");
    expect(s.signal_required).toBe(true);
    expect(s.status).toBe("ready_to_search");
  });
});

describe("location must not absorb intent verbs (looking/seeking/asking/needs/hiring)", () => {
  const loc = (q: string) =>
    extractSearchSpec(q).criteria.find((c) => c.field === "location")?.value;
  const locId = (q: string) =>
    extractSearchSpec(q).criteria.find((c) => c.field === "location_id")?.value;

  it("'restaurant owners in Toronto looking for photographers' → Toronto", () => {
    expect(loc("restaurant owners in Toronto looking for photographers")).toBe(
      "Toronto",
    );
    expect(locId("restaurant owners in Toronto looking for photographers")).toBe(
      "geo:city:toronto",
    );
    expect(loc("restaurant owners in Toronto looking for photographers")).not.toMatch(
      /looking/i,
    );
  });

  it("'people in New York looking for video editors' → New York", () => {
    expect(loc("people in New York looking for video editors")).toBe("New York");
    expect(locId("people in New York looking for video editors")).toBe(
      "geo:city:new-york",
    );
  });

  it("'people in Toronto looking for copywriters' → Toronto", () => {
    expect(loc("people in Toronto looking for copywriters")).toBe("Toronto");
  });

  it("'founders in the Bay Area asking for SEO help' → Bay Area, not …asking", () => {
    const q = "founders in the Bay Area asking for SEO help";
    expect(loc(q)).not.toMatch(/asking/i);
    expect(locId(q)).toMatch(/bay-area|san-francisco/i);
  });

  it("'companies in Austin currently hiring senior Python engineers' → Austin", () => {
    expect(loc("companies in Austin currently hiring senior Python engineers")).toBe(
      "Austin",
    );
  });

  it("'people in Vancouver seeking photographers' → Vancouver", () => {
    expect(loc("people in Vancouver seeking photographers")).toBe("Vancouver");
  });

  it("'owners in Montreal needing a website' → Montreal", () => {
    expect(loc("owners in Montreal needing a website")).toBe("Montreal");
  });

  it("'startups in Berlin that need developers' still resolves Berlin", () => {
    // "that" strip path — place before relative clause
    expect(loc("startups in Berlin that need developers")).toBe("Berlin");
  });
});

describe("extraction hardening", () => {
  it.each([
    ["copywriters in Canada", "copywriter"],
    ["software engineers in Toronto", "software engineer"],
    ["designers in London", "designer"],
    ["sales managers in New York", "sales manager"],
  ])("extracts stored people role from %s", (query, role) => {
    const s = extractSearchSpec(query);
    expect(s.entity).toBe("person");
    expect(s.criteria.find((c) => c.field === "role")?.value).toBe(role);
  });
  it("expands NY to New York", () => {
    const s = extractSearchSpec("find me SaaS founders in NY");
    expect(s.criteria).toContainEqual({ field: "location", value: "New York", stated: true, confidence: 1 });
  });
  it("routes bare companies plural to company, not buying-signal", () => {
    expect(extractSearchSpec("I need companies").entity).toBe("company");
  });
  it("routes founders to person with role", () => {
    const s = extractSearchSpec("yo need founders i can reach out to rn");
    expect(s.entity).toBe("person");
    expect(s.missing).toEqual([]);
  });
  it("never invents unstated fields", () => {
    const s = extractSearchSpec("bro i need businesses");
    const fields = s.criteria.map((c) => c.field);
    expect(fields).not.toContain("location");
    expect(fields).not.toContain("category");
  });
});
