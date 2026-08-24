import { describe, expect, it } from "vitest";
import { buildGuidedQuestions, parseSearchIntent, REMOTE_OPTION } from "../guided-intent";

describe("parseSearchIntent — businesses", () => {
  it("extracts category and multi-word location from a fully-specified ask", () => {
    const p = parseSearchIntent("businesses", "I need to find 10 designer shops in Austin, Texas");
    expect(p.category).toBe("designer shops");
    expect(p.location).toBe("Austin, Texas");
    // Target dimensions are known, but the ICP questions always apply.
    expect(buildGuidedQuestions("businesses", p).map((q) => q.id)).toEqual([
      "service",
      "requirement",
      "opportunity",
      "count",
    ]);
  });

  it("extracts category and city without a prep word", () => {
    const p = parseSearchIntent("businesses", "dentists austin texas");
    expect(p.category).toBe("dentists");
    expect(p.location?.toLowerCase()).toContain("austin");
  });

  it("asks for category + location when the ask is vague", () => {
    const p = parseSearchIntent("businesses", "find me businesses worth selling");
    expect(p.category).toBeUndefined();
    expect(p.location).toBeUndefined();
    const qs = buildGuidedQuestions("businesses", p);
    expect(qs.map((q) => q.id)).toEqual([
      "category",
      "location",
      "service",
      "requirement",
      "opportunity",
      "count",
    ]);
    // Required questions have no skip value.
    expect(qs[0].required).toBe(true);
    expect(qs[1].required).toBe(true);
  });

  it("asks only for location when the category is stated", () => {
    const p = parseSearchIntent("businesses", "dentists");
    expect(p.category).toBe("dentists");
    expect(p.location).toBeUndefined();
    const qs = buildGuidedQuestions("businesses", p);
    expect(qs.map((q) => q.id)).toEqual([
      "location",
      "service",
      "requirement",
      "opportunity",
      "count",
    ]);
  });

  it("runs immediately when both category and location are stated", () => {
    const p = parseSearchIntent("businesses", "dentists in Toronto");
    expect(p.category).toBe("dentists");
    expect(p.location).toBe("Toronto");
    // ICP questions remain — they describe the user, not the target.
    expect(buildGuidedQuestions("businesses", p).map((q) => q.id)).toEqual([
      "service",
      "requirement",
      "opportunity",
      "count",
    ]);
  });

  it("does not treat a generic noun as a category", () => {
    const p = parseSearchIntent("businesses", "10 businesses in Miami");
    expect(p.category).toBeUndefined();
    expect(p.location).toBe("Miami");
    expect(buildGuidedQuestions("businesses", p).map((q) => q.id)).toEqual([
      "category",
      "service",
      "requirement",
      "opportunity",
      "count",
    ]);
  });

  it("marks recommended defaults on the ICP questions", () => {
    const qs = buildGuidedQuestions("businesses", parseSearchIntent("businesses", "dentists"));
    const byId = new Map(qs.map((q) => [q.id, q]));
    expect(byId.get("requirement")?.options.find((o) => o.recommended)?.value).toBe("contact");
    expect(byId.get("opportunity")?.options.find((o) => o.recommended)?.value).toBe("any");
    expect(byId.get("count")?.options.find((o) => o.recommended)?.value).toBe("any");
  });

  it("keeps investor/jobs keywords inside business categories", () => {
    // "seed" is a category word here, not an investor stage.
    const seedShop = parseSearchIntent("businesses", "seed shops in Austin, TX");
    expect(seedShop.category).toBe("seed shops");
    expect(seedShop.stage).toBeUndefined();
    // "senior" is a category word here, not a seniority bucket.
    const seniorCare = parseSearchIntent("businesses", "senior care homes in Toronto");
    expect(seniorCare.category).toBe("senior care homes");
    expect(seniorCare.seniority).toBeUndefined();
  });
});

