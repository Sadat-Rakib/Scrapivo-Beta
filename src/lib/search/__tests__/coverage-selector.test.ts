/** Phase 1.2c: coverage selector battery. Fixture matrices mirror the real
 *  data/coverage-matrix.json shapes (IN covered, BD-like uncovered). No
 *  network, no DB, deterministic. */
import { describe, expect, it } from "vitest";
import {
  selectCoverageSources,
  type CoverageMatrix,
} from "@/lib/search/coverage-selector";

const MATRIX: CoverageMatrix = {
  entities: {
    businesses: {
      hotIndexByIso: { IN: 436088, US: 169967, BD: 0, XX: 0 },
      byGeo: {
        IN: { s3Files: 1, s3Rows: null }, // present, unmeasured (246MB file)
        BD: { s3Files: 1, s3Rows: 124482 },
      },
      declaredProviders: ["osm-nominatim", "osm-overpass"],
    },
    companies: {
      hotIndexByIso: { GB: 50000 },
      s3Pool: { files: 110 },
      declaredProviders: [], // no live company provider: never planned
    },
    people: {
      hotIndexByIso: {},
      s3Pool: { files: 362 },
      declaredProviders: [],
    },
  },
};

const sources = (d: { steps: { source: string; condition: string }[] }) =>
  d.steps.map((s) => `${s.source}:${s.condition}`);

describe("coverage selector", () => {
  it("covered geography (IN businesses): hot-index always, contingencies conditional", () => {
    const d = selectCoverageSources({ entity: "business", countryIso: "IN" }, MATRIX);
    expect(d.terminal).toBe("covered");
    expect(sources(d)).toEqual([
      "hot-index:always",
      "s3-parquet:if-insufficient",
      "provider:if-insufficient",
    ]);
  });

  it("uncovered geography (BD businesses): hot still first (cheapest), S3 fallback planned", () => {
    const d = selectCoverageSources({ entity: "business", countryIso: "BD" }, MATRIX);
    expect(d.terminal).toBe("uncovered");
    expect(d.steps[0].source).toBe("hot-index");
    expect(d.steps.map((s) => s.source)).toContain("s3-parquet");
  });

  it("partial geography (hot>0 but thin): terminal partial, S3 contingency kept", () => {
    const thin: CoverageMatrix = {
      entities: {
        businesses: {
          hotIndexByIso: { ZZ: 7 },
          byGeo: { ZZ: { s3Files: 1, s3Rows: 5000 } },
          declaredProviders: ["osm-nominatim"],
        },
      },
    };
    const d = selectCoverageSources({ entity: "business", countryIso: "ZZ" }, thin);
    expect(d.terminal).toBe("partial");
    expect(sources(d)).toEqual([
      "hot-index:always",
      "s3-parquet:if-insufficient",
      "provider:if-insufficient",
    ]);
  });

  it("zero-result geography: empty plan, exhausted terminal, zero calls implied", () => {
    const empty: CoverageMatrix = {
      entities: { businesses: { hotIndexByIso: {}, declaredProviders: [] } },
    };
    const d = selectCoverageSources({ entity: "business", countryIso: "AQ" }, empty);
    expect(d.terminal).toBe("exhausted");
    expect(d.steps).toEqual([]);
    expect(d.notes.join(" ")).toMatch(/honest empty/i);
  });

  it("unparseable country: never crashes, provider-or-exhausted honestly", () => {
    const d = selectCoverageSources({ entity: "business", countryIso: "Puna" }, MATRIX);
    expect(d.steps[0]?.source ?? "exhausted").toBeDefined();
    expect(d.notes.join(" ")).toMatch(/unparseable/i);
  });

  it("budget maxSources caps tiers: single query can never fan out", () => {
    const d = selectCoverageSources(
      { entity: "business", countryIso: "IN" },
      MATRIX,
      { maxSources: 1 },
    );
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0].source).toBe("hot-index");
    expect(d.notes.join(" ")).toMatch(/maxSources=1/);
  });

  it("companies: provider never planned when no declared capability", () => {
    const d = selectCoverageSources({ entity: "company", countryIso: "GB" }, MATRIX);
    expect(d.terminal).toBe("covered");
    expect(d.steps.map((s) => s.source)).not.toContain("provider");
    expect(d.steps.map((s) => s.source)).toContain("s3-parquet"); // pool fallback
  });

  it("null s3Rows (present-but-unmeasured) still plans the S3 tier", () => {
    const d = selectCoverageSources({ entity: "business", countryIso: "IN" }, MATRIX);
    expect(d.steps.map((s) => s.source)).toContain("s3-parquet");
  });

  it("accepts generated people matrices that expose top-level s3Files", () => {
    const generatedShape: CoverageMatrix = {
      entities: { people: { hotIndexByIso: { CA: 0 }, s3Files: 362 } },
    };
    const d = selectCoverageSources({ entity: "person", countryIso: "CA" }, generatedShape);
    expect(d.steps.map((s) => s.source)).toContain("s3-parquet");
    expect(d.terminal).not.toBe("exhausted");
  });

  it("city query keeps contingency and says grain is unknown", () => {
    const d = selectCoverageSources(
      { entity: "business", countryIso: "IN", cityNorm: "pune" },
      MATRIX,
    );
    expect(d.notes.join(" ")).toMatch(/city-grain unknown/);
    expect(d.steps.length).toBeGreaterThan(1);
  });

  it("timeouts and stop threshold are explicit on every step", () => {
    const d = selectCoverageSources(
      { entity: "business", countryIso: "BD", pageSize: 50 },
      MATRIX,
      { perSourceTimeoutMs: { provider: 5000 } },
    );
    expect(d.stopWhenRows).toBe(50);
    for (const s of d.steps) expect(s.timeoutMs).toBeGreaterThan(0);
    expect(d.steps.find((s) => s.source === "provider")?.timeoutMs).toBe(5000);
  });
});
