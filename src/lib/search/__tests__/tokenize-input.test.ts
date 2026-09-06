import { describe, expect, it } from "vitest";
import { expandAbbreviations, detectUrgency } from "../abbreviations";
import { tokenizeInput } from "../tokenize-input";

describe("expandAbbreviations", () => {
  it("expands rn to urgency words", () => {
    expect(expandAbbreviations("need investors rn")).toContain("right now");
  });
  it("does not turn pronoun us into a geo", () => {
    expect(expandAbbreviations("help us find investors")).not.toContain("united states");
  });
  it("treats uppercase US as geo", () => {
    expect(expandAbbreviations("investors in the US")).toContain("united states");
  });
  it("normalizes stage variants", () => {
    expect(expandAbbreviations("preseed ai")).toContain("pre-seed");
    expect(expandAbbreviations("pre seed ai")).toContain("pre-seed");
  });
  it("expands vc and pls", () => {
    expect(expandAbbreviations("plz find seed vcs")).toContain("venture capital");
  });
});

describe("detectUrgency", () => {
  it("flags rn and asap", () => {
    expect(detectUrgency("need investors rn")).toBe(true);
    expect(detectUrgency("hire asap")).toBe(true);
  });
  it("is false for plain queries", () => {
    expect(detectUrgency("investors in fintech")).toBe(false);
  });
});

describe("tokenizeInput — investor example", () => {
  it("extracts category/stage/sector/urgency from the canonical example", () => {
    const t = tokenizeInput("need investors backing pre-seed ai rn");
    expect(t.category).toBe("investor");
    expect(t.stage).toBe("pre-seed");
    expect(t.sector).toBe("ai");
    expect(t.urgency).toBe(true);
    expect(t.geo).toBeNull();
  });
  it("rn never becomes a geo token", () => {
    const t = tokenizeInput("investors rn");
    expect(t.geo).toBeNull();
    expect(t.keywords).not.toContain("right");
    expect(t.keywords).not.toContain("now");
  });
});

describe("tokenizeInput — scale/geo/sector", () => {
  it("parses 20+ scale and US geo", () => {
    const t = tokenizeInput("find me 20+ startup founders in the US");
    expect(t.scale).toBe(20);
    expect(t.geo?.toLowerCase()).toContain("united states");
  });
  it("detects series a and fintech", () => {
    const t = tokenizeInput("series a fintech investors");
    expect(t.stage).toBe("series a");
    expect(t.sector).toBe("fintech");
    expect(t.category).toBe("investor");
  });
  it("detects jobs and roles", () => {
    const t = tokenizeInput("plz find remote react developer jobs asap");
    expect(t.category).toBe("job");
    expect(t.urgency).toBe(true);
  });
  it("prefers people when people + company words mix", () => {
    expect(tokenizeInput("find me 20+ startup founders").category).toBe("people");
    expect(tokenizeInput("company executives in fintech").category).toBe("people");
  });
  it("keeps company for bare company queries", () => {
    expect(tokenizeInput("ai startups in europe").category).toBe("company");
  });
  it("keeps keywords filler-free", () => {
    const t = tokenizeInput("yo gimme investors for my ai startup pre-seed");
    expect(t.keywords).not.toContain("gimme");
    expect(t.keywords).toContain("investors");
    expect(t.keywords).toContain("ai");
  });
});
