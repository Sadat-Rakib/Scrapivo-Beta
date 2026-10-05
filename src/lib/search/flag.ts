/** Indexed-retrieval cutover. Server-side only. Default ON:
 *  the bounded hot index is candidate discovery; S3 remains the canonical
 *  coverage fallback selected by the coverage planner.
 *  When ON, runSpecSearchCore tries Postgres first and falls back to S3
 *  on any error — never a hard failure. */
export function useIndexedSearch(): boolean {
  const raw = (process.env.USE_INDEXED_SEARCH ?? (process.env.VITEST ? "false" : "true")).trim();
  const enabled = raw.toLowerCase() === "true";
  if (typeof console !== "undefined") {
    console.info(
      `[index-flag] USE_INDEXED_SEARCH=${JSON.stringify(raw)} → ${enabled ? "INDEX" : "S3"}`,
    );
  }
  return enabled;
}

/** Immutable compact object index cutover. Default OFF until active.json has
 * passed full reconciliation. When enabled it replaces Postgres idx_* as the
 * hot candidate engine; legacy S3 canonical readers remain fallback. */
export function useObjectSearchIndex(): boolean {
  return (process.env.USE_OBJECT_SEARCH_INDEX ?? "false").trim().toLowerCase() === "true";
}


/** Coverage selector (Phase 1.2 / D). Production default ON; under vitest
 *  default OFF so unit tests stay on the legacy order unless they opt in.
 *  Set USE_COVERAGE_SELECTOR=true|false to override. */
export function useCoverageSelector(): boolean {
  const raw = (process.env.USE_COVERAGE_SELECTOR ?? "").trim();
  const enabled =
    raw.length > 0 ? raw.toLowerCase() === "true" : !process.env.VITEST;
  if (typeof console !== "undefined") {
    console.info(
      `[coverage-flag] USE_COVERAGE_SELECTOR=${JSON.stringify(raw || "(unset)")} → ${enabled ? "SELECTOR" : "LEGACY-ORDER"}`,
    );
  }
  return enabled;
}
