/**
 * Source yield learning (Workstream 4) — offline: decay math, stable
 * reorder, diagnostic mapping, and the buildSourcePlan post-step wiring.
 */
import { describe, expect, it } from "vitest";
import {
  applyStableYieldOrder,
  decayWeightedYield,
  type YieldWindow,
} from "../source-yield";
import { providerDiagnosticToOutcome } from "../source-yield.server";
import { buildSourcePlan } from "../source-plan";
import type { SourceCapability } from "../source-capabilities";
import type { SearchSpec } from "../search-spec";

const NOW = new Date("2026-09-27T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("decayWeightedYield", () => {
  it("returns null with insufficient decayed evidence (< 8 attempts)", () => {
    expect(decayWeightedYield([], NOW)).toBeNull();
    // 8 attempts 1 day old decay to ~7.25 < 8 → unknown, not zero.
    expect(
      decayWeightedYield([{ window_start: daysAgo(1), attempts: 8, qualified: 8 }], NOW),
    ).toBeNull();
    expect(
      decayWeightedYield([{ window_start: daysAgo(0), attempts: 0, qualified: 0 }], NOW),
    ).toBeNull();
  });

  it("a single lucky window cannot dominate — prior caps it below 0.9", () => {
    const y = decayWeightedYield(
      [{ window_start: daysAgo(1), attempts: 10, qualified: 10 }],
      NOW,
    );
    expect(y).not.toBeNull();
    // Perfect 10/10 but +2/+0.2 smoothing prior: ~0.84, never 1.0.
    expect(y!).toBeGreaterThan(0.8);
    expect(y!).toBeLessThan(0.9);
  });

  it("weights recent windows far above old ones (7d half-life)", () => {
    const fresh = decayWeightedYield(
      [{ window_start: daysAgo(0), attempts: 100, qualified: 50 }],
      NOW,
    );
    // Exact: (50 + 0.2) / (100 + 2).
    expect(fresh).toBeCloseTo(50.2 / 102, 6);

    const mixed = decayWeightedYield(
      [
        { window_start: daysAgo(7), attempts: 8, qualified: 0 }, // weight 0.5
        { window_start: daysAgo(0), attempts: 8, qualified: 8 }, // weight 1.0
      ],
      NOW,
    );
    // (0·0.5 + 8·1 + 0.2) / ((8·0.5 + 8·1) + 2) = 8.2 / 14
    expect(mixed).toBeCloseTo(8.2 / 14, 6);
    expect(mixed!).toBeGreaterThan(0.5);
    expect(mixed!).toBeLessThan(0.8);
  });

  it("ignores future windows (clock skew)", () => {
    expect(
      decayWeightedYield(
        [{ window_start: new Date(NOW.getTime() + 86_400_000).toISOString(), attempts: 99, qualified: 99 }],
        NOW,
      ),
    ).toBeNull();
  });

  it("28-day-old windows still count, heavily decayed (weight 1/16)", () => {
    const y = decayWeightedYield(
      [{ window_start: daysAgo(28), attempts: 160, qualified: 80 }],
      NOW,
    );
    expect(y).not.toBeNull(); // decayed attempts 10 ≥ 8
    expect(y!).toBeCloseTo((80 / 16 + 0.2) / (160 / 16 + 2), 6);
  });
});

describe("applyStableYieldOrder (stable reorder)", () => {
  it("keeps the original order (copy) when there is no data", () => {
    const sources = ["a", "b", "c"];
    expect(applyStableYieldOrder(sources, new Map())).toEqual(["a", "b", "c"]);
    expect(applyStableYieldOrder(sources, new Map([["b", null]]))).toEqual(["a", "b", "c"]);
    expect(sources).toEqual(["a", "b", "c"]); // input untouched
  });

  it("moves the high-yield source up; zero-data sources keep position", () => {
    const sources = ["no-data", "weak", "strong"];
    const yields = new Map<string, number | null>([
      ["weak", 0.1],
      ["strong", 0.9],
    ]);
    expect(applyStableYieldOrder(sources, yields)).toEqual(["no-data", "strong", "weak"]);
  });

  it("ties keep original order; nothing is ever dropped", () => {
    const sources = ["a", "b", "c"];
    const yields = new Map<string, number | null>([
      ["a", 0.5],
      ["b", 0.5],
      ["c", 0.1],
    ]);
    expect(applyStableYieldOrder(sources, yields)).toEqual(["a", "b", "c"]);
    expect(applyStableYieldOrder(sources, yields).sort()).toEqual(sources.sort());
  });
});

describe("providerDiagnosticToOutcome", () => {
  it("maps attempts/candidates/qualified/failures", () => {
    expect(
      providerDiagnosticToOutcome({
        provider: "searxng",
        attempted: true,
        succeeded: true,
        artifactsFound: 5,
        entitiesResolved: 3,
        qualified: 2,
      }),
    ).toEqual({
      attempts: 1,
      candidates: 5,
      qualified: 2,
      contacts: 0,
      signals: 0,
      latencyMs: 0,
      failures: 0,
    });
    expect(
      providerDiagnosticToOutcome({
        provider: "searxng",
        attempted: true,
        succeeded: false,
        artifactsFound: 0,
        entitiesResolved: 0,
        qualified: 0,
        error: "timeout",
      }).failures,
    ).toBe(1);
    expect(
      providerDiagnosticToOutcome({
        provider: "paid-serp",
        attempted: false,
        succeeded: false,
        artifactsFound: 0,
        entitiesResolved: 0,
        qualified: 0,
      }).attempts,
    ).toBe(0);
  });
});

describe("buildSourcePlan yieldOrder post-step", () => {
  const SPEC: SearchSpec = {
    entity: "company",
    criteria: [
      { field: "industry", value: "saas", stated: true, confidence: 1 },
      { field: "location", value: "Canada", stated: true, confidence: 1 },
    ],
    missing: [],
    signal_required: false,
    signal_types: [],
    signal_recency: null,
    status: "ready_to_search",
    raw_query: "saas companies in Canada",
  };

  const cap = (id: SourceCapability["id"], costTier: SourceCapability["costTier"]): SourceCapability => ({
    id,
    label: id,
    entityTypes: ["company"],
    claims: [],
    discovery: true,
    identityResolution: true,
    locationSupport: true,
    temporalSupport: false,
    costTier,
    live: true,
  });

  const PROVIDERS: readonly SourceCapability[] = [
    cap("searxng", 3),
    cap("direct-http", 2),
    cap("company-registry", 0),
  ];

  it("without yield data the tier order stands", () => {
    const plan = buildSourcePlan(SPEC, undefined, { providers: PROVIDERS });
    expect(plan.steps.map((s) => s.providerId)).toEqual([
      "company-registry",
      "direct-http",
      "searxng",
    ]);
  });

  it("yieldOrder moves the high-yield source up; no-data keeps position", () => {
    const plan = buildSourcePlan(SPEC, undefined, {
      providers: PROVIDERS,
      // company-registry has no smoothed data → keeps its slot.
      yieldOrder: { searxng: 0.9, "direct-http": 0.05 },
    });
    expect(plan.steps.map((s) => s.providerId)).toEqual([
      "company-registry",
      "searxng",
      "direct-http",
    ]);
  });

  it("empty yieldOrder map is a no-op", () => {
    const plan = buildSourcePlan(SPEC, undefined, { providers: PROVIDERS, yieldOrder: {} });
    expect(plan.steps.map((s) => s.providerId)).toEqual([
      "company-registry",
      "direct-http",
      "searxng",
    ]);
  });
});
