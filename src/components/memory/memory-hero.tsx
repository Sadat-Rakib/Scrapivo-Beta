import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Check, Link as LinkIcon, Loader2, Upload, Wand2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAddInfoFile, type AddInfoPayload } from "@/components/discover/add-your-information";
import { HeroVideo, type HeroVideoHandle } from "@/components/hero-video";
import { listProjects, updateProject } from "@/lib/projects.functions";

type SaveState = "idle" | "processing" | "saved";

/**
 * Memory hero takeover — same generate/save behavior as the legacy panel,
 * only the trigger UI changed. The brain drifts in a slow ambient loop;
 * Generate speeds it into the "thinking" moment, then it settles back.
 * Footage stays dimmed ambience — content carries the focus.
 */
export function MemoryHero() {
  const qc = useQueryClient();
  const getProjects = useServerFn(listProjects);
  const patchProj = useServerFn(updateProject);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [urlOrText, setUrlOrText] = useState("");
  const { fileName, fileExcerpt, fileRef, handleFile } = useAddInfoFile();
  const videoRef = useRef<HeroVideoHandle>(null);
  const savedTimer = useRef<number | null>(null);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => getProjects() });
  const serverProjects = projectsQuery.data?.projects ?? [];
  const activeProject = serverProjects.find((p) => p.is_active) ?? serverProjects[0] ?? null;

  const hasInput = !!fileExcerpt || !!urlOrText.trim();

  const runSave = async (p: AddInfoPayload) => {
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
      toast.success("Saved — Scrapy will use this for future chats where applicable.");
      return true;
    } catch {
      toast.error("Could not save — try again.");
      return false;
    }
  };

  const handleGenerate = async () => {
    if (saveState === "processing") return;
    if (!hasInput) {
      toast.message("Add a file or a few lines first — then hit Generate.");
      return;
    }
    if (savedTimer.current) {
      window.clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
    setSaveState("processing");
    // "Boom, it's thinking" — footage speeds up as the save runs.
    videoRef.current?.setRate(1.25);
    videoRef.current?.play();
    const ok = await runSave({
      fileExcerpt,
      fileName,
      urlOrText: urlOrText.trim(),
    });
    if (ok) {
      setSaveState("saved");
      // Settle back into the slow ambient drift (rate prop eases it down).
      videoRef.current?.play();
      savedTimer.current = window.setTimeout(() => setSaveState("idle"), 2600);
    } else {
      // Never leave motion running over a failed state.
      videoRef.current?.pause();
      setSaveState("idle");
    }
  };

  return (
    <div className="relative h-full overflow-y-auto no-scrollbar bg-[#000000] text-white">
      <HeroVideo
        ref={videoRef}
        src="/videos/memory-brain-network.mp4"
        rate={saveState === "processing" ? 1.25 : 0.45}
        className="opacity-60"
      />
      {/* Darken the middle so overlay text reads over bright dots. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.62)_0%,rgba(0,0,0,0.25)_55%,transparent_80%)]" />

      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-10 sm:px-6 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="text-3xl sm:text-4xl font-semibold tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.95)]"
        >
          Scrapy Brain
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.06 }}
          className="mt-3 max-w-full rounded-full bg-black/55 px-4 py-1.5 text-sm text-white/85"
        >
          Tell me once — I&apos;ll use it in every future chat.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.12 }}
          className="mt-8 grid w-full gap-3 sm:grid-cols-2 text-left"
        >
          <div className="rounded-2xl border border-white/10 bg-black/65 p-4">
            <div className="text-xs font-medium text-white/75 mb-1.5 flex items-center gap-1.5">
              <Upload className="size-3.5" /> Upload Information
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.json"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2.5 text-xs text-white/75 hover:bg-white/[0.12] transition-colors"
            >
              {fileName || "Upload portfolio, resume, deck…"}
            </button>
            <p className="text-[11px] text-white/40 mt-1">PDF, DOCX, TXT, MD, CSV, JSON · max 5MB</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/65 p-4">
            <div className="text-xs font-medium text-white/75 mb-1.5 flex items-center gap-1.5">
              <LinkIcon className="size-3.5" /> Input Your Information
            </div>
            <Textarea
              value={urlOrText}
              onChange={(e) => setUrlOrText(e.target.value.slice(0, 2000))}
              placeholder="yourcompany.com or a few lines about what you do…"
              rows={2}
              className="resize-none border-white/15 bg-white/[0.06] text-sm text-white placeholder:text-white/40"
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.18 }}
          className="mt-6"
        >
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={saveState === "processing"}
            className="inline-flex items-center gap-1.5 px-6"
          >
            {saveState === "processing" ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Processing…
              </>
            ) : saveState === "saved" ? (
              <>
                <Check className="size-4" /> Saved
              </>
            ) : (
              <>
                <Wand2 className="size-4" /> Generate
              </>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
