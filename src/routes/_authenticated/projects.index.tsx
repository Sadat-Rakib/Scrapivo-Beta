import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { FolderKanban, Plus, Trash2 } from "lucide-react";
import { deleteProject, getProjectsOverview, createProject } from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [{ title: "Scrapivo — Projects" }],
  }),
  component: ProjectsPage,
});

type OverviewProject = {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  status: string | null;
  stats: { lists: number; savedSearches: number; prospects: number };
};

function ProjectsPage() {
  const qc = useQueryClient();
  const getOverview = useServerFn(getProjectsOverview);
  const create = useServerFn(createProject);
  const remove = useServerFn(deleteProject);
  const q = useQuery({ queryKey: ["projects-overview"], queryFn: () => getOverview() });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Project created");
      setDialogOpen(false);
      setName("");
      setDescription("");
      setPurpose("");
      void qc.invalidateQueries({ queryKey: ["projects-overview"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Optimistic delete: drop the card from the cache immediately, roll back on
  // error, then re-sync with the server (the row is soft-archived there).
  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["projects-overview"] });
      const prev = qc.getQueryData(["projects-overview"]);
      qc.setQueryData(["projects-overview"], (old: unknown) => {
        const o = old as { projects: OverviewProject[]; needs_migration: boolean } | undefined;
        if (!o) return old;
        return { ...o, projects: o.projects.filter((p) => p.id !== id) };
      });
      return { prev };
    },
    onError: (e: Error, _id: string, ctx: { prev: unknown } | undefined) => {
      if (ctx?.prev) qc.setQueryData(["projects-overview"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: () => {
      toast.success("Project deleted");
      void qc.invalidateQueries({ queryKey: ["projects-overview"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const projects = ((q.data?.projects ?? []) as unknown) as OverviewProject[];
  const needsMigration = q.data?.needs_migration === true;

  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6 text-white">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
          <FolderKanban className="size-3.5" />
          <span>Research Context</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-xs text-white/60 mt-1">
          Each project carries its own research context — offer, geographies, exclusions — so
          searches start smarter.
        </p>
      </div>

      {needsMigration && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          The projects tables are not migrated yet — run the latest Supabase migration.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-6 min-h-[9rem] flex flex-col items-center justify-center gap-2 text-white/60 hover:text-white hover:border-white/30 transition-colors"
            >
              <Plus className="size-6" />
              <span className="text-xs font-semibold">New Project</span>
            </button>
          </DialogTrigger>
          <DialogContent className="bg-[#101014] border-white/10 text-white">
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription className="text-white/50">
                Name it now; add offer, geographies and ICPs on the next screen.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name (e.g. Agency outreach)"
                className="bg-white/[0.04] border-white/10"
              />
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description — what is this project about? (optional)"
                className="bg-white/[0.04] border-white/10 min-h-[70px]"
              />
              <Textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Purpose — what will you do with the leads? (optional)"
                className="bg-white/[0.04] border-white/10 min-h-[70px]"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                disabled={!name.trim() || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="bg-white/15 hover:bg-white/25 text-white border-white/20"
              >
                {createMut.isPending ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {projects.map((p) => (
          <div
            key={p.id}
            className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-5 min-h-[9rem] flex flex-col justify-between hover:border-white/25 hover:bg-white/[0.07] transition-colors"
          >
            <Link
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="absolute inset-0 z-0"
              aria-label={`Open ${p.name}`}
            >
              <span className="sr-only">{p.name}</span>
            </Link>
            <div className="relative">
              <div className="text-sm font-semibold truncate">{p.name}</div>
              {p.description ? (
                <p className="text-[11px] text-white/50 mt-1 line-clamp-2">{p.description}</p>
              ) : null}
            </div>
            <div className="relative flex gap-3 text-[10px] text-white/50 mt-3">
              <span>{p.stats.prospects} prospects</span>
              <span>{p.stats.lists} lists</span>
              <span>{p.stats.savedSearches} saved searches</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${p.name}"? Its lists, saved searches and stats stay archived with it.`,
                  )
                ) {
                  delMut.mutate(p.id);
                }
              }}
              disabled={delMut.isPending}
              aria-label={`Delete ${p.name}`}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-white/40 hover:text-rose-400 hover:bg-white/10 transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      {!q.isLoading && projects.length === 0 && !needsMigration && (
        <p className="text-xs text-white/40">
          No projects yet — create one to give your searches standing context.
        </p>
      )}
    </div>
  );
}
