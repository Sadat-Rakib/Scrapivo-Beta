import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Square,
  Loader2,
  Plus,
  Brain,
  ChevronDown,
  Check,
  Zap,
  Flame,
  Sparkles,
  X,
  ImagePlus,
  FileUp,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "@/components/voice-input-button";
import { mySupabase } from "@/integrations/my-supabase/client";
import {
  createAttachmentDerivativeUpload,
  createAttachmentUpload,
} from "@/lib/attachments/attachment-functions";
import { toast } from "sonner";

export type ComposerMode = "search" | "chat";

/** Search-intensity tiers for Scrapy's search behavior. */
export type SearchTier = "scrapy" | "insane" | "crazy";

export type ComposerHandle = { focus: () => void };

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode: ComposerMode;
  onModeChange: (m: ComposerMode) => void;
  onSubmit: () => void;
  /** Stage 1: structured attachments (registry ids) staged for the next
   *  submit. Called synchronously before onSubmit so the parent can consume
   *  them atomically with the text. */
  onSubmitAttachments?: (attachments: Array<{ attachmentId: string }>) => void;
  /** While pending, the submit button becomes Stop (PRD V2 WS5): the composer
   *  is the single stop affordance — stable, reachable, always clickable. */
  onStop?: () => void;
  pending: boolean;
  maxChars?: number;
  /** Legacy: the Search/Chat toggle UI was removed (Mode + Thinker replace it).
   *  Kept so existing callers don't break; the mode prop still routes submit. */
  hideModeToggle?: boolean;
  /** Search-intensity tier (controlled by the parent). */
  tier?: SearchTier;
  onTierChange?: (t: SearchTier) => void;
  /** Extended-thinking mode (controlled by the parent). */
  thinker?: boolean;
  onThinkerChange?: (v: boolean) => void;
  /** Page-specific autotype examples (directory pages); defaults to the
   *  cross-domain Discover list so the home page is untouched. */
  examples?: string[];
};

const DEFAULT_EXAMPLES = [
  "find me SaaS founders in NY rn",
  "asap find local HVAC companies without a website",
  "companies hiring engineers this quarter…",
  "investors backing pre-seed AI startups rn…",
  "plumbers in Austin with no web presence asap…",
];

const TIERS: Array<{ value: SearchTier; label: string; hint: string; icon: typeof Zap }> = [
  { value: "scrapy", label: "Scrapy Okay", hint: "Fast everyday search", icon: Sparkles },
  { value: "insane", label: "Scrapy Insane", hint: "Deeper sources, more leads", icon: Zap },
  { value: "crazy", label: "Scrapy Crazy", hint: "Maximum-depth hunt", icon: Flame },
];

type ComposerAttachment = { id: string; name: string; uploaded: boolean };

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp";
const FILE_ACCEPT = ".txt,.md,.csv,.json,.log,.pdf";

/**
 * Popup menu rendered in a portal, anchored above (or below when there is no
 * headroom) the trigger button. Portal rendering is required: the composer
 * controls row is `overflow-x-auto`, which clips any absolutely-positioned
 * popup built inline inside it.
 */
