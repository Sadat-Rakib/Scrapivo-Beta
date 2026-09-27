import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, Play, Trash2, X, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HeroVideo } from "@/components/hero-video";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listProjects } from "@/lib/projects.functions";
import { getSearchJob } from "@/lib/search-jobs.functions";
import {
  createSignalWatch,
  deleteSignalWatch,
  listSignalWatches,
  runSignalWatch,
  type CampaignIcp,
} from "@/lib/campaigns.functions";

type Step = "idle" | "q1" | "q2" | "confirm";

const Q1_PLACEHOLDER = "e.g. Watch for SaaS founders hiring engineers rn";

const TERMINAL_JOB_STATUSES = ["completed", "failed", "stopped"];

interface RunProgress {
  watchId: string;
  jobId: string;
  status: string;
  qualified: number;
  discovered: number;
}

/**
 * Saved-watches drawer — same list data and actions as the legacy panel
 * (run / delete), presented in a drawer so the hero viewport stays clean.
 */
function SavedWatchesDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listSignalWatches);
  const remove = useServerFn(deleteSignalWatch);
  const runOne = useServerFn(runSignalWatch);
  const getJob = useServerFn(getSearchJob);
  const projectsQ = useQuery({ queryKey: ["projects-list"], queryFn: () => listProjects() });
  const projectName = (id: string | null | undefined) =>
    id ? (projectsQ.data?.projects ?? []).find((p) => p.id === id)?.name ?? null : null;
  const q = useQuery({ queryKey: ["signal-watches"], queryFn: () => list() });

  // Run-now progress: runSignalWatch enqueues a durable job; this poller rides
  // getSearchJob until a terminal status, then reflects the outcome.
  const [runState, setRunState] = useState<RunProgress | null>(null);

  useEffect(() => {
    if (!runState) return;
    if (TERMINAL_JOB_STATUSES.includes(runState.status)) {
      if (runState.status === "completed") {
        toast.success(`${runState.qualified} matches found — new signals will be delivered`);
        qc.invalidateQueries({ queryKey: ["signal-watches"] });
      } else {
        toast.error("Watch run failed — check back later");
      }
      const t = window.setTimeout(() => setRunState(null), 4000);
      return () => window.clearTimeout(t);
    }
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const job = await getJob({ data: { id: runState.jobId } });
          if (job) {
            setRunState((s) =>
              s && s.jobId === job.id
                ? { ...s, status: job.status, qualified: job.qualified_count, discovered: job.discovered_count }
                : s,
            );
          }
        } catch {
          // transient — the next tick retries
        }
      })();
    }, 3000);
    return () => window.clearInterval(id);
  }, [runState, getJob, qc]);

  const runMut = useMutation({
    mutationFn: (id: string) => runOne({ data: { id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      if (res.error === "limit") {
        toast.error(res.message ?? "Search limit reached");
        return;
      }
      if (res.jobId) {
        setRunState({ watchId: res.id, jobId: res.jobId, status: res.status ?? "queued", qualified: 0, discovered: 0 });
        toast("Watch run queued");
      }
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-[#0a0a0b] text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-white">Saved watches</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {!q.data?.length && (
            <p className="text-xs text-white/50">No signal watches saved yet.</p>
          )}
          {q.data?.map((w: any) => {
            const icp = (w.icp || {}) as CampaignIcp;
            const changeMode = (w.change_mode || "new_entity") as "new_entity" | "new_signal";
            const channels: string[] = w.delivery?.channels ?? ["in_app"];
            const running = runState?.watchId === w.id;
            return (
              <div
                key={w.id}
                className="liquid-glass rounded-xl p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{w.name || w.query}</div>
                  <div className="text-xs text-white/50 mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span>{icp.schedule || "daily"}</span>
                    {w.project_id && projectName(w.project_id) && (
                      <span>· {projectName(w.project_id)}</span>
                    )}
                    {typeof icp.last_results_count === "number"
                      ? ` · last ${icp.last_results_count} new`
                      : ""}
                    {w.last_run_at ? ` · ran ${new Date(w.last_run_at).toLocaleString()}` : " · never run"}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                    <span
                      className={`rounded-full px-2 py-0.5 border ${
                        changeMode === "new_signal"
                          ? "border-amber-400/30 text-amber-300 bg-amber-400/10"
                          : "border-emerald-400/30 text-emerald-300 bg-emerald-400/10"
                      }`}
                    >
                      {changeMode === "new_signal" ? "new signal" : "new entity"}
                    </span>
                    {channels.map((c) => (
                      <span
                        key={c}
                        className="rounded-full px-2 py-0.5 border border-white/15 text-white/60 bg-white/[0.04]"
                      >
                        {c}
                      </span>
                    ))}
                    {running && (
                      <span className="rounded-full px-2 py-0.5 border border-sky-400/30 text-sky-300 bg-sky-400/10">
                        {runState!.status === "completed"
                          ? `done · ${runState!.qualified} matches`
                          : runState!.status === "queued"
                            ? "job queued"
                            : `running · found ${runState!.discovered}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={runMut.isPending || running}
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
      </SheetContent>
    </Sheet>
  );
}

/**
 * Watches hero takeover — the clock is the entry point. Q1 (what) → Q2
 * (when) → existing Save Watch call → confirmation. Clock motion never stops.
 */
export function WatchesHero() {
  const qc = useQueryClient();
  const create = useServerFn(createSignalWatch);
  const [step, setStep] = useState<Step>("idle");
  const [query, setQuery] = useState("");
  const [schedule, setSchedule] = useState<"daily" | "weekly">("daily");
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
  }, []);

  const openWizard = () => {
    setInlineError(null);
    setStep("q1");
  };

  const closeWizard = () => {
    // Answers are kept in state — reopening resumes where the user left off.
    setStep("idle");
    setInlineError(null);
  };

  const submitQ1 = () => {
    if (!query.trim()) return;
    setInlineError(null);
    setStep("q2");
  };

  const submitQ2 = async () => {
    if (saving) return;
    setSaving(true);
    setInlineError(null);
    try {
      // Identical call to the legacy form: same API, same field mapping.
      await create({ data: { query: query.trim(), schedule } });
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      toast.success("Signal watch saved");
      setStep("confirm");
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
      dismissTimer.current = window.setTimeout(() => setStep("idle"), 5000);
    } catch (e) {
      // Inline error, answers preserved for retry.
      setInlineError(e instanceof Error ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative h-full overflow-y-auto no-scrollbar bg-[#000000] text-white">
      {/* Contain framing: the whole clock face stays visible, never cropped. */}
      <HeroVideo src="/videos/watches-clock.mp4" fit="contain" className="opacity-60" />

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="View saved watches"
        className="absolute top-4 right-4 z-20 p-2.5 rounded-full border border-white/10 bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.1] transition-colors"
      >
        <Bell className="size-4" />
      </button>

      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-10 sm:px-6 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="text-3xl sm:text-4xl font-semibold tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.95)]"
        >
          Signal Watch
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.06 }}
          className="mt-3 rounded-full bg-black/55 px-4 py-1.5 text-sm text-white/85"
        >
          Click the watch. Tell it what to look for and when.
        </motion.p>

        <motion.button
          type="button"
          onClick={openWizard}
          aria-label="Set up a signal watch"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.12 }}
          className="glass-pill mt-8 inline-flex cursor-pointer items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20"
        >
          Enter <ArrowRight className="size-4" />
        </motion.button>

        <AnimatePresence mode="wait">
          {step !== "idle" && (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="mt-6 w-full max-w-md rounded-2xl border border-white/10 bg-black/75 p-5 text-left"
            >
              {step === "q1" && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">What are you watching for?</p>
                    <button
                      type="button"
                      onClick={closeWizard}
                      aria-label="Close"
                      className="p-1 rounded text-white/40 hover:text-white"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitQ1();
                    }}
                    placeholder={Q1_PLACEHOLDER}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={submitQ1}
                      disabled={!query.trim()}
                      className="glass-pill px-4 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {step === "q2" && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">When should I check?</p>
                    <button
                      type="button"
                      onClick={closeWizard}
                      aria-label="Close"
                      className="p-1 rounded text-white/40 hover:text-white"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <select
                    autoFocus
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value as "daily" | "weekly")}
                    className="mt-3 w-full rounded-lg border border-white/10 bg-[#131316] px-3 py-2.5 text-xs text-white outline-none focus:border-white/30"
                  >
                    <option value="daily">Daily Schedule</option>
                    <option value="weekly">Weekly Schedule</option>
                  </select>
                  {inlineError && <p className="mt-2 text-xs text-rose-400">{inlineError}</p>}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setInlineError(null);
                        setStep("q1");
                      }}
                      className="text-xs text-white/50 hover:text-white"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitQ2()}
                      disabled={saving}
                      className="glass-pill px-4 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20 disabled:opacity-40"
                    >
                      {saving ? "Saving…" : "Save Watch"}
                    </button>
                  </div>
                </div>
              )}

              {step === "confirm" && (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                    <Check className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Locked in.</p>
                    <p className="mt-1 text-xs text-white/70 break-words">
                      I&apos;ll check {schedule} for &ldquo;{query.trim()}&rdquo;.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <SavedWatchesDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
