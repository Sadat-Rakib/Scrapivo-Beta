/**
 * Stage-1 URL utilities — PURE, no I/O, no imports.
 * Safe to use from the understanding layer (isolation gate) and the resolver.
 */

/** A URL or bare domain the user typed. Match conservatively: a scheme, a
 *  www prefix, or a dotted domain with a known-shape TLD. */
const URL_TOKEN_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|ai|co|agency|dev|app|de|uk|ca|in|au|nl|se|no|fi|fr|es|it|pl|pt|ch|at|be|dk|ie|nz|za|us|edu|gov|info|biz|me|tv|gg|xyz|tech|studio|clinic|health|care|consulting|digital|website|shop|store|sites|site|online|cloud|link|page|blog|news|life|world|zone|one|space|works|team|capital|ventures|partners|agency)\b(?:\/[^\s<>"')\]]*)?/gi;

/** Qualify a bare domain and drop trailing sentence punctuation. */
function normalizeToken(token: string): string {
  let t = token.trim().replace(/[.,;:!?)\]}'"]+$/, "");
  if (!/^https?:\/\//i.test(t)) t = `https://${t.replace(/^www\./i, "www.")}`;
  return t;
}

export type DetectedUrl = {
  /** Exactly as the user typed it (punctuation trimmed). */
  raw: string;
  /** Qualified https:// form, safe to fetch. */
  url: string;
};

/** Detect URLs/domains in the user's text. Pure — no fetching, no validation
 *  beyond shape; SSRF filtering happens at fetch time. */
export function detectUrlTokens(text: string): DetectedUrl[] {
  const out: DetectedUrl[] = [];
  const seen = new Set<string>();
  for (const m of (text ?? "").matchAll(URL_TOKEN_RE)) {
    const raw = m[0].trim().replace(/[.,;:!?)\]}'"]+$/, "");
    const url = normalizeToken(raw);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, url });
  }
  return out.slice(0, 4);
}

/** Remove URL/domain tokens from free text. A URL in the user's message is
 *  context (where they came from), never a search keyword. */
export function stripUrlsFromText(text: string): string {
  return (text ?? "")
    .replace(URL_TOKEN_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
