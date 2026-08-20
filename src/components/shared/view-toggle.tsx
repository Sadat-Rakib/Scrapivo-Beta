import { LayoutGrid, List } from "lucide-react";

export type ViewMode = "grid" | "list";

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex items-center p-1 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md">
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
          mode === "grid"
            ? "bg-white/15 text-white shadow-sm border border-white/20"
            : "text-white/50 hover:text-white hover:bg-white/[0.05]"
        }`}
      >
        <LayoutGrid className="size-3.5" />
        <span>Cards</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
          mode === "list"
            ? "bg-white/15 text-white shadow-sm border border-white/20"
            : "text-white/50 hover:text-white hover:bg-white/[0.05]"
        }`}
      >
        <List className="size-3.5" />
        <span>List</span>
      </button>
    </div>
  );
}
