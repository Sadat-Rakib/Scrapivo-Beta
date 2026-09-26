import { describe, expect, it } from "vitest";
import { searchInvestorsDB } from "../investors.server";

const LIVE = process.env.LIVE_DB_TEST === "1";

describe.runIf(LIVE)("live investor Parquet", () => {
  it("finds known investors with meta", async () => {
    const { rows, meta } = await searchInvestorsDB({ name: "Aaref Hilaly", limit: 5 });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.engine).toBe("s3-parquet");
    expect(meta.rowsScanned).toBeGreaterThan(0);
    expect(rows.some((r) => r.name === "Aaref Hilaly")).toBe(true);
  }, 120_000);

  it("sector filter works", async () => {
    const { rows } = await searchInvestorsDB({ sector: "Fintech", limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
  }, 120_000);
}, 200_000);
