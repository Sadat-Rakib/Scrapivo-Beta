/** A formal model-validation run has no evidence after deterministic fallback. */
export function mustAbortRequiredLlmRun(
  requireLlm: boolean,
  deterministicMode: boolean,
  fallbackUsed: boolean,
): boolean {
  return requireLlm && !deterministicMode && fallbackUsed;
}

export function sameLocation(want: string, got: string | null | undefined): boolean {
  const normalize = (s: string | null | undefined) =>
    (s ?? "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[\s-]+/g, " ")
      .trim();
  const expected = normalize(want);
  return !!expected && expected === normalize(got);
}
