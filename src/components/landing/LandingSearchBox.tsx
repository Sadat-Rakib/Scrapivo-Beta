import { Link } from "@tanstack/react-router";
import { Plus, Sparkles, Brain, Mic, ArrowUp } from "lucide-react";

/**
 * Landing demo composer — pixel-parity visual clone of Discover's
 * UnifiedComposer (liquid-glass rounded-[24px] p-3 sm:p-4 + identical
 * controls row). Display-only: any interaction routes to signup/discover.
 */
export function LandingSearchBox({
  cta,
  signupSearch,
  displayedQuery,
  typing,
}: {
  cta: string;
  signupSearch?: { mode: "signup" };
  displayedQuery: string;
  typing: boolean;
}) {
  const pillBase =
    "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl px-3 py-1.5 text-xs font-medium text-white/75 transition-all shrink-0";
  const text = displayedQuery || "Ask Scrapivo to help you craft a search…";

  return (
    <Link
      to={cta}
      search={signupSearch}
      aria-label="Start searching with Scrapivo"
      className="liquid-glass rounded-[24px] p-3 sm:p-4 block w-full text-left no-underline"
    >
      <div className="flex items-start gap-2">
        <div className="min-h-9 px-2 py-1.5 text-sm text-white flex-1">
          <span className={displayedQuery ? "text-white" : "text-white/40"}>{text}</span>
          <span
            aria-hidden="true"
            className="inline-block ml-0.5 text-white/70"
            style={{ animation: typing ? "none" : "blink-opacity 1s step-end infinite" }}
          >
            |
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-1">
        <span
          aria-hidden="true"
          className="size-8 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl flex items-center justify-center text-white/75 shrink-0"
        >
          <Plus className="size-4" />
        </span>
        <span aria-hidden="true" className={pillBase}>
          <Sparkles className="size-3.5" />
          <span>Mode</span>
        </span>
        <span aria-hidden="true" className={pillBase}>
          <Brain className="size-3.5" />
          <span>Thinker</span>
        </span>
        <span className="flex-1" />
        <span
          aria-hidden="true"
          className="shrink-0 inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl text-white/75"
        >
          <span className="size-9 rounded-full flex items-center justify-center">
            <Mic className="size-4" />
          </span>
        </span>
        <span
          aria-hidden="true"
          className="size-9 rounded-full bg-white text-black flex items-center justify-center shrink-0 shadow-[0_4px_16px_rgba(255,255,255,0.25)]"
        >
          <ArrowUp className="size-4" />
        </span>
      </div>
    </Link>
  );
}
