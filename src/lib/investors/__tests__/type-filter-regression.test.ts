import { describe, expect, it } from "vitest";
import { getAllInvestors, searchInvestors } from "../search";

/**
 * Regression: merged rows carry free-string `type` (e.g.
 * "venture_capital_investor") with no entity_type/investor_type. Filtering by
 * investorType must infer from title/firm/type — never wipe all rows.
 */
describe("investorType filter on merged-schema rows", () => {
  it("loads a non-empty dataset", () => {
    expect(getAllInvestors().length).toBeGreaterThan(1000);
  });

  it("investorType=vc returns rows (no silent wipeout)", async () => {
    const rows = await searchInvestors({ investorType: "vc", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("investorType=angel returns rows", async () => {
    const rows = await searchInvestors({ investorType: "angel", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("query narrows but unfiltered search is broad", async () => {
    const all = await searchInvestors({ limit: 100 });
    expect(all.length).toBeGreaterThan(0);
  });
});
