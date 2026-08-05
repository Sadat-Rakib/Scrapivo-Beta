import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listHistory } from "@/lib/leads.functions";
import { Button } from "@/components/ui/button";
import { RotateCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const navigate = useNavigate();
  const list = useServerFn(listHistory);
  const q = useQuery({ queryKey: ["history"], queryFn: () => list() });

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Search history</h1>
      <p className="text-sm text-muted-foreground mb-6">Last 100 searches.</p>
      {!q.data?.length && <div className="text-sm text-muted-foreground">No searches yet.</div>}
      <div className="space-y-2">
        {q.data?.map((h: any) => (
          <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{h.query}</div>
              <div className="text-xs text-muted-foreground">
                {h.results_count} results · {new Date(h.created_at).toLocaleString()} · {(h.sources_searched ?? []).join(", ")}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/discover" })}>
              <RotateCw className="size-3.5 mr-1.5" /> Open
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}