/**
 * Deterministic relevance + grounded explanations (Phases 7–9).
 *
 * rankFacts: deterministic score from matched criteria (no LLM).
 * buildWhyRelevant: cites ONLY supplied facts + verified signals.
 * Thin evidence → "" (caller renders nothing, never fabricates).
 * Signal discovery itself is Phase 7 ongoing — this module consumes
 * verified signals; candidate/unverified signals never reach it.
 */
import type { LeadSignal, RelevanceResult } from "./types";

export interface RankInput {
  matchedCriteria: string[];
  qualityScore?: number | null;
  /** Verified signals only. */
  signals?: LeadSignal[];
  signalRequired?: boolean;
}

export function rankRelevance(input: RankInput): number {
  let score = input.matchedCriteria.length * 20;
  if (input.qualityScore != null) score += Math.min(input.qualityScore / 5, 20);
  for (const s of input.signals ?? []) {
    if (s.state !== "verified") continue;
    score += 10 + Math.round((s.confidence ?? 0) * 10);
    if ((s.recency_days ?? 999) <= 7) score += 5;
  }
  if (input.signalRequired && !(input.signals ?? []).some((s) => s.state === "verified")) {
    score = Math.min(score, 30); // no verified signal → cap, never fake it
  }
  return Math.max(0, Math.round(score));
}

export function buildWhyRelevant(args: {
  leadLabel: string;
  matchedCriteria: string[];
  signals?: LeadSignal[];
}): string {
  const verified = (args.signals ?? []).filter((s) => s.state === "verified");
  if (!args.matchedCriteria.length && !verified.length) return "";
  const parts: string[] = [`${args.leadLabel} is relevant because ${args.matchedCriteria.join("; ")}.`];
  for (const s of verified.slice(0, 2)) {
    const when = s.published_at ? ` (posted ${s.published_at})` : "";
    parts.push(`Verified ${s.signal_type.replace(/_/g, " ")}${when}: ${s.text_summary} [${s.source_url}]`);
  }
  return parts.join(" ");
}

export function relevanceFor(
  leadLabel: string,
  input: RankInput,
): RelevanceResult {
  return {
    relevance_score: rankRelevance(input),
    matched_criteria: input.matchedCriteria,
    why_relevant: buildWhyRelevant({
      leadLabel,
      matchedCriteria: input.matchedCriteria,
      signals: input.signals,
    }),
  };
}
