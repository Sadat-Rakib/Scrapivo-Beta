import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FilterPanel } from "@/components/shared/filter-panel";

export interface MobileFilterSheetProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Return `false` to keep the sheet open (e.g. validation failed). */
  onApply?: () => void | boolean;
  onReset?: () => void;
  isPending?: boolean;
  applyLabel?: string;
  usage?: { used: number; cap: number | null };
}

/**
 * Mobile counterpart of the desktop right-rail FilterPanel.
 *
 * Responsive architecture: desktop keeps the persistent filter sidebar
 * (hidden below `lg`), while this bottom sheet exposes the exact same
 * FilterPanel — same fields, same Apply/Reset — behind a "Filters" button.
 * Applying closes the sheet so results are immediately visible.
 */
export function MobileFilterSheet({
  title = "Filters",
  subtitle,
  children,
  onApply,
  onReset,
  isPending = false,
  applyLabel,
  usage,
}: MobileFilterSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${title.toLowerCase()}`}
        className="lg:hidden glass-pill px-3.5 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5"
      >
        <SlidersHorizontal className="size-3.5" />
        <span>Filters</span>
      </button>

      <SheetContent
        side="bottom"
        className="bg-[#0e0e11] text-white border-t border-white/10 rounded-t-2xl p-0 h-[min(85dvh,680px)] flex flex-col"
      >
        {/* Drag-handle affordance */}
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <div className="flex-1 min-h-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <FilterPanel
            title={title}
            subtitle={subtitle}
            onApply={() => {
              // onApply may veto the close (return false) when validation fails.
              if (onApply?.() === false) return;
              setOpen(false);
            }}
            onReset={onReset}
            isPending={isPending}
            applyLabel={applyLabel}
            usage={usage}
          >
            {children}
          </FilterPanel>
        </div>
      </SheetContent>
    </Sheet>
  );
}
