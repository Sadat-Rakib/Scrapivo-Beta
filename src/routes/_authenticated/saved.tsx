import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSavedLeads, deleteSavedLead } from "@/lib/leads.functions";
import { LeadCard } from "@/components/lead-card";
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/saved")({
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
    <div className="flex h-screen">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="border-b border-border p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Saved leads</h1>
            <p className="text-sm text-muted-foreground">
              {q.data?.length ?? 0} saved ·{" "}
              <Link to="/pipeline" className="underline underline-offset-2 hover:text-foreground">
                Open pipeline
              </Link>
            </p>
          </div>
          {sel && (
            <Button variant="ghost" size="sm" onClick={() => delMut.mutate(sel.id)}>
              <Trash2 className="size-4 mr-1.5" /> Delete
            </Button>
          )}
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {!q.data?.length && (
            <div className="text-sm text-muted-foreground text-center py-12">No saved leads yet.</div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {q.data?.map((l: any) => (
              <LeadCard key={l.id} lead={l} saved onOpen={() => setSel(l)} onSave={() => delMut.mutate(l.id)} />
            ))}
          </div>
        </div>
      </div>
      {sel && (
        <div className="w-[420px] border-l border-border shrink-0 bg-card">
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