describe("parseSearchIntent — jobs", () => {
  it("extracts role, seniority, and place", () => {
    const p = parseSearchIntent("jobs", "senior designer roles in New York");
    expect(p.query).toBe("designer");
    expect(p.seniority).toBe("senior");
    expect(p.location).toBe("New York");
    // Engagement type is always confirmed with the user.
    expect(buildGuidedQuestions("jobs", p).map((q) => q.id)).toEqual(["employmentType"]);
  });

  it("detects remote-only asks", () => {
    const p = parseSearchIntent("jobs", "remote react developer jobs");
    expect(p.query).toBe("react developer");
    expect(p.remoteOnly).toBe(true);
    expect(p.region).toBe("remote");
    // Role + place known → seniority and engagement remain.
    expect(buildGuidedQuestions("jobs", p).map((q) => q.id)).toEqual([
      "seniority",
      "employmentType",
    ]);
  });

  it("strips self-description filler and asks for place + level", () => {
    const p = parseSearchIntent("jobs", "I'm a designer looking for a job");
    expect(p.query).toBe("designer");
    const qs = buildGuidedQuestions("jobs", p);
    expect(qs.map((q) => q.id)).toEqual(["location", "seniority", "employmentType"]);
  });

  it("maps experience wording to seniority buckets", () => {
    expect(parseSearchIntent("jobs", "junior data analyst jobs in Toronto").seniority).toBe(
      "junior",
    );
    expect(parseSearchIntent("jobs", "lead engineer positions in Berlin").seniority).toBe("lead");
  });

  it("treats internships as their own seniority level, not junior", () => {
    expect(parseSearchIntent("jobs", "intern").seniority).toBe("intern");
    expect(parseSearchIntent("jobs", "internships").seniority).toBe("intern");
    const p = parseSearchIntent("jobs", "frontend developer internship in Berlin");
    expect(p.seniority).toBe("intern");
    expect(p.location).toBe("Berlin");
    // The internship word must not leak into the role query.
    expect(p.query).toBe("frontend developer");
  });

  it("offers an intern option in the seniority question", () => {
    const p = parseSearchIntent("jobs", "remote react developer jobs");
    const seniorityQ = buildGuidedQuestions("jobs", p).find((q) => q.id === "seniority");
    expect(seniorityQ?.options.map((o) => o.value)).toEqual([
      "intern",
      "junior",
      "mid",
      "senior",
      "lead",
      "any",
    ]);
  });

  it("derives the coarse region from region words", () => {
    const p = parseSearchIntent("jobs", "marketing jobs in Europe");
    expect(p.location).toBe("Europe");
    expect(p.region).toBe("europe");
  });

  it("keeps the REMOTE_OPTION answer out of the location string", () => {
    // Simulates the questionnaire answer flowing through launch logic inputs.
    const p = parseSearchIntent("jobs", "nurse practitioner jobs");
    expect(p.query).toBe("nurse practitioner");
    expect(buildGuidedQuestions("jobs", p).map((q) => q.id)).toEqual([
      "location",
      "seniority",
      "employmentType",
    ]);
    expect(REMOTE_OPTION).toBe("__remote__");
  });
});

describe("parseSearchIntent — investors", () => {
  it("extracts stage, sector, location, and firm type", () => {
    const p = parseSearchIntent("investors", "seed VCs investing in AI startups in New York");
    expect(p.stage).toBe("Seed");
    expect(p.sector).toBe("AI");
    expect(p.location).toBe("New York");
    expect(p.entityType).toBe("firm");
    expect(p.query).toBeUndefined();
    // Only check size remains to ask.
    expect(buildGuidedQuestions("investors", p).map((q) => q.id)).toEqual(["checkBand"]);
  });

  it("detects angel (individual) investors", () => {
    const p = parseSearchIntent("investors", "angel investors in New York");
    expect(p.entityType).toBe("individual");
    expect(p.location).toBe("New York");
    expect(p.query).toBeUndefined();
  });

  it("reads check-size ranges", () => {
    const p = parseSearchIntent("investors", "fintech investors with $100K–$5M checks");
    expect(p.checkBand).toBe("seed");
    expect(p.sector).toBe("Fintech");
    expect(p.query).toBeUndefined();
  });

  it("asks stage / check / geography / sector / firm type for a bare ask", () => {
    const p = parseSearchIntent("investors", "find me investors");
    const qs = buildGuidedQuestions("investors", p);
    expect(qs.map((q) => q.id)).toEqual(["stage", "checkBand", "location", "sector", "entityType"]);
    // All investor questions are skippable with defaults.
    for (const q of qs) expect(q.skipValue).toBeDefined();
  });

  it("skips the entity-type question when the ask names the investor kind", () => {
    const p = parseSearchIntent("investors", "angel investors in New York");
    expect(buildGuidedQuestions("investors", p).map((q) => q.id)).not.toContain("entityType");
  });

  it("recommends reaching both firms and angels by default", () => {
    const p = parseSearchIntent("investors", "find me investors");
    const entityTypeQ = buildGuidedQuestions("investors", p).find((q) => q.id === "entityType");
    expect(entityTypeQ?.options.find((o) => o.recommended)?.value).toBe("any");
  });

  it("never leaves filler words in the query", () => {
    const p = parseSearchIntent("investors", "pre-seed investors in Europe for my startup");
    expect(p.query).toBeUndefined();
    expect(p.stage).toBe("Pre-seed");
    expect(p.location).toBe("Europe");
  });
});
