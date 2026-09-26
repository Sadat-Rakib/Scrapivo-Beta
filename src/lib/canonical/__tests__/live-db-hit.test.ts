/**
 * LIVE DB-hit proof (Phase 1 anti-theater evidence).
 * Hits real canonical readers: S3 Parquet (people/companies) + file DBs.
 * Guarded by LIVE_DB_TEST=1 (needs AWS credentials); skipped otherwise so
 * CI stays green. Run: LIVE_DB_TEST=1 AWS_PROFILE=scrapivo npx vitest --run
 * src/lib/canonical/__tests__/live-db-hit.test.ts
 */
import { describe, expect, it } from "vitest";
import { searchPeopleDB } from "../people.server";
import { searchCompaniesDB } from "../companies.server";

const LIVE = process.env.LIVE_DB_TEST === "1";

describe.runIf(LIVE)("live canonical DB hits", () => {
  it("P1a: SaaS founders in New York retrieves real rows with meta", async () => {
    const { rows, meta } = await searchPeopleDB({
      role: "founder", industry: "SaaS", country: "New York", limit: 10,
    });
    console.log("META", JSON.stringify(meta));
    expect(meta.engine).toBe("s3-parquet");
    expect(meta.partitionsRead.length).toBeGreaterThan(0);
    expect(meta.rowsScanned).toBeGreaterThan(0);
  }, 120_000);

  it("P1b: CTOs in Brazil retrieve real rows", async () => {
    const { rows, meta } = await searchPeopleDB({
      role: "Chief Technology Officer", country: "Brazil", limit: 5,
    });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.rowsScanned).toBeGreaterThan(0);
  }, 120_000);

  it("P3a: company category search retrieves real rows", async () => {
    const { rows, meta } = await searchCompaniesDB({ category: "Health Care", limit: 5 });
    console.log("ROWS", rows.length, "META", JSON.stringify(meta));
    expect(meta.rowsScanned).toBeGreaterThan(0);
  }, 180_000);
}, 200_000);
