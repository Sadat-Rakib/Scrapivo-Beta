import { useEffect, useState } from "react";
import { Terminal, Check } from "lucide-react";
import type { InputTokens } from "@/lib/search/tokenize-input";

export type PlanVertical = "investors" | "firms" | "jobs" | "local" | "general";

/** Input-specific command lines per vertical. Never mentions "database". */
function planLines(tokens: InputTokens | null, vertical: PlanVertical): string[] {
  const lines: string[] = [];
  // Understanding line FIRST — echo what we detected in the input so the user
  // sees their own words reflected before any command runs. Skipped when the
  // input gave us nothing (only when tokens are absent entirely).
  if (tokens) {
    const understood: string[] = [];
    if (vertical === "investors") understood.push("investors");
    else if (vertical === "local") understood.push("local businesses");
    else if (vertical === "jobs") understood.push("jobs");
    else if (tokens.category !== "unknown") understood.push(tokens.category);
    if (tokens.stage) understood.push(`stage ${tokens.stage}`);
    if (tokens.sector) understood.push(`sector ${tokens.sector}`);
    if (tokens.geo) understood.push(tokens.geo);
    if (tokens.urgency) understood.push("urgent");
    if (understood.length) lines.push(`understood: ${understood.join(" · ")}`);
  }
  if (vertical === "investors") {
    lines.push("searching investor directories");
    lines.push("scanning company pages");
    lines.push("checking venture capital lists");
  } else if (vertical === "firms") {
    lines.push("checking venture capital lists");
    lines.push("scanning firm portfolios");
    lines.push("matching thesis");
  } else if (vertical === "jobs") {
    lines.push("scanning job boards");
    lines.push("checking company career pages");
    lines.push("matching role and level");
  } else if (vertical === "local") {
    lines.push("scanning local directories");
    lines.push("checking business listings");
    lines.push("verifying web presence");
  } else {
    lines.push("scanning company pages");
    lines.push("checking public profiles");
    lines.push("verifying contacts");
  }
  if (tokens) {
    const known: string[] = [];
    if (tokens.stage) known.push(`stage = ${tokens.stage}`);
    if (tokens.sector) known.push(`sector = ${tokens.sector}`);
    if (tokens.geo) known.push(`geo = ${tokens.geo}`);
    if (tokens.scale) known.push(`scale = ${tokens.scale}`);
    if (known.length) lines.push(`matching ${known.join(" · ")}`);
  }
  return lines;
}

const REVEAL_MS = 700;
const MIN_LINES_BEFORE_DONE = 2;

/**
 * Origami-style plan block: input-specific commands reveal one by one, and
 * the parent is notified (onDone) once enough lines are shown so clarifying
 * questions mount AFTER the plan — never beside it.
 */
export function SearchingPlan({
  tokens,
  vertical,
  onDone,
}: {
  tokens: InputTokens | null;
  vertical: PlanVertical;
  onDone?: () => void;
}) {
  const lines = planLines(tokens, vertical);
  const [revealed, setRevealed] = useState(1);
  const doneAt = Math.min(Math.max(MIN_LINES_BEFORE_DONE, 2), lines.length);

  useEffect(() => {
    setRevealed(1);
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setRevealed(lines.length);
      onDone?.();
      return;
    }
    const t = window.setInterval(() => {
      setRevealed((r) => {
        if (r >= lines.length) {
          window.clearInterval(t);
          return r;
        }
        const next = r + 1;
        if (next === doneAt) onDone?.();
        if (next >= lines.length) window.clearInterval(t);
        return next;
      });
    }, REVEAL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per query via key
  }, [lines.join("|")]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Terminal className="size-3.5" />
        Scrapy is working
      </div>
      {lines.slice(0, revealed).map((l) => (
        <div key={l} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="size-3 text-emerald-400 shrink-0" />
          <span className="font-mono">{l}</span>
        </div>
      ))}
    </div>
  );
}
