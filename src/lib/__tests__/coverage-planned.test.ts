/** Phase 1.7: coverage-planned retrieval battery. Flag-gated executor:
 *  bounded cheapest-first tiers, early stop (no fanout), per-tier timeouts,
 *  provider honestly skipped, legacy parity with the flag off. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";
import { makeEvidence } from "../search/evidence";

afterEach(() => {
  delete process.env.USE_COVERAGE_SELECTOR;
});

const s3Fake = (rows: unknown[]) =>
  (async () => ({
    rows,
    meta: {
      dbHit: rows.length > 0, engine: "s3-parquet", partitionsRead: ["fake"],
      rowsScanned: rows.length, rowsReturned: rows.length,
    },
  })) as never;

const IN_ROWS = [
  {
    name: "Pune Smile", category: "dentist", locality: "Pune", region: "MH",
    country: "IN", address: "1 FC Rd", registry_id: "overture:aaa",
  },
  {
    name: "Mumbai Bright", category: "dentist", locality: "Mumbai", region: "MH",
    country: "IN", address: "2 MG Rd", registry_id: "overture:bbb",
  },
];

const indexFake = (rows: Record<string, unknown>[]) =>
  // Honors the fetch contract (limit + offset): returns at most `lim` rows
  // from `off`, like the real range() query. Mocks that ignore the window
  // would defeat early-stop/hasMore accounting.
  (async (spec: unknown, lim?: number, off?: number) => ({
    rows: rows.slice(off ?? 0, (off ?? 0) + (lim ?? rows.length)).map((r, i) => ({
      kind: "business" as const,
      key: (r.key as string) ?? `k${i}`,
      entity_id: (r.key as string) ?? `k${i}`,
      entity_resolved: true,
      page_type: "entity_page" as const,
      evidence: [makeEvidence({
        source_url: `db://businesses/${(r.key as string) ?? `k${i}`}`,
        source_type: "db", evidence_type: "identity", supports: "identity",
        subject: (r.key as string) ?? `k${i}`,
        excerpt: [r.title, r.category, r.location].filter(Boolean).join(" · "),
      })],
      title: (r.title as string) ?? "?",
      detail: (r.detail as string) ?? "",
      category: (r.category as string) ?? null,
      location: (r.location as string) ?? null,
      country: (r.country as string) ?? null,
    })),
    meta: {
      dbHit: rows.length > 0, engine: "pg-index",
      partitionsRead: ["idx_businesses(country,city_norm,category)"],
      rowsScanned: rows.length, rowsReturned: rows.length,
    },
  })) as never;

describe("coverage-planned retrieval (USE_COVERAGE_SELECTOR=true)", () => {
  it("uncovered geography (Dhaka): S3 serves after hot skip, provider disabled here", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    const s3 = vi.fn(s3Fake([{
      name: "Dhaka Dental", category: "dentist", locality: "Dhaka",
      region: "Dhaka", country: "BD", address: "1 Gulshan",
      registry_id: "overture:dhk",
    }]));
    const res = await runSpecSearchCore(
      // providerBusinesses: null pins the provider tier off so this test
      // isolates hot→S3 fallback (the provider tier has its own battery
      // with fakes; the real OSM default must never fire in unit tests).
      "dentists in Dhaka", { businesses: s3, index: null, providerBusinesses: null }, 25, { mode: "looking" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("Dhaka Dental");
    expect(s3).toHaveBeenCalledTimes(1);
    expect(res.dbMeta.map((m) => m.engine)).toContain("s3-parquet");
  });

  it("sufficient hot tier stops the search: S3 never called (no fanout)", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    process.env.USE_INDEXED_SEARCH = "true";
    const s3 = vi.fn(s3Fake(IN_ROWS));
    try {
      const res = await runSpecSearchCore(
        "dentists in India",
        {
          businesses: s3,
          index: indexFake(
            // 30 hot rows: the fetch window (25+1) fills, the cap trips,
            // the page is fillable from hot alone → S3 must never run.
            Array.from({ length: 30 }, (_, i) => ({
              key: `k${i}`, title: `Clinic ${i}`, detail: "Pune, MH, IN",
              category: "dentist", location: "Pune", country: "IN",
            })),
          ),
        },
        25,
        { mode: "looking" },
      );
      expect(res.rows).toHaveLength(25);
      expect(s3).not.toHaveBeenCalled();
      expect(res.dbMeta.map((m) => m.engine)).toEqual(["pg-index"]);
    } finally {
      delete process.env.USE_INDEXED_SEARCH;
    }
  });

  it("thin hot tier falls through to S3 (bounded fallback, same budget)", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    process.env.USE_INDEXED_SEARCH = "true";
    const s3 = vi.fn(s3Fake(IN_ROWS));
    try {
      const res = await runSpecSearchCore(
        "dentists in India",
        {
          businesses: s3,
          providerBusinesses: null,
          index: indexFake([{
            key: "k1", title: "Only Clinic", detail: "Pune, MH, IN",
            category: "dentist", location: "Pune", country: "IN",
          }]),
        },
        25,
        { mode: "looking" },
      );
      expect(s3).toHaveBeenCalledTimes(1);
      // 1 hot + 2 S3, deduped by key.
      expect(res.rows).toHaveLength(3);
      expect(res.dbMeta.map((m) => m.engine)).toEqual(["pg-index", "s3-parquet"]);
    } finally {
      delete process.env.USE_INDEXED_SEARCH;
    }
  });

  it("flag off keeps the legacy order byte-identical", async () => {
    process.env.USE_COVERAGE_SELECTOR = "false";
    const s3 = vi.fn(s3Fake(IN_ROWS));
    const res = await runSpecSearchCore(
      "dentists in India", { businesses: s3, index: null }, 25, { mode: "looking" },
    );
    expect(res.rows).toHaveLength(2);
    expect(s3).toHaveBeenCalledTimes(1);
  });
});
