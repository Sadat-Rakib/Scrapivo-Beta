/**
 * M11 — Typed search outcome presentation.
 *
 * Never collapse everything to "No results found."
 * SEARCH_CANCELLED from a superseded run must not flash a failure UI.
 */
import type { SearchOutcomeCode } from "@/lib/search/canonical-contract";

export type OutcomeUiKind =
  | "success"
  | "empty"
  | "warning"
  | "error"
  | "silent";

export type OutcomeUiModel = {
  code: SearchOutcomeCode;
  kind: OutcomeUiKind;
  /** Short label for status chrome. */
  label: string;
  /** Optional body copy; null = no toast / no banner. */
  message: string | null;
  /** When true, do not surface toast/banner (e.g. superseded cancel). */
  silent: boolean;
};

/**
 * Human explanation for an honest zero, derived from the retrieval funnel.
 * "N candidates were checked but …" instead of a bare zero — the work was
 * real, the answer should say where it stopped.
 */
export function zeroResultsNarrative(
  trace?: {
    rawCandidates?: number;
    postSpecFilter?: number;
    complete?: number;
    pendingEnrichment?: number;
    qualificationRejected?: number;
    reason?: string;
  } | null,
): string | null {
  if (!trace) return null;
  const discovered = trace.rawCandidates ?? 0;
  if (discovered === 0) {
    return "No public sources returned candidates for this query yet. Try broadening the location or removing a constraint.";
  }
  if (trace.reason === "INCOMPLETE" && (trace.pendingEnrichment ?? 0) > 0) {
    return `${trace.pendingEnrichment} candidates were found, but their public details could not be verified in the time available.`;
  }
  if ((trace.qualificationRejected ?? 0) > 0 && (trace.complete ?? 0) > 0) {
    return `${trace.complete} candidates were checked, but none passed verification. Try broadening criteria or removing a constraint.`;
  }
  if ((trace.postSpecFilter ?? 0) === 0) {
    return `${discovered} candidates were found, but none matched the requested criteria.`;
  }
  return null;
}

/**
 * @param superseded — cancel happened because the user launched another search.
 */
export function outcomeUi(
  code: SearchOutcomeCode,
  opts?: { superseded?: boolean; detail?: string | null },
): OutcomeUiModel {
  if (code === "SEARCH_CANCELLED" && opts?.superseded) {
    return {
      code,
      kind: "silent",
      label: "Cancelled",
      message: null,
      silent: true,
    };
  }

  switch (code) {
    case "QUALIFIED_RESULTS":
      return {
        code,
        kind: "success",
        label: "Qualified results",
        message: null,
        silent: true,
      };
    case "NO_QUALIFIED_RESULTS":
      return {
        code,
        kind: "empty",
        label: "No qualified results",
        message:
          "No leads passed verification for this search. Try broadening criteria or refining the query.",
        silent: false,
      };
    case "SOURCE_UNAVAILABLE":
      return {
        code,
        kind: "warning",
        label: "Source unavailable",
        message:
          opts?.detail?.trim() ||
          "A required source was unavailable. Results may be incomplete.",
        silent: false,
      };
    case "SOURCE_ERROR":
      return {
        code,
        kind: "warning",
        label: "Source error",
        message:
          opts?.detail?.trim() ||
          "A source failed while searching. Try again shortly.",
        silent: false,
      };
    case "UNSUPPORTED_CAPABILITY":
      return {
        code,
        kind: "warning",
        label: "Unsupported search",
        message:
          opts?.detail?.trim() ||
          "This search needs a capability that is not available yet.",
        silent: false,
      };
    case "SEARCH_CANCELLED":
      return {
        code,
        kind: "silent",
        label: "Cancelled",
        message: null,
        silent: true,
      };
    case "SEARCH_FAILED":
      return {
        code,
        kind: "error",
        label: "Search failed",
        message:
          opts?.detail?.trim() ||
          "The search failed unexpectedly. Please try again.",
        silent: false,
      };
    default:
      return {
        code,
        kind: "warning",
        label: String(code),
        message: opts?.detail ?? null,
        silent: false,
      };
  }
}

/** Whether an outcome should mutate the empty/error UI chrome. */
export function shouldSurfaceOutcome(model: OutcomeUiModel): boolean {
  return !model.silent && model.message != null;
}
