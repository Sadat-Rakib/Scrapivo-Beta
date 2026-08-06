import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listSavedLeads,
  setPipelineStage,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
} from "@/lib/leads.functions";
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
});

const STAGE_HINT: Record<(typeof PIPELINE_STAGES)[number], string> = {
  saved: "Just captured from Discover",
  contacted: "You reached out",
  replied: "They replied",
  won: "Closed / booked",
  lost: "Not a fit",
  ignored: "Parked",
};

function PipelinePage() {
  const qc = useQueryClient();
  const list = useServerFn(listSavedLeads);
  const setStage = useServerFn(setPipelineStage);
  const q = useQuery({ queryKey: ["saved-leads"], queryFn: () => list() });
  const [sel, setSel] = useState<any>(null);

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const s of PIPELINE_STAGES) map[s] = [];
    for (const lead of q.data ?? []) {
      const status = (PIPELINE_STAGES as readonly string[]).includes(lead.status)
        ? lead.status
        : "saved";
      map[status].push(lead);
    }
    return map;
  }, [q.data]);

  const moveMut = useMutation({
    mutationFn: (args: { id: string; status: (typeof PIPELINE_STAGES)[number]; lead: any }) =>
      setStage({
        data: {
          id: args.id,
          status: args.status,
          lead_url: args.lead.full_post_url,
          lead_title: args.lead.title,
        },
      }),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["saved-leads"] });
      qc.invalidateQueries({ queryKey: ["lead-activity"] });
      toast.success(`Moved to ${PIPELINE_STAGE_LABELS[vars.status]}`);
      if (sel?.id === vars.id) setSel({ ...sel, status: vars.status });
    },
    onError: (e: Error) => toast.error(e.message || "Couldn’t update stage"),
  });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="border-b border-border p-4 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
            <p className="text-sm text-muted-foreground">
              Move saved Discover leads through stages.{" "}
              <Link to="/saved" className="underline underline-offset-2 hover:text-foreground">
                Flat list
              </Link>
            </p>
          </div>
          <div className="text-sm text-muted-foreground">{q.data?.length ?? 0} leads</div>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          {!q.data?.length ? (
            <div className="text-sm text-muted-foreground text-center py-16">
              No saved leads yet — save something from Discover to start your pipeline.
            </div>
          ) : (
            <div className="flex gap-3 h-full min-w-max">
              {PIPELINE_STAGES.map((stage) => (
                <div
                  key={stage}
                  className="w-[260px] shrink-0 flex flex-col rounded-xl border border-border bg-muted/20"
                >
                  <div className="px-3 py-2.5 border-b border-border">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{PIPELINE_STAGE_LABELS[stage]}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {byStage[stage]?.length ?? 0}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{STAGE_HINT[stage]}</p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {(byStage[stage] ?? []).map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => setSel(lead)}
                        className={`w-full text-left rounded-lg border bg-card p-2.5 transition-colors hover:border-primary/40 ${
                          sel?.id === lead.id ? "border-primary/50 bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="text-xs text-muted-foreground mb-1 truncate">
                          {lead.platform || lead.source}
                        </div>
                        <div className="text-sm font-medium line-clamp-2">{lead.title}</div>
                        {lead.contact_email || lead.contact_name ? (
                          <div className="mt-1.5 text-[11px] text-muted-foreground truncate">
                            {[lead.contact_name, lead.contact_email].filter(Boolean).join(" · ")}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {PIPELINE_STAGES.filter((s) => s !== stage)
                            .slice(0, 3)
                            .map((s) => (
                              <Button
                                key={s}
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-[10px]"
                                disabled={moveMut.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveMut.mutate({ id: lead.id, status: s, lead });
                                }}
                              >
                                → {PIPELINE_STAGE_LABELS[s]}
                              </Button>
                            ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {sel && (
        <div className="w-[420px] border-l border-border shrink-0 bg-card">
          <LeadDetailPanel
            lead={sel}
            saved={sel}
            onClose={() => setSel(null)}
            onSavedChange={(patch) => {
              setSel((prev: any) => (prev ? { ...prev, ...patch } : prev));
              qc.invalidateQueries({ queryKey: ["saved-leads"] });
            }}
          />
        </div>
      )}
    </div>
  );
}
