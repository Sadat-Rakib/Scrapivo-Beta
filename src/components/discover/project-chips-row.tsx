// WS3: compact project chips above the Discover composer. Shows nothing when
// the user has no projects (mascot hero stays untouched). Chips navigate to
// the project page — search-launch wiring passes projectId at the parent.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FolderKanban } from "lucide-react";
import { getProjectsOverview } from "@/lib/projects.functions";

type OverviewProject = {
  id: string;
  name: string;
  stats: { lists: number; savedSearches: number; prospects: number };
};

export function ProjectChipsRow() {
  const getOverview = useServerFn(getProjectsOverview);
  const q = useQuery({ queryKey: ["projects-overview"], queryFn: () => getOverview() });
  const projects = ((q.data?.projects ?? []) as unknown) as OverviewProject[];
  if (!projects.length) return null;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {projects.slice(0, 5).map((p) => (
          <Link
            key={p.id}
            to="/projects/$projectId"
            params={{ projectId: p.id }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-white"
          >
            <FolderKanban className="size-3" />
            <span className="max-w-[140px] truncate">{p.name}</span>
            <span className="text-white/40">{p.stats.prospects}</span>
          </Link>
        ))}
        {projects.length > 5 ? (
          <Link
            to="/projects"
            className="text-[11px] text-white/50 hover:text-white px-1"
          >
            +{projects.length - 5} more
          </Link>
        ) : null}
      </div>
    </div>
  );
}
