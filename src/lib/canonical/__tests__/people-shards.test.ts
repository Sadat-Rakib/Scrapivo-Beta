/** People shard resolution battery: names, abbreviations, and ISO codes all
 *  resolve to existing partitions only — never a wrong shard. Pure. */
import { describe, expect, it } from "vitest";
import { personCountryMatches, personRoleMatches, resolvePeopleShards } from "@/lib/canonical/people.server";

const KEYS = [
  "processed/people_by_country/_part=afghanistan/data_0.parquet",
  "processed/people_by_country/_part=afghanistan/data_1.parquet",
  "processed/people_by_country/_part=united-states/data_0.parquet",
  "processed/people_by_country/_part=india/data_0.parquet",
  "processed/people_by_country/_part=arizona/data_0.parquet",
  "processed/people_by_country/_part=bangladesh/data_0.parquet",
];

describe("resolvePeopleShards", () => {
  it("full names resolve", () => {
    expect(resolvePeopleShards(KEYS, "India")).toEqual([
      "processed/people_by_country/_part=india/data_0.parquet",
    ]);
  });
  it("abbreviations resolve to existing shards (USA → united-states)", () => {
    expect(resolvePeopleShards(KEYS, "USA")).toEqual([
      "processed/people_by_country/_part=united-states/data_0.parquet",
    ]);
  });
  it("ISO codes resolve (IN → india, BD → bangladesh)", () => {
    expect(resolvePeopleShards(KEYS, "IN")).toHaveLength(1);
    expect(resolvePeopleShards(KEYS, "BD")).toHaveLength(1);
  });
  it("region slugs pass through; unknown words yield no shard (never wrong)", () => {
    expect(resolvePeopleShards(KEYS, "Arizona")).toHaveLength(1);
    expect(resolvePeopleShards(KEYS, "Atlantis")).toEqual([]);
    expect(resolvePeopleShards(KEYS, "")).toEqual([]);
  });
});

describe("personRoleMatches", () => {
  it("matches normalized title tokens without conflating unrelated roles", () => {
    expect(personRoleMatches("Senior Sales Manager", "sales managers")).toBe(true);
    expect(personRoleMatches("Co-Founder & CEO", "founder")).toBe(true);
    expect(personRoleMatches("Financial Advisor", "software engineer")).toBe(false);
  });
});

describe("personCountryMatches", () => {
  it("matches ISO and country-name representations without substring accidents", () => {
    expect(personCountryMatches("United Kingdom", "GB")).toBe(true);
    expect(personCountryMatches("Canada", "CA")).toBe(true);
    expect(personCountryMatches("United States", "CA")).toBe(false);
  });
});
