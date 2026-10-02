/**
 * Unified thinking sequence (Phase B): ONE composer-attached narration that
 * replaces SearchingPlan (pre-search terminal lines) + SearchingSteps
 * (in-search fixed ladders). Every line derives from live state — the echoed
 * query, the understood slots, the actual retrieval tier order. Nothing is
 * hardcoded per vertical: a plumber hunt can never narrate job boards.
 */
import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { InputTokens } from "@/lib/search/tokenize-input";

export interface ThinkingInput {
  query: string;
  tokens: InputTokens | null;
  /** Entity label once known ("businesses", "companies", "people", ...). */
  entityLabel: string | null;
}

/** Pure line builder (tested): Thinking → Analysing → Understanding → Researching. */
export function thinkingLines(input: ThinkingInput): string[] {
  const q = (input.query ?? "").trim().slice(0, 60);
  const lines = ["Thinking"];
  lines.push(q ? `Analysing "${q}"` : "Analysing your request");
  const t = input.tokens;
  const slots: string[] = [];
  if (t) {
    if (t.category && t.category !== "unknown") slots.push(t.category);
    if (t.geo) slots.push(t.geo);
    if (t.stage) slots.push(`stage ${t.stage}`);
    if (t.sector) slots.push(t.sector);
  }
  if (slots.length) lines.push(`Understanding: ${slots.join(" · ")}`);
  else if (input.entityLabel) lines.push(`Understanding: ${input.entityLabel}`);
  else lines.push("Understanding your request");
  // Retrieval tiers are internal — do not narrate "hot index → S3 → providers"
  // (reads as fake progress and confuses users when the live path is empty).
  return lines;
}

const REVEAL_MS = 220;

export function ThinkingSteps({
  inputKey,
  input,
  pending,
  compact,
  onDone,
}: {
  /** Remount per query (resets the reveal). */
  inputKey: string;
  input: ThinkingInput;
  /** Search running: last line pulses instead of checking off. */
  pending: boolean;
  /** Collapse to the slim status row (questions are showing). */
  compact: boolean;
  onDone?: () => void;
}) {
  const lines = thinkingLines(input);
  const lineCount = lines.length;
  const [revealed, setRevealed] = useState(1);
  useEffect(() => {
    setRevealed(1);
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setRevealed(lineCount);
      return;
    }
    // Purity (Defect C): the reveal updater must never fire onDone. Updaters
    // are re-run during render — calling a parent setState from inside one
    // logged "Cannot update a component (`DiscoverPage ThinkingSteps`) while
    // rendering a different component (`ThinkingSteps`)" and, on the first
    // mount, "Can't perform a React state update on a component that hasn't
    // mounted yet". onDone now derives from committed `revealed` state below.
    const t = window.setInterval(() => {
      setRevealed((r) => (r >= lineCount ? r : r + 1));
    }, REVEAL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per query via key
  }, [inputKey]);
  // Parent notification stays out of render: a committed-state effect.
  useEffect(() => {
    if (revealed >= 2) onDone?.();
    // onDone is a fresh parent closure per render; fire on reveal progress only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {pending ? (
          <Loader2 className="size-3 animate-spin text-primary" />
        ) : (
          <Check className="size-3 text-emerald-400 shrink-0" />
        )}
        <span className="font-mono truncate">
          {lines[lines.length - 1]}
          {pending ? "…" : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5" aria-live="polite">
      {lines.slice(0, revealed).map((l, i) => {
        const last = i === revealed - 1;
        const done = !last || (!pending && revealed >= lines.length);
        return (
          <div key={l} className="flex items-center gap-2 text-xs text-muted-foreground">
            {done ? (
              <Check className="size-3 text-emerald-400 shrink-0" />
            ) : (
              <Loader2 className="size-3 animate-spin text-primary shrink-0" />
            )}
            <span className="font-mono">{l}</span>
          </div>
        );
      })}
    </div>
  );
}
