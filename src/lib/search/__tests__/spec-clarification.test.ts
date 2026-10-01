import { describe, expect, it } from "vitest";
import { buildSpec, type SearchSpec } from "../search-spec";
import { decideSpecClarification } from "../spec-clarification";
import { extractFrameDeterministic } from "../../understanding/fallback";
import { applyClarificationToFrame, frameToSearchSpec } from "../../understanding/to-search-spec";

const plumbers = (): SearchSpec => ({
  ...buildSpec({
    entity: "business",
    criteria: [
      { field: "category", value: "plumbers", stated: true, confidence: 1 },
      { field: "location", value: "Austin", stated: true, confidence: 1 },
    ],
    raw_query: "find plumbers in Austin",
  }),
  purpose: null,
});

describe("SPEC clarification policy", () => {
  it("asks purpose for a complete target and location with no stated goal", () => {
    expect(decideSpecClarification(plumbers())?.id).toBe("entity_purpose");
  });

  it("does not re-ask an explicit goal", () => {
    expect(decideSpecClarification({ ...plumbers(), purpose: "research" })).toBeNull();
    expect(decideSpecClarification({ ...plumbers(), purpose: "prospecting" })).toBeNull();
  });

  it("asks an explicit unresolved amount before purpose, even with force", () => {
    const spec = {
      ...plumbers(),
      unresolved: [{ field: "salary_min", raw: "this much" }],
    } satisfies SearchSpec;
    expect(decideSpecClarification(spec)?.id).toBe("entity_salary");
    expect(decideSpecClarification(spec, true)?.id).toBe("entity_salary");
  });

  it("asks only the first execution-critical field after purpose is known", () => {
    const spec = buildSpec({ entity: "business", criteria: [], raw_query: "local businesses" });
    expect(decideSpecClarification({ ...spec, purpose: "research" })?.id).toBe("entity_location");
  });

  it("records a category follow-up in the frame so the same question does not repeat", () => {
    const frame = extractFrameDeterministic("find companies in Nairobi");
    const answered = applyClarificationToFrame(frame, { category: "skincare brands", purpose: "research" });
    const spec = frameToSearchSpec(answered);
    expect(spec.criteria).toContainEqual(expect.objectContaining({ field: "industry", value: "skincare brands" }));
    expect(decideSpecClarification(spec)).toBeNull();
  });

  it("asks for the target kind when place is already known", () => {
    const spec = frameToSearchSpec(extractFrameDeterministic("find companies in Nairobi"));
    expect(decideSpecClarification(spec)?.id).toBe("entity_industry");
  });
});
