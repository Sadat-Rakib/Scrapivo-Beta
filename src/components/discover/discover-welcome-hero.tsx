import { Mascot } from "page-mascot";
import { useIsMobile } from "@/hooks/use-mobile";

export type GuidedSearchKind = "investors" | "founders" | "companies" | "jobs" | "local_businesses";

/** The bare category each guided pill sends into the normal clarification pipeline. */
export const GUIDED_SEARCH_TEXT: Record<GuidedSearchKind, string> = {
  investors: "investors",
  founders: "founders",
  companies: "companies",
  jobs: "jobs",
  local_businesses: "local businesses",
};

const QUICK_CHIPS: Array<{ label: string; kind: GuidedSearchKind }> = [
  { label: "Find investors", kind: "investors" },
  { label: "Find founders", kind: "founders" },
  { label: "Find companies", kind: "companies" },
  { label: "Find jobs", kind: "jobs" },
  { label: "Find local businesses", kind: "local_businesses" },
];

export function DiscoverWelcomeHero({
  greetingName,
  onGuidedStart,
}: {
  greetingName?: string;
  /** A category hint for the canonical clarification pipeline, never a demo query. */
  onGuidedStart?: (kind: GuidedSearchKind) => void;
}) {
  const firstName = greetingName?.trim() ? greetingName.trim().split(" ")[0] : null;
  // Single instance: page-mascot mounts a fixed-position canvas, so CSS
  // show/hide duals would render twice. Size switches on the breakpoint.
  const isMobile = useIsMobile();
  const mascotSize = isMobile ? 112 : 152;

  return (
    <div className="max-w-4xl mx-auto w-full text-center px-4 sm:px-6 py-8 sm:py-12">
      {/* Scrapy — the product's personality. Local sprite sheets (never
          hotlinked); cursor tracking degrades on touch, and the component
          respects prefers-reduced-motion. */}
      {/* Scrapy speaks first — conversational onboarding, not a landing page. */}
      <div className="relative mx-auto mb-3 max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white/85 backdrop-blur-sm">
        {firstName
          ? `Hey ${firstName} 👋 I'm Scrapy. What are you looking for today?`
          : "Hey 👋 I'm Scrapy. What are you looking for today?"}
        <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-white/10 bg-white/[0.06]" />
      </div>
      <div className="mt-4 flex justify-center">
        <Mascot
          directions="/mascots/cat-directions.webp"
          reactions="/mascots/cat-reactions.webp"
          size={mascotSize}
          label="Scrapy"
        />
      </div>

      {/* Category hints enter the same clarification pipeline as typed requests. */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => onGuidedStart?.(chip.kind)}
            className="rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-white"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