function AnchoredMenu({
  triggerRef,
  onClose,
  children,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(240, window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      if (r.top > 300) {
        setStyle({ position: "fixed", left, bottom: window.innerHeight - r.top + 8, width });
      } else {
        setStyle({ position: "fixed", left, top: r.bottom + 8, width });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [triggerRef, onClose]);

  if (typeof document === "undefined" || !style) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="rounded-2xl border border-white/15 bg-[#141418]/95 backdrop-blur-xl shadow-2xl p-1.5"
      style={{ ...style, zIndex: 120 }}
    >
      {children}
    </div>,
    document.body,
  );
}

function useAutotypePlaceholder(paused: boolean, examples: string[]) {
  const [text, setText] = useState("");
  const stateRef = useRef({
    index: 0,
    charIndex: 0,
    isDeleting: false,
    isDwell: false,
  });

  useEffect(() => {
    if (paused || examples.length === 0) return;

    let timeoutId: number;

    const tick = () => {
      const state = stateRef.current;
      const currentString = examples[state.index % examples.length];

      if (state.isDwell) {
        timeoutId = window.setTimeout(() => {
          state.isDwell = false;
          state.isDeleting = true;
          tick();
        }, 2500);
        return;
      }

      if (state.isDeleting) {
        timeoutId = window.setTimeout(() => {
          state.charIndex--;
          setText(currentString.substring(0, state.charIndex));
          if (state.charIndex <= 0) {
            state.isDeleting = false;
            state.index = (state.index + 1) % examples.length;
          }
          tick();
        }, 20); // fast backspace
      } else {
        timeoutId = window.setTimeout(() => {
          state.charIndex++;
          setText(currentString.substring(0, state.charIndex));
          if (state.charIndex >= currentString.length) {
            state.isDwell = true;
          }
          tick();
        }, 35); // typing speed
      }
    };

    tick();

    return () => clearTimeout(timeoutId);
  }, [paused, examples]);

  return text || "Search...";
}

const pillBase =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl px-3 py-1.5 text-xs font-medium text-white/75 hover:bg-white/[0.12] hover:text-white transition-all shrink-0";
// Prominent active state: bright fill + glow ring so selection reads instantly.
const pillActive =
  "border-white/60 bg-white/[0.22] text-white shadow-[0_0_18px_rgba(255,255,255,0.28),inset_0_1px_0_rgba(255,255,255,0.4)]";
const tierRowActive =
  "bg-white/[0.14] border border-white/30 shadow-[0_0_14px_rgba(255,255,255,0.18)]";

export const UnifiedComposer = forwardRef<ComposerHandle, Props>(function UnifiedComposer(
  {
    value,
    onChange,
    mode,
    onModeChange,
    onSubmit,
    onSubmitAttachments,
    pending,
  onStop,
    maxChars = 3000,
    tier = "scrapy",
    onTierChange,
    thinker = false,
    onThinkerChange,
    examples = DEFAULT_EXAMPLES,
  },
  ref,
) {
  void onModeChange;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const tierTriggerRef = useRef<HTMLButtonElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => textRef.current?.focus() }));

  const openPicker = (accept: string) => {
    setAddOpen(false);
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  };

  const submit = () => {
    if (pending) return;
    // Stage 1 submit contract: non-empty text OR at least one successfully
    // uploaded attachment. A chip only exists after upload + registration
    // succeeded, so "uploaded" here means the server can actually read it.
    if (!value.trim() && !attachments.some((a) => a.uploaded)) return;
    onSubmitAttachments?.(attachments.filter((a) => a.uploaded).map((a) => ({ attachmentId: a.id })));
    onSubmit();
    // Attachments are sent as structured ids; reset chips.
    setAttachments([]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const { data } = await mySupabase.auth.getUser();
      const userId = data.user?.id ?? "anon";
      const nextAttachments: ComposerAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`"${file.name}" is over 5MB — pick a smaller file.`);
          continue;
        }
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const safeName = sanitizeFileName(file.name);
        // Stage-1 upload: the server validates the descriptor, builds the
        // object path from the SESSION user's id, and returns a short-lived
        // signed upload URL. If the ticket fails, the attachment is NOT
        // included — we never claim an attachment will be understood when its
        // content is unreachable.
        try {
          const ticket = await createAttachmentUpload({
            data: { attachmentId: id, name: safeName, mime: file.type, size: file.size },
          });
          if (!ticket.ok) throw new Error(ticket.reason);
          const put = await fetch(ticket.signedUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type || "application/octet-stream" },
          });
          if (!put.ok) throw new Error(`upload failed: ${put.status}`);
          // Scanned-PDF pre-pass (client-side rendering): low-text pages of a
          // PDF become authenticated image derivatives so server-side vision
          // can read them. Text PDFs skip this entirely.
          if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
            try {
              // Client-only + heavy: lazy-loaded on first PDF attach.
              const { renderLowTextPages } = await import("@/lib/attachments/pdf-prepass.browser");
              const baseName = safeName.replace(/\.pdf$/i, "");
              const derivatives = await renderLowTextPages(file, baseName);
              for (const d of derivatives) {
                const derId =
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const derTicket = await createAttachmentDerivativeUpload({
                  data: {
                    attachmentId: derId,
                    parentAttachmentId: id,
                    name: d.name,
                    mime: "image/jpeg",
                    size: d.blob.size,
                  },
                });
                if (!derTicket.ok) throw new Error(derTicket.reason);
                const derPut = await fetch(derTicket.signedUrl, {
                  method: "PUT",
                  body: d.blob,
                  headers: { "Content-Type": "image/jpeg" },
                });
                if (!derPut.ok) throw new Error(`derivative upload failed: ${derPut.status}`);
              }
              if (derivatives.length > 0) {
                toast.message(
                  `Scanned PDF detected — ${derivatives.length} page image${derivatives.length === 1 ? "" : "s"} prepared for reading.`,
                );
              }
            } catch (derError) {
              console.error("[composer] scanned-PDF derivatives unavailable", derError);
              toast.message("Scanned-PDF page images couldn't be prepared — text reading only.");
            }
          }
        } catch (e) {
          console.error("[composer] attachment unavailable", e);
          toast.error(
            `"${safeName}" could not be uploaded — it will NOT be included in this search. Remove it or retry.`,
          );
          continue;
        }
        nextAttachments.push({ id, name: safeName, uploaded: true });
      }
      if (nextAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...nextAttachments]);
        toast.message(
          nextAttachments.length === 1
            ? `Attached ${nextAttachments[0].name} — Stage 1 will read it.`
            : `Attached ${nextAttachments.length} files — Stage 1 will read them.`,
        );
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const isPaused = focused || value.trim().length > 0;
  const autotypeText = useAutotypePlaceholder(isPaused, examples);

  const placeholder = mode === "search" ? autotypeText : "Ask Scrapivo to help you craft a search…";
  const activeTier = TIERS.find((t) => t.value === tier) ?? TIERS[0];
  const ActiveTierIcon = activeTier.icon;

  return (
    <div className="liquid-glass rounded-[24px] p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <Textarea
          ref={textRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxChars))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="min-h-9 max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 px-2 py-1.5 text-sm text-white placeholder:text-white/40"
        />
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/[0.1] pl-3 pr-1.5 py-1 text-[11px] text-white/85"
            >
              <span className="max-w-40 truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAttachment(a.id)}
                className="size-4 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        data-tour="composer-controls"
        className="mt-1 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-1"
      >
        {/* Attach */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={`${IMAGE_ACCEPT},${FILE_ACCEPT}`}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          ref={addTriggerRef}
          type="button"
          aria-label="Add attachment"
          aria-expanded={addOpen}
          title="Add images or files as search context"
          disabled={uploading}
          onClick={() => setAddOpen((o) => !o)}
          className="size-8 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl flex items-center justify-center text-white/75 hover:bg-white/[0.12] hover:text-white transition-all shrink-0 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </button>
        {addOpen && (
          <AnchoredMenu triggerRef={addTriggerRef} onClose={() => setAddOpen(false)}>
            <button
              type="button"
              role="menuitem"
              onClick={() => openPicker(IMAGE_ACCEPT)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors hover:bg-white/[0.08]"
            >
              <ImagePlus className="size-4 text-white/70 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-white">Add images</span>
                <span className="block text-[11px] text-white/50">Photos and screenshots</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => openPicker(FILE_ACCEPT)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors hover:bg-white/[0.08]"
            >
              <FileUp className="size-4 text-white/70 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-white">Add files</span>
                <span className="block text-[11px] text-white/50">Docs, text, and data</span>
              </span>
            </button>
          </AnchoredMenu>
        )}

        {/* Mode selector */}
        <div className="shrink-0">
          <button
            ref={tierTriggerRef}
            type="button"
            aria-label="Search mode"
            aria-expanded={tierOpen}
            onClick={() => setTierOpen((o) => !o)}
            className={`${pillBase} ${tierOpen || tier !== "scrapy" ? pillActive : ""}`}
          >
            <ActiveTierIcon className="size-3.5" />
            <span>{tier === "scrapy" ? "Mode" : `Mode · ${activeTier.label}`}</span>
            <ChevronDown
              className={`size-3.5 transition-transform ${tierOpen ? "rotate-180" : ""}`}
            />
          </button>
          {tierOpen && (
            <AnchoredMenu triggerRef={tierTriggerRef} onClose={() => setTierOpen(false)}>
              {TIERS.map(({ value: v, label, hint, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={v === tier}
                  onClick={() => {
                    onTierChange?.(v);
                    setTierOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                    v === tier ? tierRowActive : "border border-transparent hover:bg-white/[0.06]"
                  }`}
                >
                  <Icon
                    className={`size-4 shrink-0 ${v === tier ? "text-white" : "text-white/70"}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-white">{label}</span>
                    <span className="block text-[11px] text-white/50">{hint}</span>
                  </span>
                  {v === tier && <Check className="size-4 text-white shrink-0" />}
                </button>
              ))}
            </AnchoredMenu>
          )}
        </div>

        {/* Thinker toggle */}
        <button
          type="button"
          aria-pressed={thinker}
          title="Extended thinking mode"
          onClick={() => onThinkerChange?.(!thinker)}
          className={`${pillBase} ${thinker ? pillActive : ""}`}
        >
          <Brain className="size-3.5" />
          <span>Thinker</span>
        </button>

        <div className="flex-1" />

        {/* Voice — beside submit */}
        <span className="shrink-0 inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl text-white/75 hover:bg-white/[0.12] hover:text-white transition-all [&_button]:size-9 [&_button]:rounded-full [&_button]:text-white/75 [&_button:hover]:!bg-transparent [&_button:hover]:!text-white">
          <VoiceInputButton
            onResult={(t) => {
              const next = value.trim() ? `${value.trim()} ${t}` : t;
              onChange(next.slice(0, maxChars));
            }}
          />
        </span>

        {/* Submit — becomes Stop while a run is active (PRD V2 WS5). */}
        {pending && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop search"
            title="Stop search"
            className="size-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90 transition-all shrink-0 shadow-[0_4px_16px_rgba(255,255,255,0.25)]"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={pending || !value.trim()}
            aria-label="Send"
            className="size-9 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-[0_4px_16px_rgba(255,255,255,0.25)]"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );
});
