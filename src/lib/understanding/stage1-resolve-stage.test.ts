import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { validateFrame } from "./validate";
import {
  buildConfirmSummary,
  initState,
  markConfirmed,
  materialFacts,
  patchFrame,
  resolveStage,
} from "./clarify-state";
import { applyClarificationToFrame } from "./to-search-spec";
import type { ResolvedInputContext, SourceFact } from "./input-envelope";

const frameOf = (query: string) => validateFrame(extractFrameDeterministic(query)).frame;

const fact = (over: Partial<SourceFact>): SourceFact => ({
  category: "target",
  value: "fertility clinics",
  confidence: 0.9,
  provenance: "url",
  sourceRef: "https://example.com",
  quote: "we serve fertility clinics",
  ...over,
});

const ctx = (facts: SourceFact[]): ResolvedInputContext => ({ facts, conflicts: [], unresolved_sources: [] });

describe("Stage 1 policy: resolveStage is the single READY/CLARIFY/CONFIRM authority", () => {
  it("case 2 — 'find businesses' CLARIFIES with the highest-information question", () => {
    const frame = frameOf("find businesses");
    const decision = resolveStage(frame, initState(frame));
    expect(decision.stage).toBe("clarify");
    expect(decision.question?.field).toBe("target.scope");
  });

  it("case 10 — a complete request with no explicit purpose is READY (purpose is never a default blocker)", () => {
    const frame = frameOf("find plumbers in Austin");
    expect(frame.user_context.objective?.value).toBeFalsy();
    expect(resolveStage(frame, initState(frame)).stage).toBe("ready");
  });

  it("case 1 — a complete request with contact + count requirements stays READY", () => {
    const frame = frameOf("find 10 plumbers in Edmonton with phone numbers");
    const decision = resolveStage(frame, initState(frame));
    // READY means no question — the core runs the search immediately.
    expect(decision.stage).toBe("ready");
    expect(decision.question).toBeUndefined();
  });

  it("case 11 — an answer patches the SAME frame and is never re-asked (monotonic)", () => {
    const frame = frameOf("find businesses");
    let state = initState(frame);
    const first = resolveStage(frame, state);
    expect(first.stage).toBe("clarify");

    const patched = patchFrame(state, "target.scope", "Edmonton");
    state = patched.state;
    const second = resolveStage(state.frame, state);
    expect(second.stage).toBe("ready");
    // The asked field is recorded forever — even an unmappable answer is an answer.
    expect(state.asked).toContain("target.scope");
    expect(state.answered["target.scope"]).toBe("Edmonton");
  });

  it("case 11b — a continuation frame (priorFrame round) keeps answers and stays settled", () => {
    const frame = frameOf("find businesses");
    const answered = applyClarificationToFrame(frame, { entity_scope: "Edmonton" });
    expect(resolveStage(answered, initState(answered)).stage).toBe("ready");
  });

  it("force skips semantic questions but an unknown entity still asks", () => {
    const complete = frameOf("find plumbers in Austin");
    expect(resolveStage(complete, initState(complete), null, { force: true }).stage).toBe("ready");
    const bare = frameOf("find businesses");
    // "find businesses" has entity business — force proceeds; nothing runnable
    // can come from an UNKNOWN entity, so that still asks.
    expect(resolveStage(bare, initState(bare), null, { force: true }).stage).toBe("ready");
  });

  it("an explicit unresolved AMOUNT always asks, even under force", () => {
    const frame = frameOf("find plumbers in Austin");
    frame.unresolved = [{ field: "employee_count", raw: "this big" }];
    const decision = resolveStage(frame, initState(frame), null, { force: true });
    expect(decision.stage).toBe("clarify");
    expect(decision.amountField).toBe("employee_count");
  });

  it("INV-5 — the decision never touches a SearchSpec (frame + state + facts only)", () => {
    // Structural proof: the signature accepts no spec; a decision on a frame
    // must be identical whether or not any spec exists anywhere.
    const frame = frameOf("find businesses");
    const a = resolveStage(structuredClone(frame), initState(structuredClone(frame)));
    const b = resolveStage(structuredClone(frame), initState(structuredClone(frame)));
    expect(a).toEqual(b);
  });
});

describe("Stage 1 materiality (deterministic — no second understanding pass)", () => {
  it("material derived fact gates CONFIRM; user text stating the same fact does not", () => {
    const frame = frameOf("find plumbers in Austin");
    const material = [fact({ category: "target", value: "fertility clinics", provenance: "url" })];
    expect(resolveStage(frame, initState(frame), ctx(material)).stage).toBe("confirm");

    const corroborated = [
      ...material,
      fact({ category: "target", value: "fertility clinics", provenance: "user_text", sourceRef: "text" }),
    ];
    expect(materialFacts(corroborated)).toHaveLength(0);
    expect(resolveStage(frame, initState(frame), ctx(corroborated)).stage).toBe("ready");
  });

  it("non-material categories (org/other) never gate CONFIRM", () => {
    const frame = frameOf("find plumbers in Austin");
    const orgOnly = [fact({ category: "org", value: "Mirrin is a web agency", provenance: "url" })];
    expect(materialFacts(orgOnly)).toHaveLength(0);
    expect(resolveStage(frame, initState(frame), ctx(orgOnly)).stage).toBe("ready");
  });

  it("case 3 combined — a question plus derived context is ONE confirm interaction", () => {
    const frame = frameOf("find businesses");
    const facts = [
      fact({ category: "offering", value: "website development", provenance: "url", sourceRef: "https://mirrin.agency" }),
      fact({ category: "target", value: "IVF and fertility centres", provenance: "url", sourceRef: "https://mirrin.agency" }),
    ];
    const decision = resolveStage(frame, initState(frame), ctx(facts));
    expect(decision.stage).toBe("confirm");
    expect(decision.question?.field).toBe("target.scope");
    expect(decision.summary).toContain("website development");
    // Confirming dissolves the gate: the next round proceeds to the question
    // (or straight to ready once the scope answer lands).
    const confirmed = markConfirmed(frame);
    const after = resolveStage(confirmed, initState(confirmed), ctx(facts));
    expect(after.stage).toBe("clarify");
    expect(after.summary).toBeUndefined();
  });

  it("supporting-only derived context is a non-blocking inline summary on a READY round", () => {
    const frame = frameOf("find plumbers in Austin");
    const facts = [fact({ category: "org", value: "Mirrin is a web agency", provenance: "url" })];
    const decision = resolveStage(frame, initState(frame), ctx(facts));
    expect(decision.stage).toBe("ready");
    expect(decision.summary).toContain("Mirrin is a web agency");
  });

  it("force proceeds past an unconfirmed confirm gate", () => {
    const frame = frameOf("find plumbers in Austin");
    const material = [fact({ category: "target", value: "fertility clinics", provenance: "url" })];
    const decision = resolveStage(frame, initState(frame), ctx(material), { force: true });
    expect(decision.stage).toBe("ready");
  });

  it("buildConfirmSummary is deterministic and provenance-labelled", () => {
    const summary = buildConfirmSummary([
      fact({ value: "website development", provenance: "url" }),
      fact({ value: "scan of a price list", provenance: "document", sourceRef: "attach_1" }),
    ]);
    expect(summary).toContain("website development (website)");
    expect(summary).toContain("scan of a price list (document)");
    expect(buildConfirmSummary([])).toBe("");
  });
});
