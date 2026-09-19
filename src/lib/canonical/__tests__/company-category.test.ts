import { describe, expect, it } from "vitest";
import { companyCategoryMatches, companyCategoryTerms } from "../companies.server";

describe("company category vocabulary", () => {
  it("maps common query labels to physical category labels", () => {
    expect(companyCategoryMatches("Information Technology, Software", "SaaS")).toBe(true);
    expect(companyCategoryMatches("Artificial Intelligence, Analytics", "AI")).toBe(true);
    expect(companyCategoryMatches("Health Care, Medical", "Healthcare")).toBe(true);
  });

  it("does not use unsafe two-letter AI substring matching", () => {
    expect(companyCategoryMatches("Retail", "AI")).toBe(false);
    expect(companyCategoryTerms("AI")).not.toContain("AI");
  });
});
