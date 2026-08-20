import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSavedLeads, deleteSavedLead } from "@/lib/leads.functions";
import { LeadCard } from "@/components/lead-card";
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/saved")({
  head: () => ({
    meta: [{ title: "Scrapivo — Saved leads" }],
  }),
  component: SavedPage,
});

function SavedPage() {
  const qc = useQueryClient();
  const list = useServerFn(listSavedLeads);
  const del = useServerFn(deleteSavedLead);
  const q = useQuery({ queryKey: ["saved-leads"], queryFn: () => list() });
  const [sel, setSel] = useState<any>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-leads"] });
      setSel(null);
      toast.success("Deleted");
    },
  });

  return (
    <div className="flex h-full min-h-0 bg-[#0a0a0b] text-white">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Header Bar */}
        <div className="border-b border-white/10 p-4 sm:px-6 flex items-center justify-between shrink-0 bg-black/20">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-0.5">
              <Bookmark className="size-3.5" />
              <span>Saved Pipeline</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Saved Leads</h1>
          </div>
          {sel && (
            <button
              type="button"
              onClick={() => delMut.mutate(sel.id)}
              className="glass-pill px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 flex items-center gap-1.5"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          )}
        </div>

        {/* Saved List / Grid */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 no-scrollbar">
          {!q.data?.length && (
            <div className="liquid-glass rounded-2xl p-12 text-center text-xs text-white/50 max-w-lg mx-auto">
              No saved leads yet. Save leads from Discover to track them here.
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {q.data?.map((l: any) => (
              <div key={l.id} className="liquid-glass rounded-2xl p-4">
                <LeadCard
                  lead={l}
                  saved
                  onOpen={() => setSel(l)}
                  onSave={() => delMut.mutate(l.id)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Slideout Detail Panel */}
      {sel && (
        <div className="w-[420px] border-l border-white/10 shrink-0 bg-[#0e0e11] liquid-glass">
          <LeadDetailPanel
            lead={sel}
            saved={sel}
            onClose={() => setSel(null)}
            onSavedChange={(patch) => setSel((prev: any) => (prev ? { ...prev, ...patch } : prev))}
          />
        </div>
      )}
    </div>
  );
}
