import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check } from "lucide-react";

type Goal = "jobs" | "clients" | "both";
type Audience = "companies" | "agencies" | "people" | "all";

// =====================================================================
// Search progress — steps APPEAR one at a time.
//
// The previous version rendered the whole list upfront at 30% opacity and lit
// each row in place. That reads as "the answer was already decided and the
// spinner is theatre" — you can see the ending before it happens. Appending
// instead means the panel grows as work completes, which is why Unify's and
// Origami's feel alive.
//
// DELIBERATELY GENERAL WORDING. Origami leaks internals — "I'm using keyword X",
// "the filter had a syntax miss" — which is noise to the user and hands your
// method to anyone reading a screenshot. Every label here names a CATEGORY of
// work ("Searching social platforms"), never a query, keyword, source name, or
// internal decision. Rule for adding steps: if it would mean nothing to someone
// who has never seen the code, it doesn't belong here.
// =====================================================================

function stepsFor(goal?: Goal, audience?: Audience): string[] {
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

  if (audience === "people") return [...base, ...peopleSteps];
  if (audience === "companies" || audience === "agencies") return [...base, ...companySteps];
  if (goal === "clients") return [...base, ...clientsAll];
  return [...base, ...jobsAll];
}

/**
 * Steps don't advance on a fixed clock. A uniform tick either races ahead of a
 * slow search (finishing the list while work continues) or crawls behind a fast
 * one. Early stages are genuinely quick; crawling and ranking are the slow ones,
 * so the cadence stretches as it goes and then holds on the last step until
 * real results replace this component.
 */
function delayForStep(index: number, total: number): number {
  const progress = index / Math.max(1, total - 1);
  return 420 + Math.round(progress * 1400);
}

export function SearchingSteps({
  query,
  goal,
  audience,
}: {
  query: string;
  goal?: Goal;
  audience?: Audience;
}) {
  const steps = useMemo(() => stepsFor(goal, audience), [goal, audience]);
  // How many steps are VISIBLE. Starts at 1 so the panel never flashes empty.
  const [shown, setShown] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setShown(1);
    let current = 1;

    const advance = () => {
      // Hold on the final step rather than completing it — the search isn't
      // done until results replace this component, and showing every step
      // ticked while still spinning is the same lie as pre-rendering them.
      if (current >= steps.length) return;
      current += 1;
      setShown(current);
      timer.current = setTimeout(advance, delayForStep(current, steps.length));
    };

    timer.current = setTimeout(advance, delayForStep(1, steps.length));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [steps]);

  const visible = steps.slice(0, shown);

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="text-muted-foreground">Hunting leads</span>
        {query && !/\b(AND|OR|NOT)\b/i.test(query) ? (
          <span className="truncate font-medium">for "{query}"</span>
        ) : (
          <span className="text-muted-foreground">across fresh signals…</span>
        )}
      </div>

      <ul className="space-y-1.5 text-sm">
        {visible.map((s, idx) => {
          const isCurrent = idx === visible.length - 1;
          return (
            <li
              key={s}
              // Each row fades + slides in as it's appended. `animate-in` is
              // from tw-animate-css, already a dependency.
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
      </ul>
    </div>
  );
}
