import { describe, expect, it } from "vitest";
import { searchBusinessesDB } from "../businesses.server";

const LIVE = process.env.LIVE_DB_TEST === "1";

describe.runIf(LIVE)("live business Parquet", () => {
  it("plumbers in Austin come from the canonical corpus", async () => {
    const { rows, meta } = await searchBusinessesDB({ category: "plumber", location: "Austin", limit: 10 });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.engine).toBe("s3-parquet");
    expect(meta.rowsScanned).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].phone).toBeTruthy();
  }, 180_000);

  it("dentists in London resolve via gazetteer", async () => {
    const { rows, meta } = await searchBusinessesDB({ category: "dentist", location: "London", limit: 5 });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.partitionsRead.some((p) => p.includes("gazetteer"))).toBe(true);
    expect(meta.rowsScanned).toBeGreaterThan(0);
  }, 180_000);

  it("plumbers in Canada resolve to ca.parquet via country", async () => {
    const { rows, meta } = await searchBusinessesDB({ category: "plumber", location: "Canada", limit: 10 });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.partitionsRead.some((p) => p.includes("ca.parquet") || p.includes("gazetteer"))).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  }, 180_000);

  it("hotels in Bahrain read only bh.parquet (no pk noise)", async () => {
    const { rows, meta } = await searchBusinessesDB({ category: "hotel", location: "Bahrain", limit: 10 });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.partitionsRead.some((p) => p.includes("bh.parquet"))).toBe(true);
    expect(meta.partitionsRead.some((p) => p.includes("pk.parquet"))).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => (r.country ?? "").toUpperCase() === "BH")).toBe(true);
  }, 180_000);
}, 400_000);
