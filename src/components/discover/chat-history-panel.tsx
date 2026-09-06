import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { History, Search, Plus } from "lucide-react";
import { listHistory } from "@/lib/leads.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ChatHistoryPanel() {
  const navigate = useNavigate();
  const list = useServerFn(listHistory);
  const q = useQuery({ queryKey: ["history"], queryFn: () => list(), staleTime: 60_000 });
  const [filter, setFilter] = useState("");

  const history = q.data ?? [];
  const filtered = filter
    ? history.filter((h: any) => h.query.toLowerCase().includes(filter.toLowerCase()))
    : history;

  return (
    <div className="flex flex-col h-full bg-sidebar border-l border-border text-sidebar-foreground">
      <div className="p-5 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-tight">Chat History</h2>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-8 h-8 text-xs bg-sidebar border-border/60"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {q.isPending ? (
          <div className="text-xs text-muted-foreground text-center py-8">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            {filter ? "No matches." : "No searches yet. Run your first search."}
          </div>
        ) : (
          filtered.map((h: any) => (
            <button
              key={h.id}
              onClick={() => {
                navigate({
                  to: "/discover",
                  search: { q: h.query },
                });
              }}
              className="w-full flex gap-3 text-left p-3 rounded-xl hover:bg-sidebar-accent/40 transition-colors group cursor-pointer"
            >
              <div className="size-8 rounded-full bg-background border border-border/40 flex items-center justify-center shrink-0 group-hover:border-border transition-colors">
                <History className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <div className="flex-1 min-w-0 py-0.5">
                <div className="text-xs font-medium truncate group-hover:text-foreground">
                  {h.query}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 truncate flex items-center gap-1.5">
                  <span>
                    {h.results_count} result{h.results_count !== 1 ? "s" : ""}
                  </span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}</span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="p-4 shrink-0 border-t border-border/40">
        <Button
          onClick={() => navigate({ to: "/discover", search: { fresh: Date.now() } })}
          className="w-full rounded-full text-xs font-semibold"
        >
          <Plus className="size-3.5 mr-1.5" /> Create new chat
        </Button>
      </div>
    </div>
  );
}
