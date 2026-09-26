import { describe, expect, it } from "vitest";
import { equivalentDuration, isOrganization } from "./understanding-canary-equivalence";

describe("understanding canary equivalence", () => {
  it("accepts organizational schema synonyms without accepting people or jobs", () => {
    expect(isOrganization("company")).toBe(true);
    expect(isOrganization("business")).toBe(true);
    expect(isOrganization("person")).toBe(false);
    expect(isOrganization("job")).toBe(false);
  });

  it("normalizes equivalent duration spellings", () => {
    expect(equivalentDuration("2w", "14d")).toBe(true);
    expect(equivalentDuration("2 weeks", "14 days")).toBe(true);
    expect(equivalentDuration("1 month", "30d")).toBe(true);
    expect(equivalentDuration("2w", "13d")).toBe(false);
  });
});
