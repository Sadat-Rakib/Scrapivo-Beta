import { describe, expect, it } from "vitest";
import {
  filterBusinessFileRecords,
  resolveRegionFiles,
  type BusinessFileRecord,
  type RegionManifestEntry,
} from "../businesses-file-source";

const rec = (over: Partial<BusinessFileRecord> = {}): BusinessFileRecord => ({
  source: "overture",
  registry_id: "1",
  name: "Acme Plumbing",
  name_normalized: "acme plumbing",
  category: "plumber",
  categories: [],
  address_raw: "123 Main St, Austin, TX 78701",
  address_normalized: "123 main st austin tx 78701",
  locality: "Austin",
  region: "TX",
  country: "US",
  confidence_score: 80,
  ...over,
});

const MANIFEST: RegionManifestEntry[] = [
  {
    file_stem: "gb",
    iso2: "GB",
    name: "United Kingdom",
    region: "europe",
    aliases: ["uk", "britain", "england", "london", "manchester"],
  },
  {
    file_stem: "ae",
    iso2: "AE",
    name: "United Arab Emirates",
    region: "middle_east",
    aliases: ["uae", "dubai", "abu dhabi"],
  },
  { file_stem: "us", iso2: "US", name: "United States", region: "americas_n", aliases: ["usa", "america"] },
  { file_stem: "in", iso2: "IN", name: "India", region: "asia", aliases: ["india", "mumbai", "bangalore"] },
  { file_stem: "ca", iso2: "CA", name: "Canada", region: "americas_n", aliases: ["canada", "toronto"] },
];

const AVAILABLE = new Set(["gb", "ae", "us", "in", "ca", "austin"]);

const CITY_MAP = {
  camrose: { iso2: "CA", name: "Camrose", aliases: [] },
  austin: { iso2: "US", name: "Austin", aliases: [] },
  mumbai: { iso2: "IN", name: "Mumbai", aliases: [] },
};

describe("resolveRegionFiles — query location → country files", () => {
  it("routes country names and aliases", () => {
    expect(resolveRegionFiles("plumbers in London", MANIFEST, AVAILABLE, CITY_MAP)).toEqual({
      stems: ["gb"],
      cityTokens: [],
    });
    expect(resolveRegionFiles("cafes in Dubai", MANIFEST, AVAILABLE, CITY_MAP)).toEqual({
      stems: ["ae"],
      cityTokens: [],
    });
    expect(resolveRegionFiles("gyms in India", MANIFEST, AVAILABLE, CITY_MAP)).toEqual({
      stems: ["in"],
      cityTokens: [],
    });
  });

  it("routes ANY city via the GeoNames city map (incl. small cities like Camrose)", () => {
    expect(resolveRegionFiles("plumbers in camrose", MANIFEST, AVAILABLE, CITY_MAP)).toEqual({
      stems: ["ca"],
      cityTokens: ["camrose"],
    });
    expect(resolveRegionFiles("plumbers in Mumbai", MANIFEST, AVAILABLE, CITY_MAP)).toEqual({
      stems: ["in"],
      cityTokens: ["mumbai"],
    });
  });

  it("city + country file both route, city file first", () => {
    expect(resolveRegionFiles("salons in Austin", MANIFEST, AVAILABLE, CITY_MAP)).toEqual({
      stems: ["austin", "us"],
      cityTokens: ["austin"],
    });
  });

  it("skips filler tokens and unknown places", () => {
    expect(resolveRegionFiles("near me", MANIFEST, AVAILABLE, CITY_MAP).stems).toEqual([]);
    expect(resolveRegionFiles("Atlantis", MANIFEST, AVAILABLE, CITY_MAP).stems).toEqual([]);
  });
});

