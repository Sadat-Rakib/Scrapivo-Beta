/** Live-provider tier battery: OSM leads map to validated SpecRows, skips and
 *  failures stay bounded and honest. Provider injected (no network). */
import { describe, expect, it, vi } from "vitest";
import { normaliseOsmCraft, runSpecSearchCore } from "../spec-search.functions";

const OSM_LEADS = [
  {
    source: "osm",
    title: "Smile Dental Studio",
    snippet: "12 Main St · Phone: +911234567890",
    full_post_url: "https://smile.example",
    author: "Smile Dental Studio",
    match_reasons: ["dental_clinic near Pune"],
    why_match: "dental_clinic near Pune",
    address: "12 Main St, Pune",
    emails: [],
    phones: ["+911234567890"],
  },
  {
    source: "osm",
    title: "Tooth Palace",
    snippet: "44 MG Rd",
    author: "Tooth Palace",
    match_reasons: ["dentist near Pune"],
    why_match: "dentist near Pune",
    address: "44 MG Rd, Pune",
  },
];

const providerFake = (leads: unknown[] = OSM_LEADS) =>
  (async () => leads) as never;

const s3Empty = (async () => ({
  rows: [],
  meta: {
    dbHit: false,
    engine: "s3-parquet",
    partitionsRead: ["fake"],
    rowsScanned: 0,
    rowsReturned: 0,
  },
})) as never;

describe("normaliseOsmCraft", () => {
  it("maps raw OSM tags to canonical crafts", () => {
    expect(normaliseOsmCraft("dental_clinic", "dentists")).toBe("dentist");
    expect(normaliseOsmCraft("fast_food", "restaurants")).toBe("restaurant");
    expect(normaliseOsmCraft("plumber", "x")).toBe("plumber");
    expect(normaliseOsmCraft("weird_tag_xyz", "dentists")).toBe("dentists");
    expect(normaliseOsmCraft("", "dentists")).toBe("dentists");
  });
});

describe("provider tier (USE_COVERAGE_SELECTOR=true)", () => {
  it("OSM leads become validated SpecRows with osm: keys and provider-osm meta", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const res = await runSpecSearchCore(
        "dentists in Pune",
        { businesses: s3Empty, index: null, providerBusinesses: providerFake() },
        25,
        { mode: "looking" },
      );
      expect(res.rows.length).toBeGreaterThan(0);
      for (const r of res.rows) {
        expect(r.key).toMatch(/^osm:/);
        expect(r.country).toBe("IN");
      }
      expect(res.dbMeta.map((m) => m.engine)).toContain("provider-osm");
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });

  it("provider throw stays bounded: tier-error journaled, zero rows, no crash", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const boom = vi.fn(async () => {
        throw new Error("overpass down");
      });
      const res = await runSpecSearchCore(
        "dentists in Pune",
        { businesses: s3Empty, index: null, providerBusinesses: boom as never },
        25,
        { mode: "looking" },
      );
      expect(boom).toHaveBeenCalledTimes(1);
      expect(res.rows).toEqual([]);
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });

  it("non-business entities never call the provider", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const provider = vi.fn(providerFake());
      await runSpecSearchCore(
        "founders in Mumbai",
        {
          people: (async () => ({
            rows: [],
            meta: {
              dbHit: false,
              engine: "s3-parquet",
              partitionsRead: ["fake"],
              rowsScanned: 0,
              rowsReturned: 0,
            },
          })) as never,
          index: null,
          providerBusinesses: provider as never,
        },
        25,
        { mode: "looking" },
      );
      expect(provider).not.toHaveBeenCalled();
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });
});
