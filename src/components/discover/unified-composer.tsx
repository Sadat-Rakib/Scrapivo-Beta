import { useRef, useImperativeHandle, forwardRef } from "react";
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
};

export const UnifiedComposer = forwardRef<ComposerHandle, Props>(function UnifiedComposer(
  { value, onChange, mode, onModeChange, onSubmit, pending, maxChars = 3000 },
  ref,
) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textRef.current?.focus() }));

  const submit = () => {
    if (pending || !value.trim()) return;
    onSubmit();
  };

  const placeholder =
    mode === "search"
      ? "Buying signal or skill… e.g. Currently hiring Next.js engineers / marketing agencies in India"
      : "Ask Scrapivo to help you craft a search…";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-start gap-2 p-3">
        <Textarea
          ref={textRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxChars))}
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
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="inline-flex rounded-full border border-border p-0.5">
            <button
              onClick={() => onModeChange("search")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors ${
                mode === "search" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Search className="size-3" /> Search
            </button>
            <button
              onClick={() => onModeChange("chat")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors ${
                mode === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Sparkles className="size-3" /> Chat
            </button>
          </div>
          <VoiceInputButton onResult={(t) => onChange(t)} />
        </div>
        <span className="font-mono">
          {value.length} / {maxChars.toLocaleString()}
        </span>
      </div>
    </div>
  );
});