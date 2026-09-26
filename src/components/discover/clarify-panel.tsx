import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Check, X } from "lucide-react";
import type { ClarifyQuestion, ClarifyAnswers } from "@/lib/search/clarifier";

// =====================================================================
// Clarifying questions — one at a time, always skippable.
//
// Shown INSTEAD of results, before the search runs: answering (or skipping)
// fires the one targeted search. Rendered exclusively — never alongside
// results or the searching steps.
//
// Every question carries a recommended default, so "Skip" is never a dead end —
// it runs the search a careful operator would have run.
// =====================================================================

type Props = {
  questions: ClarifyQuestion[];
  /** Plain-English summary of what the search currently assumed. */
  refinement?: string;
  onApply: (answers: ClarifyAnswers, opts?: { force?: boolean }) => void;
  onDismiss: () => void;
  disabled?: boolean;
};

export function ClarifyPanel({ questions, refinement, onApply, onDismiss, disabled }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<ClarifyAnswers>({});
  const [otherText, setOtherText] = useState("");

  if (!questions.length) return null;
  const q = questions[step];
  const isLast = step === questions.length - 1;

  const record = (value: string, isOther: boolean) => {
    const next: ClarifyAnswers = { ...answers };
    if (isOther) {
      next.other = { ...(next.other ?? {}), [q.id]: value };
    } else {
      // `craft` is free-text in the schema; the rest are enums. The "confirm"
      // option means "keep what we detected", which is the absence of an
      // override rather than a value.
      if (q.id === "craft") {
        if (value !== "confirm") next.craft = value;
      } else if (q.id === "signal_focus") {
        next.signal_focus = value as ClarifyAnswers["signal_focus"];
      } else {
        (next as Record<string, unknown>)[q.id] = value;
      }
    }
    setAnswers(next);
    setOtherText("");
    if (isLast) onApply(next);
    else setStep((s) => s + 1);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <Sparkles className="size-3.5" />
          Narrow this down
          <span className="ml-1 text-muted-foreground">
            Question {step + 1} of {questions.length}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-muted-foreground transition-colors hover:text-foreground"
          title="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
        className="h-1 w-full overflow-hidden rounded-full bg-primary/10"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((step + 1) / questions.length) * 100}%` }}
        />
      </div>

      {refinement && step === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Right now we assumed: <span className="text-foreground/80">{refinement}</span>
        </p>
      ) : null}

      <p className="text-sm font-medium">{q.question}</p>

      <div className="space-y-1.5">
        {q.options.map((o) => (
          <button
            key={o.id}
            disabled={disabled}
            onClick={() => record(o.id === "confirm" ? "confirm" : o.id, false)}
            className="flex w-full items-start gap-2 rounded-lg border border-border bg-background/50 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-foreground">{o.label}</span>
                {o.recommended ? (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                    Recommended
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-muted-foreground">{o.hint}</div>
            </div>
            <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
          </button>
        ))}

        {q.allowOther ? (
          <div className="flex gap-1.5 pt-0.5">
            <Input
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && otherText.trim()) record(otherText.trim(), true);
              }}
              placeholder="Something else…"
              className="h-8 text-sm"
              disabled={disabled}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              disabled={disabled || !otherText.trim()}
              onClick={() => record(otherText.trim(), true)}
            >
              Use
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          onClick={() => {
            setOtherText("");
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={step === 0}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:invisible"
        >
          Back
        </button>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={() => (isLast ? onApply(answers, { force: true }) : setStep((s) => s + 1))}
          >
            {isLast ? "Search with defaults" : "Skip"}
          </Button>
          {!isLast ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={() => setStep((s) => s + 1)}
            >
              Next
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={() => onApply(answers, { force: true })}
            >
              Search
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
