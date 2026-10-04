import type { SearchSpec } from "./search-spec";
import { entityQuestionsForSpec, type ClarifyQuestion, type ClarifyQuestionId } from "./clarifier";
import { initState, resolveStage, type ClarificationState } from "@/lib/understanding/clarify-state";
import type { ResolvedInputContext } from "@/lib/understanding/input-envelope";
import type { UnderstandingFrame } from "@/lib/understanding/frame";

const AMOUNT_IDS: Record<string, ClarifyQuestionId> = {
  salary_min: "entity_salary",
  employee_count: "entity_size",
  revenue: "entity_revenue",
};

export type Stage1Outcome = {
  stage: "ready" | "clarify" | "confirm";
  question: ClarifyQuestion | null;
  /** Presentation summary of derived context (confirm card / inline). */
  summary: string | null;
  materialCount: number;
};

/**
 * Presentation adapter over the ONE Stage-1 authority
 * (clarify-state.resolveStage). No decision logic lives here: this only maps
 * the semantic decision onto the clarify UI contract (question ids, options).
 */
export function decideStage1(
  spec: SearchSpec,
  frame: UnderstandingFrame,
  state: ClarificationState,
  resolvedContext: ResolvedInputContext | null | undefined,
  force = false,
): Stage1Outcome {
  const decision = resolveStage(frame, state, resolvedContext, { force });
  let question: ClarifyQuestion | null = null;
  if (decision.question) {
    const field = decision.question.field;
    if (field === "target.entity_type") {
      question = entityQuestionsForSpec({ ...spec, missing: ["entity"] })[0] ?? null;
    } else if (field === "target.scope") {
      const hasLocation = spec.criteria.some((c) => c.field === "location") || !!spec.locations?.length;
      const missing = hasLocation
        ? spec.entity === "business"
          ? "category"
          : spec.entity === "person"
            ? "role"
            : "industry"
        : "location";
      question = entityQuestionsForSpec({ ...spec, missing: [missing] })[0] ?? null;
    } else if (field === "unresolved.amount" && decision.amountField) {
      const id = AMOUNT_IDS[decision.amountField] ?? "entity_scope";
      question = { id, question: decision.question.question, options: [], allowOther: true };
    } else {
      question = {
        id: "entity_relation",
        question: decision.question.question,
        options: [],
        allowOther: true,
      };
    }
  }
  return {
    stage: decision.stage,
    question,
    summary: decision.summary ?? null,
    materialCount: decision.material?.length ?? 0,
  };
}

/**
 * Compat shim over the adapter (removed at the P5 cutover). Frame-backed
 * specs delegate to resolveStage; spec-less specs have no Stage-1 decision
 * here — their optional handling lives in the runSpecSearchCore legacy path.
 */
export function decideSpecClarification(spec: SearchSpec, force = false): ClarifyQuestion | null {
  const frame = spec.understanding;
  if (!frame) return null;
  return decideStage1(spec, frame, initState(frame), null, force).question;
}
