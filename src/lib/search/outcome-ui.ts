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
    returned?: number;
    reason?: string;
    /** User-safe source health sentence (never raw provider errors). */
    sourceHealth?: { summary?: string | null } | null;
  } | null,
): string | null {
  if (!trace) return null;
  const discovered = trace.rawCandidates ?? 0;
  const health = trace.sourceHealth?.summary ?? null;
  if (discovered === 0) {
    return health
      ? `${health} The sources that answered returned no candidates for this query.`
      : "No public sources returned candidates for this query yet. Try broadening the location or removing a constraint.";
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
 * E2E-C9: an honest zero must say WHERE the search stopped, including the
 * candidates that surfaced but failed the requested criteria. The base
 * narrative covers the retrieval funnel; the candidate ledger adds the
 * "found but not proven" story the funnel numbers cannot express. Internal
 * stage names never leak — only what the user can act on.
 */
export function enrichZeroNarrative(
  base: string | null,
  ledger?: {
    counts?: Record<string, number>;
    streamedNotReturned?: Array<{ fate: string; reason?: string | null }>;
  } | null,
): string | null {
  const parts: string[] = [];
  if (base) parts.push(base);
  if (ledger) {
    const dropped = ledger.streamedNotReturned ?? [];
    const unproven = dropped.filter(
      (s) => s.reason?.startsWith("UNPROVEN_CRITERION") || s.reason === "SIGNAL_NOT_VERIFIED",
    ).length;
    if (unproven > 0) {
      parts.push(
        `${unproven} candidate${unproven === 1 ? "" : "s"} looked promising but did not prove the requested details — such as public contact information or the signal you asked for.`,
      );
    } else if (dropped.length > 0) {
      parts.push(
        `${dropped.length} candidate${dropped.length === 1 ? "" : "s"} surfaced while researching but did not match your criteria.`,
      );
    }
    if (!base && (ledger.counts?.gated ?? 0) > 0) {
      parts.push("Candidates were found, but they could not be verified with the sources available right now.");
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
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
