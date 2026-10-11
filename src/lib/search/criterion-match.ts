/** Explicit alternatives retain phrases; whitespace never means OR. */
export function criterionAlternatives(value: string): string[] {
  return value.split(/\s*(?:\bor\b|[/|;,])\s*/i).map(part => part.trim()).filter(Boolean);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\bai\b/g, "artificial intelligence")
    .replace(/\bsaas\b/g, "software as a service").replace(/\binfra\b/g, "infrastructure")
    .replace(/\bdevtools?\b/g, "developer tools").replace(/\bnext[ .]?js\b/g, "nextjs")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function criterionPhraseMatches(observed: string | null | undefined, requested: string): boolean {
  if (!observed) return false;
  const words = normalized(observed).split(/\s+/).map(word => word.replace(/s$/, ""));
  return criterionAlternatives(requested).some(part => {
    const terms = normalized(part.replace(/\s+(?:compan(?:y|ies)|startups?)$/i, "")).split(/\s+/).filter(Boolean);
    return terms.length > 0 && terms.every(term => words.includes(term.replace(/s$/, "")));
  });
}

/** Craft noun → activity stem: "installer" matches prose that says
 *  "installation"/"we install" without matching "supplier". A requested craft
 *  is satisfied when its activity stem appears, never by an unrelated trade
 *  word ("solar consultancy" alone proves consulting, not installing). */
export function criterionCraftMatches(observed: string | null | undefined, requested: string): boolean {
  if (!observed) return false;
  if (criterionPhraseMatches(observed, requested)) return true;
  const stems = (value: string): Set<string> =>
    new Set(normalized(value).split(/\s+/).map(stemActivity));
  const observedStems = stems(observed);
  return criterionAlternatives(requested).some(part => {
    const terms = [...stems(part.replace(/\s+(?:compan(?:y|ies)|startups?)$/i, ""))].filter(Boolean);
    return terms.length > 0 && terms.every(term => observedStems.has(term));
  });
}

function stemActivity(word: string): string {
  const stemmed = word
    .replace(/s$/, "")
    .replace(/(ation|ing|ancies|ancy|ers|er|ors|or|ians|ian|ant)$/, "")
    .replace(/i$/, "y")
    .replace(/([bcdfgklmnprstvz])\1$/, "$1");
  return stemmed || word;
}
