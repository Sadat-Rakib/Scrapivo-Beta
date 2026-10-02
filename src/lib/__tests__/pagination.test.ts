/** Phase 1.8: pagination battery. Limit is page size only — pages slice
 *  verified matches, hasMore is exact, offset 0 preserves legacy behavior.
 *  Defect A: a page that delivers ZERO rows to the user must never promise
 *  more (hasMore false, moreAvailableMessage null) — the I01/I02/R03 evidence
 *  showed "Show more" + a more-leads toast under 0 results. */
import { describe, expect, it, vi } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";

// Qualifying rows: a business needs a contact channel or a site before it may
// reach the page (completeness gate). Phone-only rows pass the pipeline.
const ROWS_5 = Array.from({ length: 5 }, (_, i) => ({
  name: `Pune Dental ${i}`,
  category: "dentist",
  locality: "Pune",
  region: "MH",
  country: "IN",
  address: `${i} FC Rd`,
  phone: `+9120255500${i}`,
  registry_id: `overture:p${i}`,
}));

// Contact-less rows: every one dies at the qualification/completeness gate,
// so the delivered page is empty while the raw kept set still overflows the
// fetch window — the exact zero-delivered shape from the evidence runs.
const ROWS_5_NO_CONTACT = ROWS_5.map(({ phone: _phone, ...rest }) => rest);

const s3Fake = (rows: unknown[]) =>
  (async () => ({
    rows,
    meta: {
      dbHit: rows.length > 0,
      engine: "s3-parquet",
      partitionsRead: ["fake"],
      rowsScanned: rows.length,
      rowsReturned: rows.length,
    },
  })) as never;

const MODE = { mode: "looking" };

describe("pagination (S3 path)", () => {
  it("page 1: limit rows, hasMore true, echo offset/limit", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5), index: null },
      2,
      MODE,
      { offset: 0 },
    );
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].title).toBe("Pune Dental 0");
    expect(res.hasMore).toBe(true);
    expect(res.offset).toBe(0);
    expect(res.limit).toBe(2);
    expect(res.totalAvailable).toBeNull();
  });

  it("middle page slices verified matches", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5), index: null },
      2,
      MODE,
      { offset: 2 },
    );
    expect(res.rows.map((r) => r.title)).toEqual(["Pune Dental 2", "Pune Dental 3"]);
    expect(res.hasMore).toBe(true);
  });

  it("last page: remainder rows, hasMore false", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5), index: null },
      2,
      MODE,
      { offset: 4 },
    );
    expect(res.rows.map((r) => r.title)).toEqual(["Pune Dental 4"]);
    expect(res.hasMore).toBe(false);
  });

  it("past-the-end offset: empty page, hasMore false, honest empty", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5), index: null },
      2,
      MODE,
      { offset: 50 },
    );
    expect(res.rows).toEqual([]);
    expect(res.hasMore).toBe(false);
  });

  it("delivered page keeps the existing more-available behavior", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5), index: null },
      2,
      MODE,
      { offset: 0 },
    );
    expect(res.rows).toHaveLength(2);
    expect(res.hasMore).toBe(true);
    expect(res.moreAvailableMessage).toBe("There are more verified leads — want to see them?");
  });
});

describe("zero-delivery contract (Defect A)", () => {
  it("zero rows returned: hasMore false and no more-leads promise (fetch-window overflow)", async () => {
    // Every row fails qualification → the delivered page is empty, but the
    // kept set (5) still overflows offset 2 + limit 2 — pre-fix this produced
    // hasMore: true + "There are more verified leads…" under 0 results.
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5_NO_CONTACT), index: null },
      2,
      MODE,
      { offset: 2 },
    );
    expect(res.rows).toEqual([]);
    expect(res.qualified_count).toBe(0);
    expect(res.hasMore).toBe(false);
    expect(res.moreAvailableMessage).toBeNull();
  });

  it("zero rows returned on the first page: no more-leads promise either", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune",
      { businesses: s3Fake(ROWS_5_NO_CONTACT), index: null },
      2,
      MODE,
      { offset: 0 },
    );
    expect(res.rows).toEqual([]);
    expect(res.hasMore).toBe(false);
    expect(res.moreAvailableMessage).toBeNull();
  });
});

describe("pagination (pg-index path)", () => {
  it("passes limit+1 and offset through to the indexer", async () => {
    const index = vi.fn(async () => ({
      rows: [],
      meta: {
        dbHit: false,
        engine: "pg-index",
        partitionsRead: ["fake"],
        rowsScanned: 0,
        rowsReturned: 0,
      },
    }));
    process.env.USE_INDEXED_SEARCH = "true";
    try {
      await runSpecSearchCore(
        "dentists in Pune",
        { businesses: s3Fake([]), index: index as never },
        2,
        MODE,
        { offset: 3 },
      );
      expect(index).toHaveBeenCalledTimes(1);
      const [, lim, off] = index.mock.calls[0] as unknown as [unknown, number, number];
      expect(lim).toBe(3); // limit + 1 probe row
      expect(off).toBe(3);
    } finally {
      delete process.env.USE_INDEXED_SEARCH;
    }
  });
});
