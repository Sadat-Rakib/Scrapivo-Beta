import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";
import { Send, Loader2, Search, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "@/components/voice-input-button";

export type ComposerMode = "search" | "chat";

export type ComposerHandle = { focus: () => void };

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode: ComposerMode;
  onModeChange: (m: ComposerMode) => void;
  onSubmit: () => void;
  pending: boolean;
  maxChars?: number;
  /** Hide the Search/Chat pills for search-only contexts (directory pages). */
  hideModeToggle?: boolean;
};

const AUTOTYPE_EXAMPLES = [
  "businesses looking for web development services…",
  "companies searching for marketing agencies…",
  "startups expanding into new markets…",
  "HVAC businesses with an online presence but no website…",
  "investors backing pre-seed startups…",
];

function useAutotypePlaceholder(paused: boolean) {
  const [text, setText] = useState("");
  const stateRef = useRef({
    index: 0,
    charIndex: 0,
    isDeleting: false,
    isDwell: false,
  });

  useEffect(() => {
    if (paused) return;

    let timeoutId: number;

    const tick = () => {
      const state = stateRef.current;
      const currentString = AUTOTYPE_EXAMPLES[state.index];

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
            state.index = (state.index + 1) % AUTOTYPE_EXAMPLES.length;
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
  }, [paused]);

  return text || "Search...";
}

export const UnifiedComposer = forwardRef<ComposerHandle, Props>(function UnifiedComposer(
  { value, onChange, mode, onModeChange, onSubmit, pending, maxChars = 3000, hideModeToggle },
  ref,
) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => textRef.current?.focus() }));

  const submit = () => {
    if (pending || !value.trim()) return;
    onSubmit();
  };

  const isPaused = focused || value.trim().length > 0;
  const autotypeText = useAutotypePlaceholder(isPaused);

  const placeholder = mode === "search" ? autotypeText : "Ask Scrapivo to help you craft a search…";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-start gap-2 p-3">
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
          className="min-h-9 max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 px-2 py-1.5 text-sm"
        />
        <button
          onClick={submit}
          disabled={pending || !value.trim()}
          aria-label="Send"
          className="size-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          {!hideModeToggle && (
            <div className="inline-flex rounded-full border border-border p-0.5">
              <button
                onClick={() => onModeChange("search")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors ${
                  mode === "search"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                <Search className="size-3" /> Search
              </button>
              <button
                onClick={() => onModeChange("chat")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors ${
                  mode === "chat"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                <Sparkles className="size-3" /> Chat
              </button>
            </div>
          )}
          <VoiceInputButton
            onResult={(t) => {
              const next = value.trim() ? `${value.trim()} ${t}` : t;
              onChange(next.slice(0, maxChars));
            }}
          />
        </div>
      </div>
    </div>
  );
});
