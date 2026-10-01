import type { SearchSpec } from "../search/search-spec";
import { openValue, type UnderstandingFrame } from "./frame";

/** Recover only explicit purpose phrases that a provider omitted. */
export function repairExplicitPurpose(frame: UnderstandingFrame): UnderstandingFrame {
  if (frame.user_context.objective?.value) return frame;
  const raw = frame.input.raw;
  const purpose = /\b(?:research only|just researching|only researching|no outreach)\b/i.test(raw)
    ? "research"
    : /\b(?:i sell|we sell|selling to|looking for clients)\b/i.test(raw)
      ? "prospecting"
      : /\b(?:for partnership opportunities|looking for partners|find partners)\b/i.test(raw)
        ? "partnership"
        : /\b(?:to recruit|recruiting candidates|hire candidates)\b/i.test(raw)
          ? "recruiting"
          : null;
  if (purpose) {
    frame.user_context.objective = openValue(purpose, raw, purpose, 0.9);
    frame.meta.notes.push(`recovered explicit purpose: ${purpose}`);
  }
  return frame;
}

/** Purpose belongs to the canonical frame, independent of source availability. */
export function purposeFromFrame(frame: UnderstandingFrame): SearchSpec["purpose"] {
  const objective = frame.user_context.objective?.normalized ?? frame.user_context.objective?.value ?? "";
  if (/\b(?:research|browse|directory|no outreach)\b/i.test(objective)) return "research";
  if (/\b(?:sell|prospect(?:ing)?|outreach|customer|client|lead)\b/i.test(objective) ||
    frame.user_context.selling?.service?.value || frame.user_context.selling?.product?.value ||
    ["needs_service", "asking_for_help", "seeking_client"].includes(frame.relation.type.value)) return "prospecting";
  if (/\b(?:recruit|hire|talent)\b/i.test(objective)) return "recruiting";
  if (/\b(?:partner(?:ship|s)?|sourc(?:e|ing)|supplier)\b/i.test(objective)) return "partnership";
  if (frame.relation.type.value === "partnered_with") return "partnership";
  return null;
}
