// Resolver tests (Workstream 3) — pure, no I/O.
import { describe, expect, it } from "vitest";
import {
  resolveContext,
  applySpecOverrides,
  type ContextLayer,
  type SpecLike,
} from "../context-resolver";

describe("resolveContext precedence", () => {
  it("explicit beats project beats global per scalar field", () => {
    const explicit: ContextLayer = { geography: "Berlin" };
    const project: ContextLayer = { geography: "Austin", industry: "dentistry" };
    const global: ContextLayer = { geography: "US", industry: "healthcare", icp: "clinics" };
    const { resolved, provenance } = resolveContext({ explicit, project, global });
    expect(resolved.geography).toBe("Berlin");
    expect(provenance.geography).toBe("explicit");
    expect(resolved.industry).toBe("dentistry");
    expect(provenance.industry).toBe("project");
    expect(resolved.icp).toBe("clinics");
    expect(provenance.icp).toBe("global");
  });

  it("absent fields stay absent — no invented defaults", () => {
    const { resolved, provenance } = resolveContext({
      project: { geography: "Austin" },
      global: { industry: "healthcare" },
    });
    expect(resolved).not.toHaveProperty("icp");
    expect(resolved).not.toHaveProperty("exclusions");
    expect(resolved).not.toHaveProperty("signals");
    expect(resolved).not.toHaveProperty("offer");
    expect(provenance).not.toHaveProperty("icp");
    expect(Object.keys(provenance).sort()).toEqual(["geography", "industry"]);
  });

  it("empty/whitespace values never shadow lower layers (never collapsed into false)", () => {
    // A project layer with "" must not "win" as an empty answer — unknown
    // stays unknown, the global value still resolves.
    const { resolved, provenance } = resolveContext({
      project: { geography: "  ", icp: null },
      global: { geography: "US", icp: "clinics" },
    });
    expect(resolved.geography).toBe("US");
    expect(provenance.geography).toBe("global");
    expect(resolved.icp).toBe("clinics");
    expect(provenance.icp).toBe("global");
  });

  it("contradicted lists are never merged into a false middle — first present layer wins whole", () => {
    const { resolved } = resolveContext({
      project: { exclusions: ["agencies"] },
      global: { exclusions: ["competitors"] },
    });
    expect(resolved.exclusions).toEqual(["agencies"]);
  });

  it("empty layers resolve to nothing at all", () => {
    const { resolved, provenance } = resolveContext({
      explicit: null,
      project: null,
      global: null,
    });
    expect(resolved).toEqual({});
    expect(provenance).toEqual({});
  });
});

describe("object fields (offer/messaging/custom)", () => {
  it("merges key-wise with project beating global, explicit beating both", () => {
    const { resolved, provenance } = resolveContext({
      explicit: { offer: { tone: "direct" } },
      project: { offer: { what_they_do: "dental", tone: "warm" } },
      global: { offer: { what_they_do: "generic clinic", name: "Mir" } },
    });
    expect(resolved.offer).toEqual({
      what_they_do: "dental", // project > global per key
      tone: "direct", // explicit per key
      name: "Mir", // global fills keys nobody else set
    });
    expect(provenance["offer.what_they_do"]).toBe("project");
    expect(provenance["offer.tone"]).toBe("explicit");
    expect(provenance["offer.name"]).toBe("global");
  });

  it("custom keys resolve individually across layers", () => {
    const { resolved } = resolveContext({
      project: { custom: { skills: ["react"] } },
      global: { custom: { skills: ["react", "node"], region: "EU" } },
    });
    expect(resolved.custom).toEqual({ skills: ["react"], region: "EU" });
  });
});

describe("applySpecOverrides", () => {
  const baseSpec = (): SpecLike => ({
    criteria: [
      { field: "location", value: "Austin", stated: true, confidence: 1 },
      { field: "role", value: "frontend dev", stated: false, confidence: 0.4 },
    ],
    signal_types: ["hiring"],
  });

  it("never overrides fields the explicit query already set (stated=true)", () => {
    const out = applySpecOverrides(baseSpec(), { geography: "Berlin", industry: "dental" });
    const loc = out.criteria.find((c) => c.field === "location");
    expect(loc?.value).toBe("Austin");
    expect(loc?.stated).toBe(true);
  });

  it("fills absent fields from resolved context as unstated hints", () => {
    const out = applySpecOverrides(baseSpec(), {
      geography: "Berlin",
      industry: "dental",
      icp: "clinics",
    });
    const ind = out.criteria.find((c) => c.field === "industry");
    expect(ind).toEqual({ field: "industry", value: "dental", stated: false, confidence: 0.5 });
    const icp = out.criteria.find((c) => c.field === "icp");
    expect(icp?.value).toBe("clinics");
    // location already present (stated) → no second entry, no override.
    expect(out.criteria.filter((c) => c.field === "location")).toHaveLength(1);
  });

  it("never duplicates an already-inferred (unstated) criteria entry", () => {
    const out = applySpecOverrides(baseSpec(), { geography: "Berlin" });
    expect(out.criteria.filter((c) => c.field === "location")).toHaveLength(1);
  });

  it("appends resolved signals without duplicating existing signal_types", () => {
    const out = applySpecOverrides(baseSpec(), { signals: ["hiring", "funding"] });
    expect(out.signal_types).toEqual(["hiring", "funding"]);
  });

  it("leaves spec untouched when context is empty", () => {
    const spec = baseSpec();
    const out = applySpecOverrides(spec, {});
    expect(out.criteria).toEqual(spec.criteria);
    expect(out.signal_types).toEqual(["hiring"]);
  });
});
