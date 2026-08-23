/**
 * Scrapivo — unified search-page shell (M2).
 *
 * Brings the Discover page's structure — scrollable results with a
 * bottom-docked composer — to every directory page. Filters become a guided
 * questionnaire docked above the composer; each control maps 1:1 onto the
 * params the page's server function already accepts. No new backend.
 */

import { forwardRef, type ReactNode } from "react";
import { ChevronDown, Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { UnifiedComposer, type ComposerHandle } from "@/components/discover/unified-composer";

type Usage = { used: number; cap: number | null };

interface PageComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
  placeholder?: string;
  /** Guided questionnaire fields (existing filter controls). */
  refine?: ReactNode;
  refineOpen: boolean;
  onToggleRefine: () => void;
  /** How many answers differ from their defaults — shown on the toggle. */
  activeRefineCount?: number;
  onApplyRefine?: () => void;
  onResetRefine?: () => void;
  applyLabel?: string;
  applyPending?: boolean;
  usage?: Usage;
}

/** Bottom-docked composer + guided questionnaire, Discover-style. */
export const PageComposer = forwardRef<ComposerHandle, PageComposerProps>(function PageComposer(
  {
    value,
    onChange,
    onSubmit,
    pending,
    refine,
    refineOpen,
    onToggleRefine,
    activeRefineCount = 0,
    onApplyRefine,
    onResetRefine,
    applyLabel = "Search",
    applyPending,
    usage,
  },
  ref,
) {
  return (
    <div className="px-4 md:px-6 pb-4 md:pb-6 pt-2">
      <div className="max-w-3xl mx-auto space-y-2">
        {refine != null && (
          <div>
            <button
              type="button"
              onClick={onToggleRefine}
              aria-expanded={refineOpen}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <SlidersHorizontal className="size-3" />
              <span>Refine</span>
              {activeRefineCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {activeRefineCount}
                </span>
              )}
              <ChevronDown
                className={`size-3 transition-transform ${refineOpen ? "rotate-180" : ""}`}
              />
            </button>

            {refineOpen && (
              <div className="mt-2 rounded-2xl border border-border bg-card shadow-sm p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{refine}</div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onApplyRefine}
                    disabled={applyPending}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {applyPending && <Loader2 className="size-3 animate-spin" />}
                    {applyLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onResetRefine}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                  {usage && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {usage.used}
                      {usage.cap ? `/${usage.cap}` : ""} searches used
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <UnifiedComposer
          ref={ref}
          value={value}
          onChange={onChange}
          mode="search"
          onModeChange={() => {}}
          onSubmit={onSubmit}
          pending={pending}
          hideModeToggle
        />
      </div>
    </div>
  );
});

interface ResultsBarProps {
  count: number;
  unit: string;
  shown?: number;
  hasMore?: boolean;
  query?: string | null;
  onClear?: () => void;
  actions?: ReactNode;
}

/** "Results for …" / count line shared by all directory pages. */
export function ResultsBar({
  count,
  unit,
  shown,
  hasMore,
  query,
  onClear,
  actions,
}: ResultsBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm min-w-0">
        {query ? (
          <>
            <span className="text-muted-foreground">Results for </span>
            <span className="font-medium">"{query}"</span>
            <span className="text-muted-foreground"> · </span>
          </>
        ) : null}
        <span className="text-muted-foreground">
          {count.toLocaleString()} {unit}
          {hasMore && shown != null ? ` — showing ${shown}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
