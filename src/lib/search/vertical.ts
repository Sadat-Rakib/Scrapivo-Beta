/**
 * Single source of truth for which vertical a raw query targets.
 *
 * Combines the clarifier's regex detectors (which include the deterministic
 * tokenizer fallback for investor hunts) with the tokenizer category so the
 * client narration and the server routing can never disagree:
 * detectSearchVertical runs the same isFindInvestorHunt/isLocalBusinessHunt
 * the search pipeline uses, and the tokenizer category covers the job and
 * business verticals the regex detectors don't express.
 */
import { detectSearchVertical } from "./clarifier";
import { isDirectoryQuery } from "./query-classifier";
import { tokenizeInput } from "./tokenize-input";

export type SearchVertical = "investors" | "local" | "jobs" | "general";

export function resolveSearchVertical(raw: string): SearchVertical {
  const detected = detectSearchVertical(raw);
  if (detected === "investors") return "investors";
  if (detected === "local") return "local";
  // Directory intent ("find me businesses in Pune without websites") IS the
  // local-business branch even without a trade word or the word "local" —
  // entity noun + no demand verb = catalogue of businesses in a place.
  // This is what makes EVERY city/country query work, not just phrasings the
  // hunt regex happens to list.
  if (isDirectoryQuery(raw)) return "local";
  const category = tokenizeInput(raw).category;
  if (category === "job") return "jobs";
  if (category === "business") return "local";
  return "general";
}
