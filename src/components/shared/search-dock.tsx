/**
 * Scrapivo — unified search-page shell (M2).
 *
 * Brings the Discover page's structure — scrollable results with a
 * bottom-docked composer — to every directory page. There is no pre-search
 * filter panel: the user types a free-form ask and the page's guided
 * questionnaire collects whatever is missing (see guided-intent.ts).
 */

import { forwardRef, type ReactNode } from "react";
import { UnifiedComposer, type ComposerHandle } from "@/components/discover/unified-composer";

interface PageComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
  /** Page-specific autotype examples shown in the composer placeholder. */
  examples?: string[];
}

/** Bottom-docked composer, Discover-style. */
export const PageComposer = forwardRef<ComposerHandle, PageComposerProps>(function PageComposer(
  { value, onChange, onSubmit, pending, examples },
  ref,
) {
  return (
    <div className="px-4 md:px-6 pb-4 md:pb-6 pt-2">
      <div className="max-w-3xl mx-auto">
        <UnifiedComposer
          ref={ref}
          value={value}
          onChange={onChange}
          mode="search"
          onModeChange={() => {}}
          onSubmit={onSubmit}
          pending={pending}
          hideModeToggle
          examples={examples}
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
