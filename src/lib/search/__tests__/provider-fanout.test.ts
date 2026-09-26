import { describe, expect, it } from "vitest";
import { fanOutProviders } from "../provider-fanout";

/** Phase 5: parallel uncapped provider fan-out. */
describe("fanOutProviders", () => {
  it("runs providers in parallel and merges rows", async () => {
    const order: string[] = [];
    const gate = (name: string, ms: number, rows: number[]) => ({
      name,
      run: async () => {
        await new Promise((r) => setTimeout(r, ms));
        order.push(name);
        return rows;
      },
    });
    const t0 = Date.now();
    const res = await fanOutProviders(
      [gate("a", 60, [1, 2]), gate("b", 60, [3])],
      { timeoutMs: 5000 },
    );
    // Parallel: wall-clock ≈ one slow provider, not the sum.
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.rows.sort()).toEqual([1, 2, 3]);
    expect(res.errors).toEqual([]);
    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("failure isolation: one throw doesn't kill healthy providers", async () => {
    const res = await fanOutProviders(
      [
        { name: "boom", run: async () => { throw new Error("down"); } },
        { name: "ok", run: async () => [7] },
      ],
      { timeoutMs: 5000 },
    );
    expect(res.rows).toEqual([7]);
    expect(res.errors).toEqual([{ name: "boom", error: "down" }]);
  });

  it("hung provider hits the budget, healthy rows still returned", async () => {
    const res = await fanOutProviders(
      [
        { name: "hung", run: () => new Promise<never>(() => {}) },
        { name: "ok", run: async () => [9] },
      ],
      { timeoutMs: 50 },
    );
    expect(res.rows).toEqual([9]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].name).toBe("hung");
    expect(res.errors[0].error).toMatch(/timeout/);
  });

  it("scales beyond any fixed cap (uncapped count)", async () => {
    const sources = Array.from({ length: 25 }, (_, i) => ({
      name: `p${i}`,
      run: async () => [i],
    }));
    const res = await fanOutProviders(sources, { timeoutMs: 5000 });
    expect(res.rows).toHaveLength(25);
    expect(res.errors).toEqual([]);
  });

  it("empty input resolves immediately with zero rows", async () => {
    const res = await fanOutProviders([], { timeoutMs: 1000 });
    expect(res).toMatchObject({ rows: [], errors: [] });
  });

  it("never throws on synchronous thunk explosions", async () => {
    const res = await fanOutProviders(
      [{ name: "sync-boom", run: () => { throw new Error("sync"); } }],
      { timeoutMs: 1000 },
    );
    expect(res.rows).toEqual([]);
    expect(res.errors).toEqual([{ name: "sync-boom", error: "sync" }]);
  });
});
