import { afterEach, describe, expect, it, vi } from "vitest";
import { readFiltered } from "../read-parquet.server";

const meta = { dbHit: false, engine: "s3-parquet", partitionsRead: [] };

afterEach(() => vi.restoreAllMocks());

describe("canonical read budget", () => {
  it("retains completed reads and rejects a response arriving after the deadline", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const result = await readFiltered<{ name: string }>({
      keys: ["first.parquet", "second.parquet"],
      columns: ["name"],
      limit: 10,
      deadline: 1_050,
      meta,
      readFile: async (key) => {
        if (key === "second.parquet") now = 1_100;
        return [{ name: key }];
      },
    });
    expect(result.rows).toEqual([{ name: "first.parquet" }]);
    expect(result.meta).toMatchObject({
      coverageIncomplete: true,
      stopReason: "deadline",
      rowsScanned: 1,
      partitionsRead: ["first.parquet"],
    });
  });

  it("aborts injected network I/O at the deadline", async () => {
    const result = await readFiltered({
      keys: ["stalled.parquet"],
      columns: ["name"],
      limit: 1,
      deadline: Date.now() + 20,
      meta,
      readFile: (_key, _columns, budget) => new Promise((_resolve, reject) => {
        budget.signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
      }),
    });
    expect(result.meta).toMatchObject({
      coverageIncomplete: true,
      stopReason: "deadline",
      partitionsRead: [],
    });
  });

  it("propagates external cancellation instead of returning partial empty", async () => {
    const controller = new AbortController();
    await expect(readFiltered({
      keys: ["stalled.parquet"],
      columns: ["name"],
      limit: 1,
      signal: controller.signal,
      meta,
      readFile: (_key, _columns, budget) => new Promise((_resolve, reject) => {
        budget.signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
        controller.abort();
      }),
    })).rejects.toThrow("SEARCH_CANCELLED");
  });
});
