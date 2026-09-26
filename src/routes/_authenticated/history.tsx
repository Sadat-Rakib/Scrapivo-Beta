import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listHistory } from "@/lib/leads.functions";
import { RotateCw, History as HistoryIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [{ title: "Scrapivo — Search history" }],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const navigate = useNavigate();
  const list = useServerFn(listHistory);
  const q = useQuery({ queryKey: ["history"], queryFn: () => list() });

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-6 text-white no-scrollbar">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
          <HistoryIcon className="size-3.5" />
          <span>Audit Log</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Search History</h1>
        <p className="text-xs text-white/60 mt-1">Review your recent queries and executed signals.</p>
      </div>

      {!q.data?.length && (
        <div className="liquid-glass rounded-2xl p-8 text-center text-xs text-white/50">
          No search history recorded yet.
        </div>
      )}

      <div className="space-y-3">
        {q.data?.map((h: any) => (
          <div
            key={h.id}
            className="liquid-glass rounded-xl p-4 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-all"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{h.query}</div>
              <div className="text-xs text-white/50 mt-0.5">
                {h.results_count} results · {new Date(h.created_at).toLocaleString()}
                {h.sources_searched?.length ? ` · ${h.sources_searched.join(", ")}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/discover",
                  // Saved transcripts reopen exactly; legacy rows (no
                  // conversation id) fall back to re-running the query.
                  search: (h as any).conversation_id
                    ? { conversation: (h as any).conversation_id as string }
                    : { q: h.query },
                })
              }
              className="glass-pill px-3.5 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5 shrink-0"
            >
              <RotateCw className="size-3.5" />
              <span>Open</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
