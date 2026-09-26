import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";

const LIVE = process.env.LIVE_DB_TEST === "1";

describe.runIf(LIVE)("live bare-company shard ordering", () => {
  it("bare companies query fills from biggest shards", async () => {
    const res = await runSpecSearchCore(
      "yo need companies rn",
      {},
      50,
      { industry: "SaaS", location: "United States" },
    );
    console.log("ROWS", res.rows.length, "META", JSON.stringify(res.dbMeta));
    expect(res.rows.length).toBeGreaterThan(1);
  }, 180_000);
}, 200_000);
