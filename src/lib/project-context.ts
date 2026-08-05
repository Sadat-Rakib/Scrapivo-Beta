/** Shared helpers for project Q/A answers (niche, location, audience). */

const OPEN_NICHE_RE =
  /^(all|any|anyone|everyone|anybody|anywhere|everything|all niches?|all categor(y|ies)|no niche|none|n\/?a|-)$/i;

/** True when the user means "no niche filter" (all categories). */
export function isOpenNiche(niche: string | null | undefined): boolean {
  const n = (niche || "").trim();
  if (!n) return true;
  return OPEN_NICHE_RE.test(n);
}

/** Normalize stored niche — open answers become empty so they don't pollute queries. */
export function normalizeNiche(niche: string | null | undefined): string {
  const n = (niche || "").trim();
  if (!n || isOpenNiche(n)) return "";
  return n;
}

export function isAnywhereLocation(location: string | null | undefined): boolean {
  const l = (location || "").trim();
  return !l || /^anywhere$/i.test(l);
}
