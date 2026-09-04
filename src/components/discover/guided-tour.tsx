// Lightweight first-time guided tour: sequential tooltip callouts anchored to
// [data-tour] targets. Seen-flag lives in localStorage per user. No dependency.
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";

export const TOUR_SEEN_KEY = (userId: string) => `scrapivo:guided-tour-seen:${userId}`;

type Step = {
  target: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    target: "sidebar",
    title: "Navigate your workspace",
    body: "Home is your launchpad. Watches re-run saved hunts on schedule, Saved holds bookmarked leads, and Guides teaches outreach that converts.",
  },
  {
    target: "cards",
    title: "Pick a starting point",
    body: "These cards jump you into the right hunt — people, companies, or local businesses. Each one pre-frames the search for you.",
  },
  {
    target: "composer",
    title: "Describe who you want",
    body: "Type your ideal lead in plain words, casual abbreviations welcome. Scrapy reads the intent and searches the live web — no filters to learn.",
  },
  {
    target: "composer-controls",
    title: "Dial up the AI",
    body: "Mode sets how hard Scrapy searches, and Thinker switches on extended reasoning for tricky hunts. Hit the arrow to run it.",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

export function GuidedTour({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = STEPS[idx];
  const isLast = idx === STEPS.length - 1;

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-tour="${STEPS[idx].target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [idx]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // Lock body scroll while the tour plays.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const finish = useCallback(
    (seen: boolean) => {
      try {
        if (seen) localStorage.setItem(TOUR_SEEN_KEY(userId), "1");
      } catch {
        // Storage unavailable — just close.
      }
      onDone();
    },
    [userId, onDone],
  );

  const tooltipTop = rect ? rect.top + rect.height + 12 : 120;
  // Clamp the tooltip inside the viewport.
  const tooltipStyle: React.CSSProperties = {
    top: Math.min(Math.max(tooltipTop, 12), window.innerHeight - 220),
    left: "50%",
    transform: "translateX(-50%)",
    maxWidth: "min(22rem, calc(100vw - 2rem))",
  };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Dim layer */}
      <div className="absolute inset-0 bg-black/70" onClick={() => finish(true)} />

      {/* Highlight ring around the current target */}
      {rect && (
        <div
          className="absolute rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55),0_0_24px_rgba(255,255,255,0.25)] transition-all duration-300 pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="absolute w-[22rem] liquid-glass rounded-2xl p-5 text-white"
        style={tooltipStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-semibold">{step.title}</div>
          <button
            type="button"
            onClick={() => finish(true)}
            aria-label="Skip tour"
            className="p-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-white/60 leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-white/40 font-mono">
            Step {idx + 1} of {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button
                type="button"
                onClick={() => setIdx((i) => i - 1)}
                className="px-3 py-1.5 rounded-full text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                Back
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={() => setIdx((i) => i + 1)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-white/90 transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => finish(true)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-white/90 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
        {!isLast && (
          <button
            type="button"
            onClick={() => finish(true)}
            className="mt-2 text-[11px] text-white/40 hover:text-white/70 underline underline-offset-2 transition-colors"
          >
            Skip tour
          </button>
        )}
      </div>
    </div>
  );
}
