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
import type { Lead } from "@/lib/scoring";
import { toast } from "sonner";
import { Columns3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({
    meta: [{ title: "Scrapivo — Pipeline" }],
  }),
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
  // Row shape derived from the actual query so no `any` is needed below.
  type PipelineLead = NonNullable<Awaited<ReturnType<typeof list>>[number]>;
  const q = useQuery({ queryKey: ["saved-leads"], queryFn: () => list() });
  const [sel, setSel] = useState<PipelineLead | null>(null);

  const byStage = useMemo(() => {
    const map: Record<string, PipelineLead[]> = {};
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
    mutationFn: (args: {
      id: string;
      status: (typeof PIPELINE_STAGES)[number];
      lead: PipelineLead;
    }) =>
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
    <div className="flex h-full min-h-0 bg-[#0a0a0b] text-white">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Header Bar */}
        <div className="border-b border-white/10 p-4 sm:px-6 flex items-center justify-between gap-3 shrink-0 bg-black/20">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-0.5">
              <Columns3 className="size-3.5" />
              <span>Outreach Management</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Pipeline</h1>
          </div>
          <div className="text-xs text-white/50">{q.data?.length ?? 0} saved leads</div>
        </div>

        {/* Board Columns */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-6 no-scrollbar">
          {!q.data?.length ? (
            <div className="liquid-glass rounded-2xl p-12 text-center text-xs text-white/50 max-w-lg mx-auto">
              No saved leads yet — save something from Discover to populate your pipeline.
            </div>
          ) : (
            <div className="flex gap-4 h-full min-w-max">
              {PIPELINE_STAGES.map((stage) => (
                <div
                  key={stage}
                  className="w-[280px] shrink-0 flex flex-col rounded-2xl liquid-glass border border-white/10"
                >
                  <div className="px-4 py-3 border-b border-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white tracking-wide">
                        {PIPELINE_STAGE_LABELS[stage]}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-mono">
                        {byStage[stage]?.length ?? 0}
                      </span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5">{STAGE_HINT[stage]}</p>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5 no-scrollbar">
                    {(byStage[stage] ?? []).map((lead) => (
                      <div
                        key={lead.id}
                        onClick={() => setSel(lead)}
                        className={`w-full text-left rounded-xl p-3 border transition-all cursor-pointer ${
                          sel?.id === lead.id
                            ? "bg-white/15 border-white/30 text-white shadow-md"
                            : "bg-white/[0.03] border-white/10 hover:border-white/20 text-white/80 hover:bg-white/[0.06]"
                        }`}
                      >
                        <div className="text-[10px] uppercase font-mono text-white/40 mb-1 truncate">
                          {lead.platform || lead.source}
                        </div>
                        <div className="text-xs font-medium line-clamp-2 leading-relaxed text-white">
                          {lead.title}
                        </div>
                        {lead.contact_email || lead.contact_name ? (
                          <div className="mt-2 text-[11px] text-white/50 truncate border-t border-white/5 pt-1.5">
                            {[lead.contact_name, lead.contact_email].filter(Boolean).join(" · ")}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {PIPELINE_STAGES.filter((s) => s !== stage)
                            .slice(0, 3)
                            .map((s) => (
                              <button
                                key={s}
                                type="button"
                                disabled={moveMut.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveMut.mutate({ id: lead.id, status: s, lead });
                                }}
                                className="glass-pill px-2 py-0.5 text-[9px] font-medium text-white/60 hover:text-white"
                              >
                                → {PIPELINE_STAGE_LABELS[s]}
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slideout Detail Panel: full-width overlay on phones, fixed rail on sm+ */}
      {sel && (
        <div className="w-full max-w-[420px] sm:w-[420px] sm:max-w-none border-l border-white/10 shrink-0 bg-[#0e0e11] liquid-glass">
          <LeadDetailPanel
            lead={sel as unknown as Lead}
            saved={sel}
            onClose={() => setSel(null)}
            onSavedChange={(patch) => {
              setSel((prev: PipelineLead | null) =>
                prev ? ({ ...prev, ...patch } as PipelineLead) : prev,
              );
              qc.invalidateQueries({ queryKey: ["saved-leads"] });
            }}
          />
        </div>
      )}
    </div>
  );
}
