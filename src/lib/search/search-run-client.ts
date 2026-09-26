/**
 * M11 — Client search-run identity + AbortController + stale discard.
 *
 * Only the currently active search_run_id may mutate UI state.
 * Abort alone is insufficient: a late response can race abort().
 * Every mutation path (results, loading, error, counts, empty, panels)
 * must go through accept() / applyIfActive().
 */
import {
  createSearchRun,
  shouldDiscardStaleResult,
  type SearchRunIds,
} from "@/lib/search/search-run";

export type ActiveSearchSnapshot = SearchRunIds & {
  /** True while this run is the active one and not yet settled. */
  pending: boolean;
  /** Abort was because a newer search replaced this one (not user failure). */
  superseded: boolean;
};

export type AcceptDecision =
  | { ok: true; run: SearchRunIds }
  | {
      ok: false;
      reason: "STALE_RUN" | "NO_ACTIVE" | "SUPERSEDED" | "CANCELLED";
      activeRunId: string | null;
      responseRunId: string | null;
    };

/**
 * Owns conversation-scoped run identity and a single AbortController.
 * Pure enough for deferred-promise race tests without React.
 */
export class ActiveSearchSession {
  private conversationId: string;
  private active: SearchRunIds | null = null;
  private controller: AbortController | null = null;
  private pending = false;
  /** Runs aborted because a newer begin() replaced them. */
  private supersededIds = new Set<string>();

  constructor(conversationId?: string) {
    this.conversationId =
      conversationId?.trim() ||
      createSearchRun().conversation_id;
  }

  get conversation_id(): string {
    return this.conversationId;
  }

  get activeRunId(): string | null {
    return this.active?.search_run_id ?? null;
  }

  get activeRun(): SearchRunIds | null {
    return this.active ? { ...this.active } : null;
  }

  get signal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }

  get isPending(): boolean {
    return this.pending;
  }

  snapshot(): ActiveSearchSnapshot | null {
    if (!this.active) return null;
    return {
      ...this.active,
      pending: this.pending,
      superseded: this.supersededIds.has(this.active.search_run_id),
    };
  }

  /**
   * Start a new search: abort previous work, mint a new run identity
   * under the same conversation_id (unless overridden).
   */
  begin(partial?: Partial<SearchRunIds>): {
    run: SearchRunIds;
    signal: AbortSignal;
  } {
    if (this.active?.search_run_id) {
      this.supersededIds.add(this.active.search_run_id);
    }
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }

    const run = createSearchRun({
      ...partial,
      // Conversation stays stable across begins unless explicitly overridden.
      conversation_id:
        partial?.conversation_id?.trim() || this.conversationId,
      // Fresh search_run_id unless the caller forces one (tests).
      search_run_id: partial?.search_run_id,
    });
    // Keep conversation stable across begins.
    this.conversationId = run.conversation_id;

    this.controller = new AbortController();
    this.active = run;
    this.pending = true;
    return { run, signal: this.controller.signal };
  }

  /**
   * Gate every response before any UI mutation.
   * Missing / mismatched search_run_id → discard (fail closed).
   */
  accept(response: { search_run_id?: string | null }): AcceptDecision {
    const activeId = this.activeRunId;
    if (!activeId) {
      return {
        ok: false,
        reason: "NO_ACTIVE",
        activeRunId: null,
        responseRunId: response.search_run_id ?? null,
      };
    }
    if (shouldDiscardStaleResult(response, activeId)) {
      const rid = response.search_run_id ?? null;
      return {
        ok: false,
        reason: rid && this.supersededIds.has(rid) ? "SUPERSEDED" : "STALE_RUN",
        activeRunId: activeId,
        responseRunId: rid,
      };
    }
    if (this.controller?.signal.aborted) {
      return {
        ok: false,
        reason: "CANCELLED",
        activeRunId: activeId,
        responseRunId: response.search_run_id ?? null,
      };
    }
    return { ok: true, run: { ...this.active! } };
  }

  /**
   * Apply a state mutation only if the response belongs to the active run.
   * Returns false when discarded — caller must not mutate.
   */
  applyIfActive<T>(
    response: { search_run_id?: string | null },
    mutate: (run: SearchRunIds) => T,
  ): { applied: true; value: T } | { applied: false; decision: AcceptDecision } {
    const decision = this.accept(response);
    if (!decision.ok) return { applied: false, decision };
    return { applied: true, value: mutate(decision.run) };
  }

  /** Mark the active run settled (success or typed terminal outcome). */
  settle(response?: { search_run_id?: string | null }): boolean {
    if (response && !this.accept(response).ok) return false;
    this.pending = false;
    return true;
  }

  /**
   * Explicit cancel of the active run (navigation / unmount / user stop).
   * Does not mint a replacement — activeRunId stays until begin() or clear().
   */
  cancel(opts?: { clearActive?: boolean }): void {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }
    if (this.active?.search_run_id) {
      // Explicit cancel is not a supersession by a newer search.
      this.pending = false;
    }
    if (opts?.clearActive) {
      this.active = null;
      this.pending = false;
    }
  }

  /** True when this run was aborted because a newer search started. */
  wasSuperseded(searchRunId: string | null | undefined): boolean {
    if (!searchRunId) return false;
    return this.supersededIds.has(searchRunId);
  }

  /** Rotate conversation (New chat). Aborts in-flight work. */
  rotateConversation(nextConversationId?: string): void {
    this.cancel({ clearActive: true });
    this.supersededIds.clear();
    this.conversationId =
      nextConversationId?.trim() || createSearchRun().conversation_id;
  }

  /** Unmount / dispose — abort and clear. */
  dispose(): void {
    this.cancel({ clearActive: true });
    this.supersededIds.clear();
  }
}

/** Detect AbortError / SEARCH_CANCELLED from fetch / server-fn. */
export function isSearchAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    if (err.name === "AbortError") return true;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (err.message === "SEARCH_CANCELLED") return true;
    if (/aborted|AbortError|SEARCH_CANCELLED/i.test(err.message)) return true;
    const code = (err as Error & { code?: string }).code;
    if (code === "SEARCH_CANCELLED") return true;
  }
  return false;
}
