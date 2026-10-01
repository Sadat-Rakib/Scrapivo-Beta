import type { SearchSpec } from "./search-spec";
import { entityQuestionsForSpec, type ClarifyQuestion, type ClarifyQuestionId } from "./clarifier";

const option = (id: string, label: string, hint: string) => ({ id, label, hint });
const purposeQuestion = (): ClarifyQuestion => ({
  id: "entity_purpose",
  question: "What are you trying to do with these results?",
  options: [
    option("research", "Research", "Browse and learn"),
    option("prospecting", "Find prospects", "Sell a product or service"),
    option("recruiting", "Recruit", "Find people to hire"),
    option("partnership", "Find partners", "Explore partnerships"),
  ],
  allowOther: true,
});

/** One decision for the active SPEC path. Optional refinements never block it.
 *
 * `force` (Skip / "Search with defaults") always means PROCEED: no question
 * blocks execution, ever. Criteria left unresolved stay on the spec and fail
 * qualification honestly — an honest zero, not another round of the same
 * question. */
export function decideSpecClarification(spec: SearchSpec, force = false): ClarifyQuestion | null {
  if (force) return null;

  const unresolved = spec.unresolved?.[0];
  if (unresolved) {
    const kinds: Record<string, { id: ClarifyQuestionId; question: string }> = {
      salary_min: { id: "entity_salary", question: "What salary amount do you mean?" },
      employee_count: { id: "entity_size", question: "What company size do you mean?" },
      revenue: { id: "entity_revenue", question: "What revenue amount do you mean?" },
    };
    const kind = kinds[unresolved.field] ?? {
      id: "entity_scope" as ClarifyQuestionId,
      question: `What value do you mean by “${unresolved.raw}”?`,
    };
    return { id: kind.id, question: kind.question, options: [], allowOther: true };
  }

  const frameQuestion = spec.understanding?.clarification;
  if (frameQuestion?.needed && frameQuestion.question) {
    const field = frameQuestion.fields[0];
    if (field === "target.entity_type") {
      return entityQuestionsForSpec({ ...spec, missing: ["entity"] })[0] ?? null;
    }
    if (field === "user_context.objective") {
      return purposeQuestion();
    } else if (field === "target.scope") {
      const hasLocation = spec.criteria.some((c) => c.field === "location") || !!spec.locations?.length;
      const missing = hasLocation
        ? spec.entity === "business" ? "category" : spec.entity === "person" ? "role" : "industry"
        : "location";
      return entityQuestionsForSpec({ ...spec, missing: [missing] })[0] ?? null;
    } else {
      return {
        id: "entity_relation",
        question: frameQuestion.question,
        options: [],
        allowOther: true,
      };
    }
  }

  if (!force && spec.purpose == null && !spec.understanding?.user_context.objective?.value &&
      ["business", "company", "person", "investor"].includes(spec.entity)) {
    return purposeQuestion();
  }

  if (!spec.understanding && spec.missing.length > 0) {
    return entityQuestionsForSpec({ ...spec, missing: [spec.missing[0]!] })[0] ?? null;
  }
  return null;
}
