import type { Constraint, Target, UnderstandingFrame } from "./frame";

const words = (value: string): string[] => value.toLowerCase().replace(/cybersecurity/g, "cyber security").match(/[a-z]+/g) ?? [];
const contrast = /\b(?:do\s+not|don['’]?t|dont)\s+mix\s+([^,;.!?]{0,80}?)\b(consultants?|consultancies|agencies|service\s+providers?)\s+with\s+(?:(?:actual|real|genuine)\s+)?product\s+companies\b(?:\s+unless\s+[^,;.!?]*)?/gi;

/** Recover a contrast without turning its product-fit exception into a ban. */
export function repairServiceBoundaries(frame: UnderstandingFrame): boolean {
  let changed = false;
  for (const match of frame.input.raw.matchAll(contrast)) {
    const qualifier = words(match[1]).filter(word => !["the", "any", "generic"].includes(word));
    const service = /agenc/i.test(match[2]) ? "agency" : /provider/i.test(match[2]) ? "service_provider" : "consultant";
    const servicePattern = service === "agency" ? "agenc(?:y|ies)" : service === "service_provider" ? "service[_ ]providers?" : "consultants?|consulting|consultanc(?:y|ies)";
    const matches = (target: Target) => {
      const targetWords = words([target.category, target.industry, target.business_type, target.niche]
        .map(value => value?.normalized ?? value?.value ?? "").join(" "));
      return !qualifier.length || qualifier.every(word => targetWords.includes(word));
    };
    const goals = frame.compound.subgoals;
    const destinations: Array<{ target: Target; constraints: Constraint[] }> = goals.length ? goals.filter(goal => matches(goal.target)) : matches(frame.target) ? [frame] : [];
    if (!destinations.length) continue;
    // An independent explicit ban remains hard. A provider's paraphrase of
    // this contrast does not create one merely by saying "exclude" in raw.
    const rest = frame.input.raw.replace(match[0], "");
    const hardBan = new RegExp(`\\b(?:not|no|exclude|excluding|without)\\s+(?:[a-z-]+\\s+){0,3}(?:${servicePattern})\\b`, "i").test(rest);
    if (!hardBan) {
      for (const holder of [frame, ...goals]) {
        const kept = holder.constraints.filter(item => !(item.field === "category" &&
          (item.negated || item.operator === "neq") &&
          new RegExp(`\\b(?:${servicePattern})\\b`, "i").test(String(item.value))));
        if (kept.length !== holder.constraints.length) { holder.constraints = kept; changed = true; }
      }
    }
    for (const holder of [frame, ...goals]) {
      if (destinations.includes(holder)) continue;
      const kept = holder.constraints.filter(item => !(item.field === "service_only" && item.value === service));
      if (kept.length !== holder.constraints.length) { holder.constraints = kept; changed = true; }
    }
    for (const destination of destinations) {
      if (destination.constraints.some(item => item.field === "service_only" && item.value === service)) continue;
      const constraint: Constraint = { field: "service_only", operator: "neq", value: service,
        unit: null, negated: true, raw: match[0], confidence: .9 };
      destination.constraints.push(constraint);
      changed = true;
    }
  }
  return changed;
}
