import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createSignalWatch,
  deleteSignalWatch,
  listSignalWatches,
  runDueSignalWatches,
  runSignalWatch,
  setSignalWatchPaused,
  type CampaignIcp,
} from "@/lib/campaigns.functions";
import { Bell, Pause, Play, Trash2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const WATCH_EXAMPLES = [
  "e.g. Watch for SaaS founders hiring engineers rn",
  "e.g. Alert me when Austin HVAC companies post jobs asap",
  "e.g. Track pre-seed AI startups raising this quarter",
  "e.g. Ping me when local dentists expand to a second office",
  "e.g. Watch for marketing agencies hiring 3+ engineers",
];

/**
 * Legacy Watches page content — the exact pre-takeover UI and logic, kept
 * fully functional for rollback / future reuse. Reachable via
 * `/watches?legacy=1` or the HERO_TAKEOVER_ENABLED kill-switch.
 */
export function LegacyWatchesPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listSignalWatches);
  const create = useServerFn(createSignalWatch);
  const remove = useServerFn(deleteSignalWatch);
  const runOne = useServerFn(runSignalWatch);
  const runDue = useServerFn(runDueSignalWatches);
  const setPaused = useServerFn(setSignalWatchPaused);

  const [newQuery, setNewQuery] = useState("");
  const [schedule, setSchedule] = useState<"daily" | "weekly">("daily");

  // Rotating placeholder examples: watches are recurring auto-runs, so each
  // example frames a hunt Scrapivo repeats on schedule and delivers to Discover.
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  useEffect(() => {
    if (newQuery.trim()) return;
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % WATCH_EXAMPLES.length);
    }, 3500);
    return () => window.clearInterval(id);
  }, [newQuery]);

  const q = useQuery({ queryKey: ["signal-watches"], queryFn: () => list() });

  const createMut = useMutation({
    mutationFn: () => create({ data: { query: newQuery.trim(), schedule } }),
    onSuccess: () => {
      setNewQuery("");
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      toast.success("Signal watch saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: (id: string) => runOne({ data: { id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      if (res.error === "limit") {
        toast.error(res.message ?? "Search limit reached");
        return;
      }
      // Watch v2: the run is a durable job — results land after it completes.
      toast.success("Watch run queued — fresh matches land in Discover");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dueMut = useMutation({
    mutationFn: () => runDue(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      toast.success(`Ran ${res.ran} due watch(es)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      toast.success("Watch removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pauseMut = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      setPaused({ data: { id, paused } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      toast.success(res.paused ? "Watch paused — scheduled runs skip it" : "Watch resumed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-6 text-white no-scrollbar">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
            <Bell className="size-3.5" />
            <span>Automated Ingestion</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Signal Watches</h1>
          <p className="text-xs text-white/60 mt-1 max-w-xl leading-relaxed">
            Save a buying signal once. Scrapivo re-runs it on your schedule and brings fresh matches back into Discover.
          </p>
        </div>

        <button
          type="button"
          onClick={() => dueMut.mutate()}
          disabled={dueMut.isPending}
          className="glass-pill px-3.5 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`size-3.5 ${dueMut.isPending ? "animate-spin" : ""}`} />
          <span>Run Due</span>
        </button>
      </div>

      {/* New Watch Creation Card */}
      <form
        className="liquid-glass rounded-2xl p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newQuery.trim()) return;
          createMut.mutate();
        }}
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/50">
          <Bell className="size-3.5 text-white/70" />
          <span>New Signal Watch</span>
        </div>
        <input
          value={newQuery}
          onChange={(e) => setNewQuery(e.target.value)}
          placeholder={WATCH_EXAMPLES[placeholderIdx]}
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
        />
        <div className="flex items-center justify-between gap-3 pt-1">
          <select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as "daily" | "weekly")}
            className="rounded-lg border border-white/10 bg-[#131316] px-3 py-2 text-xs text-white outline-none focus:border-white/30"
          >
            <option value="daily">Daily Schedule</option>
            <option value="weekly">Weekly Schedule</option>
          </select>
          <button
            type="submit"
            disabled={createMut.isPending || !newQuery.trim()}
            className="glass-pill px-4 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20"
          >
            Save Watch
          </button>
        </div>
      </form>

      {/* Empty State */}
      {!q.data?.length && (
        <div className="liquid-glass rounded-2xl p-8 text-center text-xs text-white/50">
          No signal watches saved yet. Create one above or save from Discover.
        </div>
      )}

      {/* Active Watches List */}
      <div className="space-y-3">
        {q.data?.map((w: any) => {
          const icp = (w.icp || {}) as CampaignIcp;
          return (
            <div
              key={w.id}
              className="liquid-glass rounded-xl p-4 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-all"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {w.name || w.query}
                  {icp.paused ? (
                    <span className="ml-2 text-[10px] rounded-full border border-white/25 text-white/70 bg-white/10 px-2 py-0.5 align-middle">
                      paused
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  {icp.schedule || "daily"}
                  {icp.signal_family ? ` · ${icp.signal_family}` : ""}
                  {typeof icp.last_results_count === "number" ? ` · last ${icp.last_results_count} leads` : ""}
                  {w.last_run_at ? ` · ran ${new Date(w.last_run_at).toLocaleString()}` : " · never run"}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={pauseMut.isPending}
                  onClick={() => pauseMut.mutate({ id: w.id, paused: !icp.paused })}
                  className="glass-pill px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5"
                  title={icp.paused ? "Resume scheduled runs" : "Pause scheduled runs"}
                >
                  {icp.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                  <span>{icp.paused ? "Resume" : "Pause"}</span>
                </button>
                <button
                  type="button"
                  disabled={runMut.isPending}
                  onClick={() => runMut.mutate(w.id)}
                  className="glass-pill px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5"
                >
                  <Play className="size-3.5" />
                  <span>Run</span>
                </button>
                <button
                  type="button"
                  onClick={() => delMut.mutate(w.id)}
                  disabled={delMut.isPending}
                  className="p-2 rounded-xl text-white/40 hover:text-rose-400 hover:bg-white/10 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
