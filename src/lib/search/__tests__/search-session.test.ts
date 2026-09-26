import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { advanceSession, getSessionSpec, mergeSpecs } from "../search-session.server";

describe("session merge (Phase 5)", () => {
  it("Toronto follow-up updates location only", () => {
    const cid = "t1";
    const first = advanceSession(cid, extractSearchSpec("I need SaaS founders in New York"));
    expect(first.spec.status).toBe("ready_to_search");
    const second = advanceSession(cid, extractSearchSpec("Actually make it Toronto"));
    expect(second.switched).toBe(false);
    expect(second.spec.criteria).toContainEqual({ field: "location", value: "Toronto", stated: true, confidence: 1 });
    expect(second.spec.criteria).toContainEqual({ field: "role", value: "founder", stated: true, confidence: 1 });
    expect(second.spec.criteria).toContainEqual({ field: "industry", value: "SaaS", stated: true, confidence: 1 });
    expect(getSessionSpec(cid)?.status).toBe("ready_to_search");
  });

  it("businesses then founders switches entity with fresh criteria", () => {
    const cid = "t2";
    advanceSession(cid, extractSearchSpec("bro i need businesses"));
    const s = advanceSession(cid, extractSearchSpec("yo need founders i can reach out to rn"));
    expect(s.switched).toBe(true);
    expect(s.spec.entity).toBe("person");
  });

  it("stated facts survive inference-free merges", () => {
    const prev = extractSearchSpec("I need SaaS founders in New York");
    const merged = mergeSpecs(prev, extractSearchSpec("plumbers"));
    // "plumbers" has no entity noun overlap... business noun wins → switch
    expect(merged.entity).toBe("business");
  });
});
