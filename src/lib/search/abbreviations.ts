/**
 * Chat + domain abbreviation expansion for search input.
 *
 * Applied as a pre-pass BEFORE the tokenizer and the slot-extractor LLM:
 * explicit typed words become given facts the LLM must not override.
 *
 * Safety rule: urgency slang (rn, asap, ...) sets an urgency flag ONLY.
 * It must never become a location / sector / matching token.
 */

export const ABBREVIATIONS: Record<string, string> = {
  // chat slang -> plain words
  u: "you",
  ur: "your",
  ure: "your",
  pls: "please",
  plz: "please",
  thx: "thanks",
  rn: "right now",
  asap: "as soon as possible",
  fyi: "",
  tbh: "",
  idk: "",
  nvm: "",
  btw: "",
  imo: "",
  // domain shorts
  vc: "venture capital",
  vcs: "venture capital",
  ceo: "ceo",
  cto: "cto",
  hq: "headquarters",
  ai: "ai",
  ml: "machine learning",
  b2b: "b2b",
  b2c: "b2c",
  saas: "saas",
  usa: "united states",
  uae: "united arab emirates",
  // stage variants -> canonical
  preseed: "pre-seed",
  "pre seed": "pre-seed",
  seedstage: "seed",
  seriesa: "series a",
  seriesb: "series b",
  seriesc: "series c",
};

/** Tokens that signal urgency (freshness boost), never geography/matching. */
export const URGENCY_TOKENS = new Set([
  "right",
  "now",
  "soon",
  "urgently",
  "urgent",
  "immediately",
  "possible",
  "asap",
  "today",
]);

/** Filler with zero retrieval meaning — stripped before matching. */
export const FILLER_TOKENS = new Set([
  "please",
  "thanks",
  "hello",
  "hi",
  "hey",
  "yo",
  "gimme",
  "give",
  "want",
  "need",
  "needs",
  "needing",
  "looking",
  "look",
  "find",
  "finding",
  "get",
  "getting",
  "search",
  "searching",
  "fetch",
  "show",
  "me",
  "my",
  "i",
  "am",
  "for",
  "a",
  "an",
  "the",
  "some",
  "any",
  "that",
  "which",
  "who",
  "with",
  "in",
  "on",
  "at",
  "of",
  "and",
  "or",
  "to",
  "from",
  "by",
  "as",
]);

/** Words that must never be treated as location/sector match tokens. */
export const NEVER_GEO_TOKENS = new Set(["right", "now", "soon", "today", "here", "there"]);

const WORD_RE = /[a-z0-9][a-z0-9+\-.]*/g;

/**
 * Lowercase + expand abbreviations. Returns expanded string.
 *
 * Bare "us" is intentionally NOT expanded (pronoun "help us" would become a
 * fake geo). Uppercase US/UK/EU in the raw input are treated as geo codes.
 */
export function expandAbbreviations(raw: string): string {
  const src = raw || "";
  const geoHints: string[] = [];
  if (/\bUS\b/.test(src)) geoHints.push("united states");
  if (/\bUK\b/.test(src)) geoHints.push("united kingdom");
  if (/\bEU\b/.test(src)) geoHints.push("europe");
  const lower = src.toLowerCase();
  // multi-word keys first (e.g. "pre seed")
  let out = lower;
  for (const [k, v] of Object.entries(ABBREVIATIONS)) {
    if (!k.includes(" ")) continue;
    out = out.split(k).join(v);
  }
  const words = out.match(WORD_RE) ?? [];
  const expanded = words.map((w) => ABBREVIATIONS[w] ?? w).join(" ");
  return geoHints.length ? `${expanded} ${geoHints.join(" ")}` : expanded;
}

/** True when the input carries urgency slang (rn, asap, ...). */
export function detectUrgency(raw: string): boolean {
  const words = expandAbbreviations(raw).split(" ");
  return words.some((w) => URGENCY_TOKENS.has(w));
}
