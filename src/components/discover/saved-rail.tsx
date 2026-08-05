import { Link } from "@tanstack/react-router";
import { MoreHorizontal, ChevronRight, ChevronLeft, Bookmark } from "lucide-react";

export function SavedRail({
  leads,
  onOpen,
  open,
  onToggle,
}: {
  leads: any[];
  onOpen: (lead: any) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Floating toggle tab — visible on all screen sizes */}
      <button
        onClick={onToggle}
        aria-label={open ? "Hide saved leads" : "Show saved leads"}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1.5 pl-2 pr-1.5 py-3 rounded-l-xl border border-r-0 border-border bg-card shadow-md hover:bg-accent transition-all"
        style={{ transform: `translate(${open ? "-320px" : "0"}, -50%)` }}
      >
        {open ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        <Bookmark className="size-3.5 text-primary" />
        {!open && leads.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">{leads.length}</span>
        )}
      </button>

      {/* Sliding rail — overlays on small screens, takes space on xl+ */}
      <aside
        className={`fixed xl:static top-0 right-0 h-full w-[320px] shrink-0 border-l border-border bg-sidebar flex flex-col z-20 transition-transform xl:transition-none ${
          open ? "translate-x-0 xl:flex" : "translate-x-full xl:hidden"
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-border">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-sm">Saved</span>
            <span className="text-xs text-muted-foreground">({leads.length})</span>
          </div>
          <Link to="/saved" aria-label="Open all saved" className="p-1 rounded hover:bg-accent text-muted-foreground">
            <MoreHorizontal className="size-4" />
          </Link>
        </div>
        <div className="px-3 py-3 flex-1 overflow-y-auto space-y-2">
          {leads.length === 0 && (
            <div className="text-xs text-muted-foreground text-center px-3 py-8">
              Saved leads will appear here.
            </div>
          )}
          {leads.slice(0, 30).map((l) => (
            <button
              key={l.id ?? l.full_post_url}
              onClick={() => onOpen(l)}
              className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors"
            >
              <div className="text-sm font-medium line-clamp-1">{l.title}</div>
              <div className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                {l.author ?? "Opportunity"}
              </div>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}