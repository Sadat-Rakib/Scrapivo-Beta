import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";
import {
  ArrowUp,
  Loader2,
  Plus,
  Brain,
  ChevronDown,
  Check,
  Zap,
  Flame,
  Sparkles,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "@/components/voice-input-button";
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
  { value: "scrapy", label: "Scrapy", hint: "Fast everyday search", icon: Sparkles },
  { value: "insane", label: "Scrapy Insane", hint: "Deeper sources, more leads", icon: Zap },
  { value: "crazy", label: "Scrapy Crazy", hint: "Maximum-depth hunt", icon: Flame },
];

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
const pillActive =
  "border-white/40 bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]";

export const UnifiedComposer = forwardRef<ComposerHandle, Props>(function UnifiedComposer(
  {
    value,
    onChange,
    mode,
    onModeChange,
    onSubmit,
    pending,
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
  const tierMenuRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => textRef.current?.focus() }));

  // Close the Mode menu on outside click / Escape.
  useEffect(() => {
    if (!tierOpen) return;
    const onDown = (e: MouseEvent) => {
      if (tierMenuRef.current && !tierMenuRef.current.contains(e.target as Node)) {
        setTierOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTierOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tierOpen]);

  const submit = () => {
    if (pending || !value.trim()) return;
    onSubmit();
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

      <div
        data-tour="composer-controls"
        className="mt-1 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-1"
      >
        {/* Attach */}
        <button
          type="button"
          aria-label="Attach context"
          title="Attach context"
          onClick={() =>
            toast.message("Attachments are coming soon — describe context in words for now.")
          }
          className="size-8 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl flex items-center justify-center text-white/75 hover:bg-white/[0.12] hover:text-white transition-all shrink-0"
        >
          <Plus className="size-4" />
        </button>

        {/* Mode selector */}
        <div ref={tierMenuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Search mode"
            aria-expanded={tierOpen}
            onClick={() => setTierOpen((o) => !o)}
            className={`${pillBase} ${tierOpen ? pillActive : ""}`}
          >
            <ActiveTierIcon className="size-3.5" />
            <span>Mode: {activeTier.label}</span>
            <ChevronDown
              className={`size-3.5 transition-transform ${tierOpen ? "rotate-180" : ""}`}
            />
          </button>
          {tierOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl border border-white/15 bg-[#141418]/95 backdrop-blur-xl shadow-2xl p-1.5 z-50">
              {TIERS.map(({ value: v, label, hint, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    onTierChange?.(v);
                    setTierOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                    v === tier ? "bg-white/10" : "hover:bg-white/[0.06]"
                  }`}
                >
                  <Icon className="size-4 text-white/70 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-white">{label}</span>
                    <span className="block text-[11px] text-white/50">{hint}</span>
                  </span>
                  {v === tier && <Check className="size-4 text-white shrink-0" />}
                </button>
              ))}
            </div>
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

        {/* Voice */}
        <span className="shrink-0 inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl text-white/75 hover:bg-white/[0.12] hover:text-white transition-all [&_button]:size-8 [&_button]:text-white/75 [&_button:hover]:!bg-transparent [&_button:hover]:!text-white">
          <VoiceInputButton
            onResult={(t) => {
              const next = value.trim() ? `${value.trim()} ${t}` : t;
              onChange(next.slice(0, maxChars));
            }}
          />
        </span>

        <div className="flex-1" />

        {/* Submit */}
        <button
          onClick={submit}
          disabled={pending || !value.trim()}
          aria-label="Send"
          className="size-9 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-[0_4px_16px_rgba(255,255,255,0.25)]"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
    </div>
  );
});
