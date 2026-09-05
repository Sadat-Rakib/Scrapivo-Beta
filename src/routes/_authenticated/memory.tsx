import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects, updateProject } from "@/lib/projects.functions";
import { AddInfoForm, type AddInfoPayload } from "@/components/discover/add-your-information";
import { Brain, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/memory")({
  head: () => ({
    meta: [{ title: "Scrapivo — Memory" }],
  }),
  component: MemoryPage,
});

type LocalBackup = { fileName: string; fileExcerpt: string; urlOrText: string; at: string };

function readLocalBackup(): LocalBackup | null {
  try {
    const raw = localStorage.getItem("scrapivo:user-info");
    return raw ? (JSON.parse(raw) as LocalBackup) : null;
  } catch {
    return null;
  }
}

function MemoryPage() {
  const qc = useQueryClient();
  const getProjects = useServerFn(listProjects);
  const patchProj = useServerFn(updateProject);
  const [saving, setSaving] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => getProjects() });
  const serverProjects = projectsQuery.data?.projects ?? [];
  const activeProject = serverProjects.find((p) => p.is_active) ?? serverProjects[0] ?? null;

  const backup = typeof window !== "undefined" && localVersion >= 0 ? readLocalBackup() : null;
  const savedWebsite =
    activeProject?.website || (backup?.urlOrText?.startsWith("http") ? backup.urlOrText : "");
  const savedAbout =
    activeProject?.about_doc ||
    [backup?.fileName ? `[File: ${backup.fileName}]` : "", backup?.fileExcerpt, backup?.urlOrText]
      .filter(Boolean)
      .join("\n\n");

  const handleGenerate = async (p: AddInfoPayload) => {
    setSaving(true);
    try {
      try {
        localStorage.setItem(
          "scrapivo:user-info",
          JSON.stringify({ ...p, at: new Date().toISOString() }),
        );
      } catch {
        // Private-mode storage may throw — server save still runs below.
      }
      const isUrl = /^https?:\/\//i.test(p.urlOrText.trim());
      const about = [
        p.fileName ? `[File: ${p.fileName}]` : "",
        p.fileExcerpt,
        !isUrl ? p.urlOrText : "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8000);
      if (activeProject && activeProject.id !== "local") {
        await patchProj({
          data: {
            id: activeProject.id,
            ...(isUrl ? { website: p.urlOrText.slice(0, 200) } : {}),
            ...(about ? { about_doc: about } : {}),
          },
        });
        qc.invalidateQueries({ queryKey: ["projects"] });
      }
      setLocalVersion((v) => v + 1);
      toast.success("Saved — Scrapy will use this for future chats where applicable.");
    } catch {
      toast.error("Could not save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      localStorage.removeItem("scrapivo:user-info");
      if (activeProject && activeProject.id !== "local") {
        await patchProj({ data: { id: activeProject.id, website: "", about_doc: "" } });
        qc.invalidateQueries({ queryKey: ["projects"] });
      }
      setLocalVersion((v) => v + 1);
      toast.success("Memory cleared.");
    } catch {
      toast.error("Could not clear — try again.");
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-4 text-white">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
          <Brain className="size-3.5" />
          <span>Personalize</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Memory</h1>
        <p className="text-xs text-white/60 mt-1 leading-relaxed">
          Scrapy understands your information and uses it for future chats where applicable — you
          won't get asked twice for what's already here.
        </p>
      </div>

      <div className="liquid-glass rounded-2xl p-4 sm:p-5">
        <AddInfoForm onGenerate={(p) => void handleGenerate(p)} pending={saving} />
      </div>

      {(savedWebsite || savedAbout) && (
        <div className="liquid-glass rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Saved memory</h2>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void handleClear()}
            >
              <Trash2 className="size-3 mr-1" /> Clear
            </Button>
          </div>
          {savedWebsite && (
            <p className="text-xs text-white/75 mt-3 break-all">
              <span className="text-white/40">Website: </span>
              {savedWebsite}
            </p>
          )}
          {savedAbout && (
            <p className="text-xs text-white/60 mt-2 leading-relaxed whitespace-pre-wrap break-words line-clamp-6">
              {savedAbout}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
