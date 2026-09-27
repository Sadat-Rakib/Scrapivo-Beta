import { describe, expect, it } from "vitest";
import { buildBooleanWebQueries, expandQuery, injectLocationBias, usFounderDiscoveryVariants } from "@/lib/search/query-expander";

describe("H7 US-founder discovery variants", () => {
  it("produces site-scoped startup-directory, ATS, and people-source dorks", () => {
    const variants = usFounderDiscoveryVariants("AI engineer");
    expect(variants.length).toBeGreaterThanOrEqual(5);
    expect(variants.some((q) => q.includes("site:crunchbase.com") && q.includes("site:ycombinator.com"))).toBe(true);
    expect(variants.some((q) => q.includes("site:jobs.lever.co") && q.includes("site:boards.greenhouse.io"))).toBe(true);
    expect(variants.some((q) => q.includes("site:linkedin.com/in"))).toBe(true);
    expect(variants.every((q) => q.toLowerCase().includes("founder"))).toBe(true);
  });

  it("injects the variants only for US-restricted founder queries", () => {
    const founder = expandQuery("find SaaS founders hiring engineers");
    const us = injectLocationBias(founder, "United States");
    const baseline = injectLocationBias(founder, "Canada");
    const added = us.booleanWebQueries.filter((q) => !baseline.booleanWebQueries.includes(q));
    expect(added.length).toBeGreaterThanOrEqual(3);
    expect(added.some((q) => q.includes("site:crunchbase.com"))).toBe(true);
    // The cap grows so variants survive alongside the biased base queries.
    expect(us.booleanWebQueries.length).toBeGreaterThan(baseline.booleanWebQueries.length);
  });

  it("does not inject founder variants for US non-founder queries", () => {
    const plumber = expandQuery("find HVAC companies needing bookkeepers");
    const us = injectLocationBias(plumber, "USA");
    expect(us.booleanWebQueries.some((q) => q.includes("site:crunchbase.com"))).toBe(false);
    expect(us.booleanWebQueries.some((q) => q.includes("site:jobs.lever.co"))).toBe(false);
  });

  it("keeps every injected variant site-scoped", () => {
    for (const q of usFounderDiscoveryVariants("plumbing")) {
      expect(q).toMatch(/site:[a-z.]+/);
    }
  });

  it("does not disturb plain boolean query construction", () => {
    const queries = buildBooleanWebQueries("react", "developer", ["next.js"]);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((q) => typeof q === "string" && q.length > 0)).toBe(true);
  });
});
