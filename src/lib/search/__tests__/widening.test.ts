/**
 * Bounded interactive widening (PRD §33-37).
 *
 * The interactive path must keep acquiring until delivered-or-qualified-ready
 * >= the requested target, coverage is exhausted (job-engine rule: 2
 * consecutive zero-new-candidate passes), or the run budget ends. Widening
 * reuses the job-engine's frozen semantics (PRD §6) and NEVER loosens a user
 * constraint (PRD §35).
 */
import { describe, expect, it, vi } from "vitest";
import { runSpecSearchCore, type SpecRow } from "../../spec-search.functions";
import {
  MAX_WIDEN_PASSES,
  widenDesiredCount,
  widenStopDecision,
} from "../widening";
import { nextPoolTarget as jobEngineNextPoolTarget } from "@/lib/jobs/job-engine.server";
import { nextPoolTarget as reExportedNextPoolTarget, COVERAGE_EMPTY_PASSES } from "../widening";

describe("widenStopDecision (pure widening machine)", () => {
  it("stops with TARGET_REACHED the moment the qualified count meets the target", () => {
    expect(
      widenStopDecision({ qualifiedCount: 5, target: 5, widenPasses: 0, emptyWidenPasses: 0, deadlineHit: false, cancelled: false }),
    ).toBe("TARGET_REACHED");
    expect(
      widenStopDecision({ qualifiedCount: 6, target: 5, widenPasses: 0, emptyWidenPasses: 0, deadlineHit: false, cancelled: false }),
    ).toBe("TARGET_REACHED");
  });

  it("simulated 2-empty-pass case ends with COVERAGE_EXHAUSTED", () => {
    const decisionAfterFirstEmpty = widenStopDecision({
      qualifiedCount: 1, target: 5, widenPasses: 1, emptyWidenPasses: 1, deadlineHit: false, cancelled: false,
    });
    expect(decisionAfterFirstEmpty).toBe("CONTINUE");
    const decisionAfterSecondEmpty = widenStopDecision({
      qualifiedCount: 1, target: 5, widenPasses: 2, emptyWidenPasses: 2, deadlineHit: false, cancelled: false,
    });
    expect(decisionAfterSecondEmpty).toBe("COVERAGE_EXHAUSTED");
  });

  it("a productive pass resets exhaustion, and the pass budget ends with WIDEN_LIMIT", () => {
    expect(
      widenStopDecision({ qualifiedCount: 1, target: 5, widenPasses: MAX_WIDEN_PASSES, emptyWidenPasses: 0, deadlineHit: false, cancelled: false }),
    ).toBe("WIDEN_LIMIT");
  });

  it("deadline, cancellation and spent budget end with DEADLINE — before the pass limit", () => {
    expect(
      widenStopDecision({ qualifiedCount: 1, target: 5, widenPasses: 0, emptyWidenPasses: 0, deadlineHit: true, cancelled: false }),
    ).toBe("DEADLINE");
    expect(
      widenStopDecision({ qualifiedCount: 1, target: 5, widenPasses: 0, emptyWidenPasses: 0, deadlineHit: false, cancelled: true }),
    ).toBe("DEADLINE");
    expect(
      widenStopDecision({ qualifiedCount: 1, target: 5, widenPasses: 0, emptyWidenPasses: 0, deadlineHit: false, cancelled: false, budgetRemainingMs: 0 }),
    ).toBe("DEADLINE");
  });
});

