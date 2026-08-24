import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check } from "lucide-react";

type Goal = "jobs" | "clients" | "both";
type Audience = "companies" | "agencies" | "people" | "all";
export type SearchVertical = "leads" | "investors" | "local";

// =====================================================================
// Search progress — steps APPEAR one at a time, then keep talking while
// the real search is still running (searches often outlast the step list).
// Steps are vertical-aware: an investor hunt must never narrate job boards.
// =====================================================================

function stepsFor(goal?: Goal, audience?: Audience, vertical?: SearchVertical): string[] {
  const base = ["Reading your request"];
  const peopleSteps = [
    "Searching social platforms",
    "Scanning public forums",
    "Finding people showing intent",
    "Checking how recent each signal is",
    "Ranking by how strong the signal is",
  ];
  const companySteps = [
    "Searching company sites",
    "Checking public directories",
    "Querying public registries",
    "Crawling the open web",
    "Finding companies showing intent",
    "Checking how recent each signal is",
    "Ranking by how strong the signal is",
  ];
  const clientsAll = [
    "Searching social platforms",
    "Scanning public forums",
    "Searching company sites",
    "Checking public directories",
    "Querying public registries",
    "Crawling the open web",
    "Filtering out ads and self-promotion",
    "Checking how recent each signal is",
    "Ranking by how strong the signal is",
    "Writing why each one matches",
  ];
  const jobsAll = [
    "Searching social platforms",
    "Scanning public forums",
    "Searching job boards",
    "Searching company sites",
    "Checking public directories",
    "Querying public registries",
    "Crawling the open web",
    "Filtering out ads and self-promotion",
    "Checking how recent each signal is",
    "Ranking by how strong the signal is",
    "Writing why each one matches",
  ];
  const investorsAll = [
    "Matching investor theses",
    "Checking stage and check-size fit",
    "Scanning geography and sector focus",
    "Ranking by fit to your raise",
  ];
  const localAll = [
    "Mapping local listings",
    "Checking websites and contact info",
    "Scoring opportunity signals",
    "Ranking by outreach potential",
  ];

  if (vertical === "investors") return [...base, ...investorsAll];
  if (vertical === "local") return [...base, ...localAll];
  if (audience === "people") return [...base, ...peopleSteps];
  if (audience === "companies" || audience === "agencies") return [...base, ...companySteps];
  if (goal === "clients") return [...base, ...clientsAll];
  return [...base, ...jobsAll];
}

/** Header copy for the progress card, per vertical. */
function headerFor(vertical?: SearchVertical): string {
  if (vertical === "investors") return "Matching investors";
  if (vertical === "local") return "Scanning local businesses";
  return "Hunting leads";
}

/** Extra lines that keep appearing after the main list while search continues. */
const HOLDING_LINES = [
  "Still pulling fresh signals…",
  "Cross-checking sources for better matches…",
  "Filtering noise so you only see real demand…",
  "Scoring volume and quality together…",
  "Almost there — packing the strongest leads…",
  "Double-checking recency and relevance…",
  "Still working — good searches take a moment…",
];

function delayForStep(index: number, total: number): number {
  const progress = index / Math.max(1, total - 1);
  // Stretch so the main list lasts longer (~45–70s for full clients list).
  return 900 + Math.round(progress * 2800);
}

export function SearchingSteps({
  query,
  goal,
  audience,
  vertical,
}: {
  query: string;
  goal?: Goal;
  audience?: Audience;
  vertical?: SearchVertical;
}) {
  const steps = useMemo(() => stepsFor(goal, audience, vertical), [goal, audience, vertical]);
  const [shown, setShown] = useState(1);
  const [holdingIdx, setHoldingIdx] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setShown(1);
    setHoldingIdx(-1);
    let current = 1;

    const clearTimers = () => {
      if (timer.current) clearTimeout(timer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };

    const startHolding = () => {
      let i = 0;
      setHoldingIdx(0);
      const tick = () => {
        i = (i + 1) % HOLDING_LINES.length;
        setHoldingIdx(i);
        holdTimer.current = setTimeout(tick, 2200);
      };
      holdTimer.current = setTimeout(tick, 2200);
    };

    const advance = () => {
      if (current >= steps.length) {
        startHolding();
        return;
      }
      current += 1;
      setShown(current);
      timer.current = setTimeout(advance, delayForStep(current, steps.length));
    };

    timer.current = setTimeout(advance, delayForStep(1, steps.length));
    return clearTimers;
  }, [steps]);

  const visible = steps.slice(0, shown);
  const holdingLine = holdingIdx >= 0 ? HOLDING_LINES[holdingIdx] : null;

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="text-muted-foreground">{headerFor(vertical)}</span>
        {query && !/\b(AND|OR|NOT)\b/i.test(query) ? (
          <span className="truncate font-medium">for "{query}"</span>
        ) : (
          <span className="text-muted-foreground">across fresh signals…</span>
        )}
      </div>

      <ul className="space-y-1.5 text-sm">
        {visible.map((s, idx) => {
          const isCurrent = holdingIdx < 0 && idx === visible.length - 1;
          return (
            <li
              key={s}
              className={`flex animate-in items-center gap-2 fade-in slide-in-from-bottom-1 duration-300 ${
                isCurrent ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {isCurrent ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <Check className="size-3.5 shrink-0 text-primary" />
              )}
              <span>{s}</span>
            </li>
          );
        })}
        {holdingLine && (
          <li
            key={`hold-${holdingIdx}`}
            className="flex animate-in items-center gap-2 fade-in slide-in-from-bottom-1 duration-300 text-foreground"
          >
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            <span>{holdingLine}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
