import { describe, expect, it, vi } from "vitest";

const { aiComplete } = vi.hoisted(() => ({
  aiComplete: vi.fn(() => {
    throw new Error("AI_CALL_FORBIDDEN_DURING_DETERMINISTIC_RESEARCH");
  }),
}));

vi.mock("@/lib/ai/router.server", () => ({
  aiComplete,
  aiCompleteDetailed: aiComplete,
}));

import { buildSpec } from "@/lib/search/search-spec";
import type { SpecEntity } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { ResearchOrchestrator, assertStoredPathUsesNoAI } from "./orchestrator.server";
import { retrievalPlanFromInputs } from "./plan";

function fixture(entity: Exclude<SpecEntity, "job" | "unknown">): SpecRow {
  return {
    kind: entity,
    key: `${entity}:fixture`,
    entity_id: `${entity}:fixture`,
    entity_resolved: true,
    page_type: entity === "person" ? "person_page" : "entity_page",
    title: entity === "person" ? "Avery Founder — Founder @ Acme" : `${entity} fixture`,
    detail: entity === "business" ? "Toronto · Open now · business hours" : "Canada · verified",
    location: entity === "business" ? "Toronto" : "Canada",
    country: "CA",
    category: entity === "business" ? "HVAC" : entity === "company" ? "AI" : null,
    sector: entity === "investor" ? "SaaS" : null,
    stage: entity === "investor" ? "seed" : null,
    check: entity === "investor" ? "$10k-$100k" : null,
    url: "https://fixture.example.com",
    email: "public@fixture.example.com",
    complete: true,
  };
}

describe("zero-AI deterministic research certification", () => {
  it.each(["person", "company", "business", "investor"] as const)("runs %s retrieval with AI router set to throw", async (entity) => {
    const searchSpec = buildSpec({
      entity,
      raw_query: `find ${entity} fixture`,
      criteria: [
        ...(entity === "person" ? [{ field: "role", value: "founder", stated: true, confidence: 1 }] : []),
        ...(entity === "business" ? [
          { field: "category", value: "HVAC", stated: true, confidence: 1 },
          { field: "location", value: "Toronto", stated: true, confidence: 1 },
        ] : []),
        ...(entity === "investor" ? [
          { field: "investor_stage", value: "seed", stated: true, confidence: 1 },
          { field: "investor_sector", value: "SaaS", stated: true, confidence: 1 },
          { field: "investor_check", value: "$10k-$100k", stated: true, confidence: 1 },
          { field: "location", value: "Canada", stated: true, confidence: 1 },
        ] : []),
      ],
    });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [fixture(entity)], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: searchSpec }) });
    expect(result.candidates).toHaveLength(1);
    expect(aiComplete).not.toHaveBeenCalled();
    assertStoredPathUsesNoAI(result.metrics);
  });
});
