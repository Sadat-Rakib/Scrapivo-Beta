/**
 * Enrich empty investment_locations from HQ location; normalize aliases;
 * expand country tokens with region/continent parents.
 * Run: npx tsx scripts/enrich-investor-locations.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  effectiveInvestLocations,
  expandInvestLocationsWithParents,
  normalizeInvestorLocationList,
  parseHqToInvestTokens,
} from "../src/lib/investors/location-hierarchy";

const path = resolve("data/investors_merged.json");
const data = JSON.parse(readFileSync(path, "utf8")) as {
  schema_version: number;
  generated_at: string;
  investors: Array<{
    investment_locations?: string[];
    location?: string;
    [k: string]: unknown;
  }>;
};

let emptyBefore = 0;
let emptyAfter = 0;
let filled = 0;
let expanded = 0;

for (const inv of data.investors) {
  const before = inv.investment_locations || [];
  if (!before.length) emptyBefore += 1;
  const normalized = normalizeInvestorLocationList(before);
  const derived = effectiveInvestLocations(normalized, inv.location);
  if (!before.length && derived.length) filled += 1;
  const withParents = expandInvestLocationsWithParents(derived.length ? derived : normalized);
  if (withParents.length > (derived.length || normalized.length)) expanded += 1;
  inv.investment_locations = withParents;
  if (!inv.investment_locations.length) emptyAfter += 1;
}

data.generated_at = new Date().toISOString();
writeFileSync(path, JSON.stringify(data, null, 2), "utf8");

try {
  const alt = resolve("data/investors.json");
  writeFileSync(alt, JSON.stringify(data, null, 2), "utf8");
} catch {
  /* ignore */
}

console.log(
  JSON.stringify(
    {
      total: data.investors.length,
      emptyBefore,
      emptyAfter,
      filledFromHq: filled,
      expandedWithParents: expanded,
      sampleDhakaTokens: parseHqToInvestTokens("Dhaka, Bangladesh"),
      sampleNyTokens: parseHqToInvestTokens("New York, USA"),
    },
    null,
    2,
  ),
);
