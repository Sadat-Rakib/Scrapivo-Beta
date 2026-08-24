/**
 * Guided page-search UI (Businesses / Investors / Jobs).
 *
 * - PageHeroCard: the compact, home-page-style entry card shown before a
 *   search. One per page, roughly square — replaces the old full-width hero.
 * - GuidedQuestionnaire: opens AFTER the user submits input and asks only the
 *   questions the parser could not answer from the text itself, one at a
 *   time. Answers flow straight into the page's server function.
 */

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Check, Loader2, Sparkles, X } from "lucide-react";
import type { FlowQuestion, FlowAnswers } from "@/lib/search/guided-intent";

// ── compact hero card ───────────────────────────────────────────────────────

export function PageHeroCard({
  icon: Icon,
  title,
  description,
  onStart,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="liquid-glass rounded-2xl p-6 sm:p-8 w-full max-w-sm mx-auto flex flex-col items-center gap-3 text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group"
    >
      <div className="size-12 sm:size-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
        <Icon className="size-5 sm:size-6" />
      </div>
      <div>
        <h3 className="font-semibold text-base text-white">{title}</h3>
        <p className="text-xs text-white/50 mt-1 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}

// ── guided questionnaire ────────────────────────────────────────────────────

export function GuidedQuestionnaire({
  title,
  input,
  questions,
  pending,
  onDone,
  onCancel,
}: {
  title: string;
  /** What the user typed that triggered the flow. */
  input: string;
  questions: FlowQuestion[];
  pending?: boolean;
  onDone: (answers: FlowAnswers) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<FlowAnswers>({});
  const [otherText, setOtherText] = useState("");

  if (!questions.length) return null;
  const q = questions[Math.min(step, questions.length - 1)];
  const isLast = step === questions.length - 1;

  const record = (value: string) => {
    const next: FlowAnswers = { ...answers, [q.id]: value };
    setAnswers(next);
    setOtherText("");
    if (isLast) onDone(next);
    else setStep((s) => s + 1);
  };

  const skip = () => {
    if (q.skipValue === undefined) return;
    record(q.skipValue);
  };

  return (
    <div className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-4 max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
          <Sparkles className="size-3.5 text-white/60" />
          <span>{title}</span>
          <span className="text-white/40 font-normal">
            · {step + 1} of {questions.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-white/40 hover:text-white transition-colors"
          title="Cancel"
        >
          <X className="size-4" />
        </button>
      </div>

      {step === 0 && input && (
        <p className="text-[11px] text-white/40 truncate">
          Searching: <span className="text-white/70">{input}</span>
        </p>
      )}

      <p className="text-sm font-medium text-white">{q.question}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {q.options.map((o) => (
          <button
            key={o.value || "any"}
            type="button"
            disabled={pending}
            onClick={() => record(o.value)}
            className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/30 hover:bg-white/[0.07] disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block text-xs font-medium text-white truncate">{o.label}</span>
              {o.hint && <span className="block text-[10px] text-white/40 truncate">{o.hint}</span>}
            </span>
            <Check className="size-3.5 shrink-0 text-white/25" />
          </button>
        ))}
      </div>

      {q.allowOther && (
        <div className="flex gap-1.5">
          <input
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && otherText.trim()) record(otherText.trim());
            }}
            placeholder={q.otherPlaceholder ?? "Something else…"}
            disabled={pending}
            className="flex-1 h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
          <button
            type="button"
            disabled={pending || !otherText.trim()}
            onClick={() => record(otherText.trim())}
            className="px-3 h-9 rounded-lg bg-white/10 border border-white/15 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-40 transition-colors"
          >
            Use
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || pending}
          className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors disabled:invisible"
        >
          <ArrowLeft className="size-3" />
          Back
        </button>
        {q.skipValue !== undefined && !q.required && (
          <button
            type="button"
            disabled={pending}
            onClick={skip}
            className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors"
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            {isLast ? "Search with defaults" : "Skip"}
          </button>
        )}
      </div>
    </div>
  );
}
