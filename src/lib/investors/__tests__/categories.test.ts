import { describe, expect, it } from "vitest";
import {
  categorySector,
  categoryStage,
  dedupeLabels,
  getInvestorSectors,
  getInvestorStages,
} from "../types";
import type { IndividualInvestor, InvestorRecord } from "../types";

describe("dedupeLabels", () => {
  it("dedupes case-insensitively and keeps the first clean label", () => {
    expect(dedupeLabels(["AI", "ai", " AI ", "A I"])).toEqual(["AI", "A I"]);
    expect(dedupeLabels(["Fintech", "FinTech", "fintech"])).toEqual(["Fintech"]);
  });

  it("trims whitespace and collapses inner whitespace for comparison", () => {
    expect(dedupeLabels(["  SaaS ", "SaaS", "Health  Care", "health care"])).toEqual([
      "SaaS",
      "Health Care",
    ]);
  });

  it("drops empty labels", () => {
    expect(dedupeLabels(["", "  ", null, undefined, "AI"])).toEqual(["AI"]);
  });
});

describe("categorySector / categoryStage", () => {
  it("extracts the outer parenthetical, preserving nested parens", () => {
    const cat =
      "Pre-seed (Agentic AI AI Infrastructure Artificial Intelligence (AI) Foundational AI Generative AI)";
    expect(categorySector(cat)).toBe(
      "Agentic AI AI Infrastructure Artificial Intelligence (AI) Foundational AI Generative AI",
    );
    expect(categoryStage(cat)).toBe("Pre-seed");
  });

  it("handles simple entries", () => {
    expect(categorySector("Seed (Fintech)")).toBe("Fintech");
    expect(categoryStage("Seed (Fintech)")).toBe("Seed");
  });

  it("returns the trimmed string when no parens exist", () => {
    expect(categorySector("  AI  ")).toBe("AI");
    expect(categoryStage("  AI  ")).toBe("AI");
  });
});

describe("getInvestorSectors", () => {
  it("dedupes the same sector repeated across stages", () => {
    const rec = {
      investment_categories: [
        "Pre-seed (Fintech)",
        "Seed (Fintech)",
        "Series A (Fintech)",
        "Pre-seed (SaaS)",
        "Seed (saas)",
        "Series A ( SaaS )",
      ],
    } as unknown as IndividualInvestor;
    expect(getInvestorSectors(rec)).toEqual(["Fintech", "SaaS"]);
  });

  it("handles the real mega-sector blob without truncation or dupes", () => {
    const blob =
      "Agentic AI AI Infrastructure Artificial Intelligence (AI) Foundational AI Generative AI";
    const rec = {
      investment_categories: [
        `Pre-seed (${blob})`,
        `Seed (${blob})`,
        "Pre-seed (Cloud)",
        "Series A (Cloud)",
      ],
    } as unknown as IndividualInvestor;
    expect(getInvestorSectors(rec)).toEqual([blob, "Cloud"]);
  });

  it("reads legacy focus_areas and dedupes them too", () => {
    const rec = {
      focus_areas: [
        { sector: "AI", stage: "Seed" },
        { sector: "ai", stage: "Series A" },
        { sector: " Climate ", stage: "Seed" },
      ],
    } as unknown as InvestorRecord;
    expect(getInvestorSectors(rec)).toEqual(["AI", "Climate"]);
  });

  it("returns [] when neither field exists", () => {
    expect(getInvestorSectors({} as unknown as IndividualInvestor)).toEqual([]);
  });
});

describe("getInvestorStages", () => {
  it("dedupes stages across category entries", () => {
    const rec = {
      investment_categories: ["Pre-seed (AI)", "Pre-seed (Cloud)", "Series A (AI)"],
    } as unknown as IndividualInvestor;
    expect(getInvestorStages(rec)).toEqual(["Pre-seed", "Series A"]);
  });

  it("reads legacy stages arrays", () => {
    const rec = { stages: ["Seed", "seed", " Series A "] } as unknown as InvestorRecord;
    expect(getInvestorStages(rec)).toEqual(["Seed", "Series A"]);
  });
});
