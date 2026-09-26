import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";

const LIVE = process.env.LIVE_DB_TEST === "1";

describe.runIf(LIVE)("live spec core founders", () => {
  it("yo need founders returns DB rows", async () => {
    const res = await runSpecSearchCore("yo need founders i can reach out to rn", {}, 25);
    console.log("STATUS", res.spec.status, "ROWS", res.rows.length,
      "REJECTED", res.rejected, "META", JSON.stringify(res.dbMeta));
    console.log("FIRST", JSON.stringify(res.rows.slice(0, 2)));
    expect(res.spec.entity).toBe("person");
  }, 180_000);
}, 200_000);
