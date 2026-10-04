import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { validateFrame } from "./validate";
import { applyClarificationToFrame, frameToSearchSpec } from "./to-search-spec";
import { decideSpecClarification } from "../search/spec-clarification";

/** A provider frame that kept the relation type but dropped its object. */
function providerFrameWithoutObject(query: string) {
  const frame = structuredClone(validateFrame(extractFrameDeterministic(query)).frame);
  frame.meta.extractor = "llm";
  frame.relation = { ...frame.relation, object: null, direction: { value: "subject_to_object", raw: null, confidence: 0.95 } };
  return applyClarificationToFrame(frame, {});
}

describe("provider frame repairs", () => {
  it("recovers a dropped has_asset object so the website requirement reaches execution", () => {
    const frame = providerFrameWithoutObject("Restaurants in Calgary, Alberta with official websites");
    expect(frame.clarification.reason).toBe("missing_relation_object");
    const spec = frameToSearchSpec(frame);
    expect(spec.understanding?.relation.object?.value).toBe("website");
    expect(spec.criteria).toContainEqual(expect.objectContaining({ field: "website", value: "true" }));
    expect(spec.understanding?.meta.notes.join(" ")).toMatch(/recovered has_asset object/);
    // No relation question remains, and purpose is never a default blocker:
    // the repaired frame is complete and searches immediately.
    expect(decideSpecClarification(spec, false)).toBeNull();
    expect(decideSpecClarification(spec, true)).toBeNull();
  });

  it("reads 'with recent hiring evidence' as a recent hiring signal for any role, not a role named 'evidence'", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS founders with recent hiring evidence and public contact details")).frame, {}));
    expect(spec.understanding?.relation.type.value).toBe("hiring");
    expect(spec.understanding?.relation.object ?? null).toBeNull();
    expect(spec.criteria.some((c) => c.field === "requested_role")).toBe(false);
    expect(spec.signal_required).toBe(true);
    expect(spec.understanding?.temporal?.relation).toBe("recent");
    // A real requested role is untouched.
    const role = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS startups hiring sales engineers")).frame, {}));
    expect(role.criteria.find((c) => c.field === "requested_role")?.value).toMatch(/sales engineer/i);
  });

  it("treats requested contact output read as an object-less has_asset relation as output fields", () => {
    const frame = providerFrameWithoutObject("B2B SaaS founders with public contact details");
    frame.relation = { type: { value: "has_asset", raw: "public contact details", confidence: 0.9 }, direction: { value: "subject_to_object", raw: null, confidence: 0.9 }, label: null, object: null };
    const spec = frameToSearchSpec(applyClarificationToFrame(frame, {}));
    expect(spec.understanding?.relation.type.value).toBe("none");
    expect(spec.understanding?.meta.notes.join(" ")).toMatch(/requested contact output/);
    expect(decideSpecClarification(spec, true)).toBeNull();
    // A real asset relation keeps its object.
    const site = providerFrameWithoutObject("Restaurants in Calgary, Alberta with official websites");
    expect(frameToSearchSpec(site).understanding?.relation.type.value).toBe("has_asset");
  });

  it("recovers target descriptors a provider frame dropped entirely, splitting an industry modifier out of the role", () => {
    const frame = providerFrameWithoutObject("B2B SaaS founders with public contact details");
    frame.target = { ...frame.target, role: null, industry: null, category: null, job_title: null, business_type: null, entity_subtype: null };
    const spec = frameToSearchSpec(applyClarificationToFrame(frame, {}));
    expect(spec.criteria.find((c) => c.field === "role")?.value).toBe("founder");
    expect(spec.criteria.find((c) => c.field === "industry")?.value).toMatch(/^saas$/i);
    expect(spec.understanding?.meta.notes.join(" ")).toMatch(/recovered target descriptors/);
    expect(decideSpecClarification(spec, true)).toBeNull();
  });

  it("keeps a provider's own target when it has one", () => {
    const frame = providerFrameWithoutObject("B2B SaaS founders with public contact details");
    frame.target = { ...frame.target, role: { value: "founder", raw: "founders", normalized: null, confidence: 0.9 }, industry: { value: "Fintech", raw: "x", normalized: null, confidence: 0.9 } };
    const spec = frameToSearchSpec(applyClarificationToFrame(frame, {}));
    expect(spec.criteria.find((c) => c.field === "industry")?.value).toBe("Fintech");
  });

  it("does not invent an object the deterministic parse did not observe", () => {
    const frame = providerFrameWithoutObject("companies that need");
    const spec = frameToSearchSpec(frame);
    expect(spec.understanding?.relation.object ?? null).toBeNull();
  });
});
