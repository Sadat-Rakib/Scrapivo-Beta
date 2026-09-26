/**
 * Mode gate (Phase 1.3): browsing-vs-selling is asked BEFORE retrieval for
 * directory hunts (business/company/person) — never after results, and the
 * offer question only ever follows a selling answer.
 *
 * Pure + deterministic (understanding-adjacent, no AI, no I/O):
 *  - detectModeFromQuery: explicit selling / browsing signals in raw text.
 *  - interpretModeAnswer: panel option ids ('looking'/'selling') or free text.
 * Question objects themselves live in clarifier.ts (single owner for copy).
 */

export type SearchMode = "looking" | "selling";

const SELLING_RE = /\b(sell|selling|sells|sold|pitch(?:ing|es)?|clients?|customers?|prospects?)\b/i;
const SELLING_SELF_RE =
  /\b(for my|my (agency|studio|firm|business|service|services|clients|customers)|i (run|own|have|started) (a|an|my)|freelancer|agency owner)\b/i;
const LOOKING_RE =
  /\b(just looking|brows(?:e|ing)|window.?shopping|i need|i want|need some|need\b|want\b|find me|looking for|help me find|show me)\b/i;

/** Explicit signals only. Bare queries ("dentists in Pune") → null → ASK.
 *  A bare need/want verb states browsing intent ("need founders" proceeds);
 *  seller markers always win (checked first in detectModeFromQuery). */
export function detectModeFromQuery(query: string): SearchMode | null {
  const q = (query ?? "").trim();
  if (!q) return null;
  // Selling first: "companies looking for website developers" contains a
  // looking-phrase but the author is the seller — explicit seller markers win.
  if (SELLING_RE.test(q) || SELLING_SELF_RE.test(q)) return "selling";
  if (LOOKING_RE.test(q)) return "looking";
  return null;
}

/**
 * Panel answers: option ids pass through; free text is interpreted.
 * Non-empty unrecognized text after the mode question names an offering
 * ("websites") → selling with the text preserved as the offer.
 */
export function interpretModeAnswer(value: string): { mode: SearchMode; offer?: string } {
  const v = (value ?? "").trim();
  const low = v.toLowerCase();
  if (low === "looking" || low === "hiring") return { mode: "looking" };
  if (low === "selling") return { mode: "selling" };
  const detected = detectModeFromQuery(v);
  if (detected === "looking") return { mode: "looking" };
  if (detected === "selling") {
    // Genuine seller phrasing in the answer ("I sell websites") — the offer
    // itself arrives with the next question; don't presume it here.
    return { mode: "selling" };
  }
  if (v) return { mode: "selling", offer: v };
  return { mode: "looking" };
}

export function isDirectoryEntity(entity: string): boolean {
  return entity === "business" || entity === "company" || entity === "person";
}
