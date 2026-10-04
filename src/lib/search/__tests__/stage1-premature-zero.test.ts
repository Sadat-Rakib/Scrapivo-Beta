import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "../../spec-search.functions";

/**
 * Stage 1 P0 invariant: a round where NO retrieval ran (blocking clarify /
 * confirm) must never carry a terminal search outcome. The client renders
 * zero states from outcomes; an outcome on a clarify round is the premature
 * "No verified matches / 0 results" bug.
 */

const emptyDeps = {
  index: null as null,
  people: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
  businesses: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
};

const zeroGapfill = {
  liveGapfill: {
    osm: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
    web: async () => [],
    browser: async () => [] as never[],
  },
};

describe("Stage 1 P0: no premature zero during Stage-1 rounds", () => {
  it("a blocking clarify round (underspecified request) carries NO terminal outcome", async () => {
    // Deliberately underspecified: the frame cannot resolve a scope, so the
    // clarification authority asks. No retrieval has run — the response must
    // not look like a completed zero-result search.
    const res = await runSpecSearchCore("find businesses", emptyDeps, 10, {}, {});
    expect(res.clarify.length).toBeGreaterThan(0);
    expect(res.questions.length).toBeGreaterThan(0);
    expect(res.spec.status).toBe("needs_clarification");
    expect(res.outcome).toBeUndefined();
    expect(res.rows).toHaveLength(0);
  }, 30_000);

  it("a forced run that actually searches keeps its honest terminal outcome", async () => {
    // "Search with defaults" bypasses clarification and runs retrieval; the
    // zero that comes back is an honest completed-search zero WITH an outcome.
    const res = await runSpecSearchCore(
      "find plumbers",
      { index: null, ...zeroGapfill } as never,
      10,
      {},
      { force: true },
    );
    expect(res.outcome).toBeDefined();
    expect(res.clarify).toHaveLength(0);
  }, 30_000);

  it("an off-topic boundary response is terminal but carries no fake zero count", async () => {
    const res = await runSpecSearchCore("what's the weather in Paris", emptyDeps, 10, {}, {});
    expect(res.boundary_message).toBeTruthy();
    expect(res.rows).toHaveLength(0);
    expect(res.clarify).toHaveLength(0);
  }, 30_000);
});
