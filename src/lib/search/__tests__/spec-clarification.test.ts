import { describe, expect, it } from "vitest";
import { decideSpecClarification } from "../spec-clarification";
import { extractFrameDeterministic } from "../../understanding/fallback";
import { applyClarificationToFrame, frameToSearchSpec } from "../../understanding/to-search-spec";
import { validateFrame } from "../../understanding/validate";

/** Complete request, no stated goal — the Stage-1 policy must NOT ask purpose. */
const plumbersWithFrame = () => {
  const frame = validateFrame(extractFrameDeterministic("find plumbers in Austin")).frame;
  return { ...frameToSearchSpec(frame), purpose: null };
};

describe("SPEC clarification policy (Stage 1: resolveStage is the only authority)", () => {
  it("does NOT ask purpose for a complete target and location with no stated goal", () => {
    // Purpose is inferred, never a default blocker: "find plumbers in Austin"
    // searches immediately.
    expect(decideSpecClarification(plumbersWithFrame())).toBeNull();
  });

  it("does not re-ask an explicit goal", () => {
    expect(decideSpecClarification({ ...plumbersWithFrame(), purpose: "research" })).toBeNull();
    expect(decideSpecClarification({ ...plumbersWithFrame(), purpose: "prospecting" })).toBeNull();
  });

  it("asks an explicit unresolved amount before anything else, even with force", () => {
    const frame = validateFrame(extractFrameDeterministic("find plumbers in Austin")).frame;
    frame.unresolved = [{ field: "salary_min", raw: "this much" }];
    const spec = frameToSearchSpec(frame);
    expect(decideSpecClarification(spec)?.id).toBe("entity_salary");
    expect(decideSpecClarification(spec, true)?.id).toBe("entity_salary");
  });

  it("asks only the first execution-critical field of a bare ask", () => {
    // "find businesses" understands the WHAT but names no place and no kind:
    // the one honest question is where (or what kind) to look.
    const frame = validateFrame(extractFrameDeterministic("find businesses")).frame;
    const spec = frameToSearchSpec(frame);
    expect(decideSpecClarification(spec)?.id).toBe("entity_location");
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

  it("force skips optional questions but an unknown entity still asks", () => {
    const bare = frameToSearchSpec(extractFrameDeterministic("find businesses"));
    expect(decideSpecClarification(bare)?.id).toBeTruthy();
    // A known entity + force ("Search with defaults") proceeds without asking.
    expect(decideSpecClarification(bare, true)).toBeNull();
    expect(decideSpecClarification(plumbersWithFrame(), true)).toBeNull();
    // An UNKNOWN entity still asks under force — nothing runnable can be
    // built from it.
    const unknown = frameToSearchSpec(extractFrameDeterministic("find businesses"));
    unknown.understanding!.target.entity_type = { value: "unknown", raw: "", confidence: 0.1 };
    expect(decideSpecClarification(unknown, true)?.id).toBeTruthy();
  });
});
