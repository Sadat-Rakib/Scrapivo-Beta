import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createSignalWatch,
  deleteSignalWatch,
  listSignalWatches,
  runDueSignalWatches,
  runSignalWatch,
  type CampaignIcp,
} from "@/lib/campaigns.functions";
import { Button } from "@/components/ui/button";
import { Bell, Play, Trash2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/watches")({
  component: WatchesPage,
});

function WatchesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listSignalWatches);
  const create = useServerFn(createSignalWatch);
  const remove = useServerFn(deleteSignalWatch);
  const runOne = useServerFn(runSignalWatch);
  const runDue = useServerFn(runDueSignalWatches);

  const [newQuery, setNewQuery] = useState("");
  const [schedule, setSchedule] = useState<"daily" | "weekly">("daily");

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
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (res.error === "limit") {
        toast.error(res.message ?? "Search limit reached");
        return;
      }
      toast.success(`${res.results_count} leads for this signal`);
      if (res.leads?.length) {
        navigate({ to: "/discover" });
      }
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

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight mb-1">Signal watches</h1>
          <p className="text-sm text-muted-foreground">
            Save plain-English buying signals and re-run them on a schedule. Outreach stays draft-only — nothing is sent automatically.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dueMut.mutate()}
          disabled={dueMut.isPending}
        >
          <RefreshCw className={`size-3.5 mr-1.5 ${dueMut.isPending ? "animate-spin" : ""}`} />
          Run due
        </Button>
      </div>

      <form
        className="rounded-xl border border-border bg-card p-4 space-y-3 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newQuery.trim()) return;
          createMut.mutate();
        }}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Bell className="size-3.5" /> New watch
        </div>
        <input
          value={newQuery}
          onChange={(e) => setNewQuery(e.target.value)}
          placeholder='e.g. Currently hiring 3+ engineers with experience in Next.js'
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center justify-between gap-3">
          <select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as "daily" | "weekly")}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <Button type="submit" size="sm" disabled={createMut.isPending || !newQuery.trim()}>
            Save watch
          </Button>
        </div>
      </form>

      {!q.data?.length && (
        <div className="text-sm text-muted-foreground">
          No watches yet. Save a signal from Discover or create one above.
        </div>
      )}

      <div className="space-y-2">
        {q.data?.map((w: any) => {
          const icp = (w.icp || {}) as CampaignIcp;
          return (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{w.name || w.query}</div>
                <div className="text-xs text-muted-foreground">
                  {icp.schedule || "daily"}
                  {icp.signal_family ? ` · ${icp.signal_family}` : ""}
                  {typeof icp.last_results_count === "number"
                    ? ` · last ${icp.last_results_count} leads`
                    : ""}
                  {w.last_run_at
                    ? ` · ran ${new Date(w.last_run_at).toLocaleString()}`
                    : " · never run"}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={runMut.isPending}
                  onClick={() => runMut.mutate(w.id)}
                >
                  <Play className="size-3.5 mr-1" /> Run
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => delMut.mutate(w.id)}
                  disabled={delMut.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
