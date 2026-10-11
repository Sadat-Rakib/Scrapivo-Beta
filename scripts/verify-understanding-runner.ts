import { resolveCanonicalLocation } from "../src/lib/search/location-resolver";

/** A formal model-validation run has no evidence after deterministic fallback. */
export function mustAbortRequiredLlmRun(
  requireLlm: boolean,
  deterministicMode: boolean,
  fallbackUsed: boolean,
): boolean {
  return requireLlm && !deterministicMode && fallbackUsed;
}

export function sameLocation(
  want: string,
  got: string | null | undefined,
  countryHint?: string | null,
): boolean {
  const normalize = (s: string | null | undefined) =>
    (s ?? "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[\s-]+/g, " ")
      .trim();
  const expected = normalize(want);
  if (!expected || !got) return false;
  if (!countryHint && expected === normalize(got)) return true;
  const expectedGeo = resolveCanonicalLocation(want, {
    gazetteer: true,
    correctTypos: false,
    countryHint,
  });
  const observedGeo = resolveCanonicalLocation(got, {
    gazetteer: true,
    correctTypos: false,
    countryHint,
  });
  return !!expectedGeo?.id &&
    expectedGeo.id === observedGeo?.id &&
    !!expectedGeo.country_code &&
    expectedGeo.country_code === observedGeo?.country_code &&
    (!countryHint || expectedGeo.country_code === countryHint.toUpperCase());
}
