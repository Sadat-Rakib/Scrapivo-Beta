import { ReactNode } from "react";
import { Filter, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export interface FilterPanelProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  onApply?: () => void;
  onReset?: () => void;
  isPending?: boolean;
  applyLabel?: string;
  usage?: { used: number; cap: number | null };
  onToggleCollapse?: () => void;
  isCollapsed?: boolean;
}

export function FilterPanel({
  title = "Filters",
  subtitle = "Refine search results",
  children,
  onApply,
  onReset,
  isPending = false,
  applyLabel = "Apply Filters",
  usage,
  onToggleCollapse,
  isCollapsed = false,
}: FilterPanelProps) {
  if (isCollapsed) {
    return (
      <div className="relative liquid-glass rounded-2xl p-3 text-center">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-white/80 hover:text-white py-1.5 transition-all"
            title="Expand Filters"
          >
            <Filter className="size-3.5 text-white/60" />
            <span>Expand Filters</span>
            <ChevronDown className="size-3.5 ml-1 text-white/40" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative liquid-glass rounded-2xl p-5 pt-3 space-y-5 flex flex-col h-full overflow-y-auto no-scrollbar">
      {/* Top-center collapse handle — in-flow (not absolute) so the panel's own
          overflow-y-auto scrollport can never clip it */}
      {onToggleCollapse && (
        <div className="flex justify-center -mb-1">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="px-3 py-0.5 rounded-full bg-[#18181c] border border-white/20 text-white/70 hover:text-white hover:bg-white/20 text-[10px] font-medium flex items-center gap-1 transition-all shadow-md cursor-pointer hover:scale-105"
            title="Collapse Filter Box"
          >
            <ChevronUp className="size-3 text-white/60" />
            <span>Collapse Filters</span>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10 mt-1">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
            <Filter className="size-3.5 text-white/60" />
            <span>{title}</span>
          </h2>
          {subtitle && <p className="text-[11px] text-white/50 mt-0.5">{subtitle}</p>}
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-white/40 hover:text-white flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="size-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Form Fields */}
      <div className="space-y-4 flex-1">{children}</div>

      {/* Primary Action Button */}
      {onApply && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onApply}
            disabled={isPending}
            className="w-full glass-pill py-2.5 px-4 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isPending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Filter className="size-3.5" />
            )}
            <span>{isPending ? "Filtering..." : applyLabel}</span>
          </button>
        </div>
      )}

      {/* Searches Usage Footer */}
      {usage && (
        <div className="pt-3 border-t border-white/10 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-white/50">
            <span>Searches today</span>
            <span className="font-mono text-white/80">
              {usage.used}
              {usage.cap ? `/${usage.cap}` : ""}
            </span>
          </div>
          {usage.cap && (
            <Progress value={(usage.used / usage.cap) * 100} className="h-1 bg-white/10" />
          )}
        </div>
      )}
    </div>
  );
}