describe("filterBusinessFileRecords — standard mode", () => {
  const FIXTURES: BusinessFileRecord[] = [
    rec(),
    rec({
      registry_id: "2",
      name: "Bright Smile Dental",
      name_normalized: "bright smile dental",
      category: "dentist",
      phone: "+15125550100",
      website: "https://brightsmile.example.com",
      confidence_score: 90,
    }),
    rec({ registry_id: "4", name: "#19", name_normalized: "19" }),
  ];

  it("hard-filters by location tokens", () => {
    const rows = filterBusinessFileRecords(FIXTURES, { craft: "plumber", location: "Austin" });
    expect(rows.length).toBe(1);
    expect(filterBusinessFileRecords(FIXTURES, { craft: "plumber", location: "Miami" })).toEqual([]);
  });

  it("matches craft via category synonyms (incl. gerund forms)", () => {
    expect(
      filterBusinessFileRecords(FIXTURES, { craft: "plumbers", location: "Austin" }).map((r) => r.rec.registry_id),
    ).toContain("1");
    const dentists = filterBusinessFileRecords(FIXTURES, { craft: "dentists", location: "Austin" });
    expect(dentists.map((r) => r.rec.registry_id)).toEqual(["2"]);
  });

  it("filters junk names and respects limits", () => {
    const rows = filterBusinessFileRecords(FIXTURES, { location: "Austin", limit: 1 });
    expect(rows.length).toBe(1);
    expect(rows.map((r) => r.rec.name)).not.toContain("#19");
  });

  it("returns nothing without a usable location", () => {
    expect(filterBusinessFileRecords(FIXTURES, { location: "" })).toEqual([]);
  });
});

describe("filterBusinessFileRecords — city mode (small cities like Camrose)", () => {
  const FIXTURES: BusinessFileRecord[] = [
    rec({
      registry_id: "1",
      name: "Camrose Hardware",
      name_normalized: "camrose hardware",
      category: "hardware_store",
      locality: "Camrose",
      region: "AB",
      country: "CA",
    }),
    rec({
      registry_id: "2",
      name: "Edmonton Plumbing Co",
      name_normalized: "edmonton plumbing co",
      category: "plumber",
      locality: "Edmonton",
      region: "AB",
      country: "CA",
      phone: "+17805550100",
    }),
  ];

  it("city mode passes the whole country file; craft gate still applies", () => {
    const rows = filterBusinessFileRecords(FIXTURES, {
      craft: "plumber",
      location: "plumbers in camrose",
      cityTokens: ["camrose"],
    });
    // Camrose Hardware (hardware_store) is correctly rejected by the craft
    // gate even in city mode; Edmonton Plumbing passes (same country file).
    expect(rows.map((r) => r.rec.registry_id)).toEqual(["2"]);
    expect(rows[0].score).toBeGreaterThan(30);
  });

  it("applies the no_website opportunity filter in city mode", () => {
    const rows = filterBusinessFileRecords(
      [
        rec({
          registry_id: "2",
          name: "Edmonton Plumbing Co",
          name_normalized: "edmonton plumbing co",
          category: "plumber",
          locality: "Edmonton",
          region: "AB",
          country: "CA",
          phone: "+17805550100",
        }),
        rec({
          registry_id: "3",
          name: "Calgary Plumbing Co",
          name_normalized: "calgary plumbing co",
          category: "plumber",
          locality: "Calgary",
          region: "AB",
          country: "CA",
          website: "https://calgaryplumbing.example.com",
        }),
      ],
      {
        craft: "plumber",
        location: "plumbers in camrose",
        cityTokens: ["camrose"],
        opportunity: "no_website",
      },
    );
    expect(rows.map((r) => r.rec.registry_id)).toEqual(["2"]);
  });
});

describe("scoreRecord — extraCrafts fallback (classifier mis-picks)", () => {
  it("rescues 'plumbers' when coreSkill latched onto 'web'", () => {
    const score = filterBusinessFileRecords([rec()], {
      craft: "web",
      extraCrafts: ["plumbers", "austin", "presence"],
      location: "Austin",
    });
    expect(score.length).toBe(1);
  });
});