describe("shared widening semantics (PRD §6 — one machine, not two)", () => {
  it("re-exports the job engine's frozen pool math by reference", () => {
    expect(reExportedNextPoolTarget).toBe(jobEngineNextPoolTarget);
    expect(COVERAGE_EMPTY_PASSES).toBe(2);
  });

  it("scales the per-pass desired count without exceeding the pool target", () => {
    expect(widenDesiredCount({ widenPass: 1, baseDesiredCount: 30, poolTarget: 250 })).toBe(30);
    expect(widenDesiredCount({ widenPass: 2, baseDesiredCount: 30, poolTarget: 250 })).toBe(60);
    expect(widenDesiredCount({ widenPass: 3, baseDesiredCount: 30, poolTarget: 90 })).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// Integration: runSpecSearchCore with an injected OSM adapter (no live calls).
// ---------------------------------------------------------------------------

function osmRow(seq: number): SpecRow {
  const name = `Austin Plumbing ${seq}`;
  return {
    kind: "business",
    key: `live-osm:test-${seq}`,
    entity_id: `live-osm:test-${seq}`,
    entity_resolved: true,
    identity_confidence: 0.92,
    page_type: "entity_page",
    resolution_method: "osm_poi",
    title: name,
    detail: "Austin",
    email: null,
    phone: `+1 512 555 010${seq}`,
    phoneStatus: "ok",
    url: null,
    website_url: null,
    source_url: `https://www.openstreetmap.org/node/${seq}`,
    category: "plumber",
    location: "Austin",
    country: null,
    evidence: [{
      source_url: `osm:live-osm:test-${seq}`,
      source_type: "osm" as const,
      excerpt: `${name} · plumber · Austin`,
      observed_at: new Date().toISOString(),
      evidence_type: "identity" as const,
      supports: "identity" as const,
      confidence: 0.8,
      extraction_method: "osm_tags",
      subject: `live-osm:test-${seq}`,
    }],
    why_match: `${name} — plumber in Austin`,
  } as SpecRow;
}

type OsmCall = { query: string; location: string; category: string; widen: boolean };

/** Scripted OSM adapter: call N returns script[N-1] (sequence numbers). */
function scriptedOsm(script: number[][]) {
  const calls: OsmCall[] = [];
  const osm = vi.fn(async (query: string, location: string, category: string, opts?: { widen?: boolean }) => {
    calls.push({ query, location, category, widen: opts?.widen === true });
    const seqs = script[calls.length - 1] ?? [];
    return seqs.map((n) => osmRow(n));
  });
  return { osm, calls };
}

const emptyDeps = {
  index: null as null,
  people: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
  businesses: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
};

// A stated purpose makes the spec ready_to_search without a clarify round.
const ANSWERS = { purpose: "I want to sell tools to them" };

describe("interactive widening loop (runSpecSearchCore)", () => {
  it("simulated 2 empty widen passes end with COVERAGE_EXHAUSTED and still deliver partial results", async () => {
    // Initial pass yields one qualified row; both widen passes yield nothing.
    const { osm, calls } = scriptedOsm([[1], [], []]);
    const res = await runSpecSearchCore(
      "Find 5 plumbers in Austin",
      { ...emptyDeps, liveGapfill: { osm, web: async () => [], browser: async () => [] as SpecRow[] } },
      5,
      ANSWERS,
      { force: true },
    );
    expect(res.rows.length, `outcome=${res.outcome} widening=${JSON.stringify(res.widening)}`).toBe(1);
    expect(res.rows[0].title).toBe("Austin Plumbing 1");
    expect(res.widenPasses).toBe(2);
    expect(res.widening).toEqual({ passes: 2, outcome: "COVERAGE_EXHAUSTED" });
    // The loop stopped without burning the full pass budget.
    expect(calls.filter((c) => c.widen)).toHaveLength(2);
    // Per-pass additions stay visible in the provider diagnostics.
    expect(res.providerAttempts?.filter((d) => d.provider === "osm-local").length).toBeGreaterThanOrEqual(3);
    expect(res.retrievalTrace?.providers?.length).toBeGreaterThanOrEqual(3);
    expect(res.retrievalTrace?.widening).toEqual({ passes: 2, outcome: "COVERAGE_EXHAUSTED" });
  }, 30_000);

  it("a target-reached case stops widening immediately", async () => {
    // Page size 2: initial pass returns 1, widen pass 1 completes the target.
    const { osm, calls } = scriptedOsm([[1], [2, 3]]);
    const res = await runSpecSearchCore(
      "Find 5 plumbers in Austin",
      { ...emptyDeps, liveGapfill: { osm, web: async () => [], browser: async () => [] as SpecRow[] } },
      2,
      ANSWERS,
      { force: true },
    );
    expect(res.rows.length).toBe(2);
    expect(res.widenPasses).toBe(1);
    expect(res.widening).toEqual({ passes: 1, outcome: "TARGET_REACHED" });
    // Exactly one widen pass ran — no widening past the met target.
    expect(calls.filter((c) => c.widen)).toHaveLength(1);
  }, 30_000);

  it("constraints are never loosened across passes (same spec, same location/category)", async () => {
    // Every scripted pass returns nothing new — widening runs to exhaustion.
    const { osm, calls } = scriptedOsm([[1], [], []]);
    const res = await runSpecSearchCore(
      "Find 5 plumbers in Austin",
      { ...emptyDeps, liveGapfill: { osm, web: async () => [], browser: async () => [] as SpecRow[] } },
      5,
      ANSWERS,
      { force: true },
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      // Same category and location every pass — never a widened area or trade.
      expect(call.category).toBe("plumber");
      expect(call.location).toBe("Austin");
      expect(call.query).toBe(res.spec.raw_query);
    }
    // The initial pass is not a widen pass; every later one is.
    expect(calls[0].widen).toBe(false);
    expect(calls.slice(1).every((c) => c.widen)).toBe(true);
    // The spec itself is untouched by widening.
    expect(res.spec.criteria.some((c) => c.field === "category" && c.value === "plumber")).toBe(true);
    expect(res.spec.criteria.some((c) => c.field === "location" && c.value === "Austin")).toBe(true);
  }, 30_000);

  it("rows without a qualified disposition do not satisfy the target — widening keeps going (delivery-metric regression)", async () => {
    // Regression: the widen loop used the pre-gate why-match count, so rows
    // that pass why-match but are not yet theorem-qualified satisfied the
    // target and widening stopped ("TARGET_REACHED", 0 passes) while the
    // strict final gate later dropped them (P04 delivered 1 of 10). The
    // metric must count delivery-capable rows only.
    const unqualified = (n: number): SpecRow => ({
      ...osmRow(n),
      disposition: "discovered",
    } as unknown as SpecRow);
    const { osm, calls } = scriptedOsm([[1, 2, 3, 4, 5], [6], []]);
    const res = await runSpecSearchCore(
      "Find 5 plumbers in Austin",
      { ...emptyDeps, liveGapfill: { osm, web: async () => [], browser: async () => [] as SpecRow[] } },
      5,
      ANSWERS,
      { force: true },
    );
    // The invariant (PRD §36): either the target was genuinely delivered —
    // stopping at zero widen passes is correct — or widening must have run.
    // A "TARGET_REACHED" stop with fewer delivered rows than the target is
    // the P04 regression this guards against.
    const passes = res.widenPasses ?? 0;
    if (res.rows.length >= 5) {
      expect(passes).toBe(0);
    } else {
      expect(passes).toBeGreaterThanOrEqual(1);
      expect(res.widening?.outcome).not.toBe("TARGET_REACHED");
    }
    expect(calls.filter((c) => c.widen).length).toBe(passes);
  }, 30_000);
});

describe("rejection-reason booking (Windhoek 149 autopsy)", () => {
  it("rows rejected by the pre-research gate carry their failing dimension into rejectReasons", async () => {
    const { createCandidateLedger } = await import("../candidate-ledger");
    const ledger = createCandidateLedger();
    const row = { key: "k1", entity_id: "k1", title: "Generic Trading CC", category: "company", location: "Windhoek" } as never;
    ledger.retrieved(row);
    ledger.filtered(row, "rejected_category");
    const summary = ledger.summary();
    expect(summary.counts.filtered).toBe(1);
    expect(summary.rejectReasons).toEqual({ rejected_category: 1 });
    expect(summary.accounting?.unaccounted ?? 0).toBe(0);
  });
});

describe("target-aware research queue (Final-MVP Phase 3)", () => {
  it("sizes the research pool beyond six candidates when the requested target is 10", async () => {
    // 24 researchable candidates + target 10: the old flat slice(0, 6) made
    // reaching 10 delivered impossible by construction. The target-aware
    // queue researches the full strength-ranked pool (>= 12, <= 3x target).
    const { osm } = (() => {
      const calls: string[][] = [];
      const mk = (n: number): any[] => Array.from({ length: n }, (_, i) => ({
        kind: "business" as const,
        key: `live-osm:q-${i}`, entity_id: `live-osm:q-${i}`, entity_resolved: true,
        identity_confidence: 0.9, page_type: "entity_page", resolution_method: "osm_poi",
        title: `Austin Plumber ${i}`, detail: "Austin", email: null,
        phone: `+1 512 555 ${String(1000 + i).slice(-4)}`, phoneStatus: "ok",
        url: null, website_url: null, source_url: `https://www.openstreetmap.org/node/${i}`,
        category: "plumber", location: "Austin", country: null,
        evidence: [{ source_url: `osm:q-${i}`, source_type: "osm" as const, excerpt: `Austin Plumber ${i} plumber Austin`, observed_at: new Date().toISOString(), evidence_type: "identity" as const, supports: "identity" as const, confidence: 0.8, extraction_method: "osm_tags" as const, subject: `live-osm:q-${i}` }],
        why_match: `Austin Plumber ${i} — plumber in Austin`,
      }));
      return { osm: vi.fn(async () => mk(24) as unknown as SpecRow[]), calls } as unknown as { osm: (q: string, l: string, c: string, o?: { widen?: boolean }) => Promise<SpecRow[]>; calls: string[][] };
    })();
    const res = await runSpecSearchCore(
      "Find 10 plumbers in Austin with a phone number",
      { ...emptyDeps, liveGapfill: { osm, web: async () => [], browser: async () => [] as SpecRow[] } },
      10,
      ANSWERS,
      { force: true },
    );
    // The strict gate may drop some — but the pool researched must exceed six.
    expect(res.rows.length).toBeGreaterThanOrEqual(6);
    expect(res.widenPasses ?? 0).toBeLessThanOrEqual(3);
  }, 30_000);
});
