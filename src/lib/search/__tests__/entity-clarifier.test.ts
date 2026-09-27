import { describe, expect, it } from "vitest";
import {
  applyClarifyAnswers,
  entityQuestionsForSpec,
} from "../clarifier";
import { extractSearchSpec } from "../search-spec-extract";

describe("entity-slot clarifier (Phase 4)", () => {
  it("bare businesses ask for location (mode comes from the pre-retrieval gate)", () => {
    const spec = extractSearchSpec("bro i need businesses plz asap");
    const qs = entityQuestionsForSpec(spec);
    expect(qs.map((q) => q.id)).toEqual(["entity_location"]);
    expect(qs[0].question).toMatch(/location/i);
  });

  it("SaaS founders NY → no questions", () => {
    const spec = extractSearchSpec("I need SaaS founders in New York");
    expect(entityQuestionsForSpec(spec)).toEqual([]);
  });

  it("founders (role known, location/industry optional) → no questions", () => {
    const spec = extractSearchSpec("yo need founders i can reach out to rn");
    expect(entityQuestionsForSpec(spec)).toEqual([]);
  });

  it("investors search immediately — slots are non-blocking (broad-then-enrich)", () => {
    const spec = extractSearchSpec("I need investors");
    expect(spec.entity).toBe("investor");
    // Investor slots are refinement-only: no investor query may be blocked by
    // a question before retrieval (broad-then-enrich contract).
    expect(spec.missing).toEqual([]);
    expect(spec.status).toBe("ready_to_search");
    expect(entityQuestionsForSpec(spec)).toEqual([]);
  });

  it("investor slot questions build only when explicitly missing", () => {
    const spec = extractSearchSpec("investors in SaaS in New York");
    expect(spec.missing).toEqual([]);
    const qs = entityQuestionsForSpec({
      entity: "investor",
      missing: ["investor_stage", "investor_check"],
      raw_query: "investors in SaaS in New York",
    });
    expect(qs.map((q) => q.id)).toEqual(["investor_stage", "investor_check"]);
  });

  it("bare companies ask industry + location only (mode comes from the pre-retrieval gate)", () => {
    const spec = extractSearchSpec("yo need companies rn");
    expect(spec.entity).toBe("company");
    expect(spec.missing).toEqual(["industry", "location"]);
    expect(spec.status).toBe("needs_clarification");
    const qs = entityQuestionsForSpec(spec);
    expect(qs.map((q) => q.id)).toEqual([
      "entity_industry",
      "entity_location",
    ]);
  });

  it("signal-carrying company intent proceeds without questions", () => {
    const spec = extractSearchSpec("companies looking for website developers");
    expect(spec.signal_required).toBe(true);
    expect(spec.missing).toEqual([]);
    expect(spec.status).toBe("ready_to_search");
  });
  it("answers fold into refinement", () => {
    const classified = { raw: "bro i need businesses", coreSkill: "", location: null } as never;
    const r = applyClarifyAnswers(classified, {
      entity_category: "plumbers",
      entity_location: "Austin",
    });
    expect(r.location).toBe("Austin");
    expect(r.entityCategory).toBe("plumbers");
    expect(r.summary).toMatch(/plumbers/i);
    expect(r.summary).toMatch(/Austin/);
  });
});
