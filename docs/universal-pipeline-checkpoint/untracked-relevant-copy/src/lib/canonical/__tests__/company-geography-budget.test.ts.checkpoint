import { beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
vi.mock("../read-parquet.server", () => ({
  listPartitionFilesBySize: readers.list,
  readFiltered: readers.read,
}));
import { companyCategoryMatches, companyCountryCode, companyLocationMatches, searchCompaniesDB } from "../companies.server";

describe("stored company geography", () => {
  it("matches stored security vocabulary without unrelated security categories", () => {
    expect(companyCategoryMatches("Cyber Security, SaaS, Software", "cybersecurity company")).toBe(true);
    expect(companyCategoryMatches("Computer & Network Security", "cybersecurity company")).toBe(true);
    expect(companyCategoryMatches("Physical Security, Consulting", "cybersecurity company")).toBe(false);
    expect(companyCategoryMatches("Artificial Intelligence (AI), Infrastructure, Software", "ai infra/devtool startup")).toBe(true);
    expect(companyCategoryMatches("Developer Tools, Software", "ai infra/devtool startup")).toBe(true);
  });
  it.each(["Western US", "Northeastern US", "Greater Los Angeles Area, West Coast, Western US", "United States"])("recognizes observed US geography: %s", location => {
    expect(companyCountryCode(location)).toBe("US");
    expect(companyLocationMatches(location, "US")).toBe(true);
    expect(companyLocationMatches(location, "USA")).toBe(true);
  });
  it.each(["Canada", "Toronto, CAN", "Western Canada", "London, Ontario, Canada", "Richmond, BC, Canada", "Toronto, Ontario, Canada"])("recognizes Canada: %s", location => {
    expect(companyCountryCode(location)).toBe("CA");
    expect(companyLocationMatches(location, "CAN")).toBe(true);
  });
  it.each(["Australia", "Russia", "South America", "America", "USA, Canada"])("does not fabricate US membership: %s", location => {
    expect(companyLocationMatches(location, "US")).toBe(false);
  });
  it("preserves exact city geography", () => {
    expect(companyLocationMatches("Toronto, Canada", "Toronto")).toBe(true);
    expect(companyLocationMatches("Vancouver, Canada", "Toronto")).toBe(false);
  });
});

describe("company reader budget propagation", () => {
  beforeEach(() => {
    readers.list.mockReset().mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ key: `part${i}.parquet`, size: 9 - i })));
    readers.read.mockReset().mockResolvedValue({ rows: [], meta: { rowsScanned: 0, rowsReturned: 0, dbHit: false } });
  });
  it("shares cancellation and deadline across listing and both scan passes", async () => {
    const controller = new AbortController();
    const deadline = Date.now() + 10_000;
    await searchCompaniesDB({ industry: "cybersecurity", signal: controller.signal, deadline });
    expect(readers.list).toHaveBeenCalledWith("processed/companies_by_initial/", { signal: controller.signal, deadline });
    expect(readers.read).toHaveBeenCalledTimes(2);
    for (const [opts] of readers.read.mock.calls) {
      expect(opts.signal).toBe(controller.signal);
      expect(opts.deadline).toBe(deadline);
    }
  });
  it("does not start a widening scan after the first pass exhausts its budget", async () => {
    readers.read.mockResolvedValue({ rows: [], meta: { rowsScanned: 0, rowsReturned: 0, coverageIncomplete: true, stopReason: "deadline" } });
    const result = await searchCompaniesDB({ deadline: Date.now() + 10 });
    expect(readers.read).toHaveBeenCalledTimes(1);
    expect(result.meta.coverageIncomplete).toBe(true);
  });
});
