import { useRef, useState } from "react";
import { Wand2, Upload, Link as LinkIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export type AddInfoPayload = {
  fileExcerpt: string;
  fileName: string;
  urlOrText: string;
};

type Props = {
  onGenerate: (payload: AddInfoPayload) => void;
  pending?: boolean;
};

/** Shared file-picker state so the card and pill variants stay identical. */
function useAddInfoFile() {
  const [fileName, setFileName] = useState("");
  const [fileExcerpt, setFileExcerpt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File over 5MB — pick a smaller file.");
      return;
    }
    setFileName(f.name);
    try {
      const text = await f.text();
      setFileExcerpt(text.slice(0, 1500));
    } catch {
      setFileExcerpt(`[Attached file: ${f.name}]`);
    }
  };

  return { fileName, fileExcerpt, fileRef, handleFile };
}

/**
 * Bare form body (upload + URL/text + Generate) with no outer card chrome —
 * used inside the Find card's Add Info dropdown.
 */
export function AddInfoForm({ onGenerate, pending }: Props) {
  const { fileName, fileExcerpt, fileRef, handleFile } = useAddInfoFile();
  const [urlOrText, setUrlOrText] = useState("");

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
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

      <div>
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

      <div className="sm:col-span-2 flex items-center gap-2">
        <Button
          type="button"
          disabled={pending || (!fileExcerpt && !urlOrText.trim())}
          onClick={() => onGenerate({ fileExcerpt, fileName, urlOrText: urlOrText.trim() })}
          className="ml-auto inline-flex items-center gap-1.5"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          Generate
        </Button>
      </div>
    </div>
  );
}
