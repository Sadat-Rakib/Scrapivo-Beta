import { Users, Building2, Store } from "lucide-react";
import { AddYourInformation } from "./add-your-information";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

export function DiscoverWelcomeHero({
  greetingName,
  onAddInfo,
}: {
  onFocusComposer?: () => void;
  onChooseChat?: () => void;
  projectQuery?: string;
  onFindLeads?: () => void;
  onOpenWizard?: () => void;
  greetingName?: string;
  onAddInfo?: (payload: { fileExcerpt: string; fileName: string; urlOrText: string }) => void;
}) {
  const firstName = greetingName?.trim() ? greetingName.trim().split(" ")[0] : "there";
  const title = `Welcome, ${firstName}!`;

  return (
    <div className="max-w-4xl mx-auto w-full text-center px-4 sm:px-6 py-8 sm:py-12">
      {/* Centered Brand Logo */}
      <img src={LOGO_SRC} className="h-12 w-auto mx-auto mb-6" alt="Scrapivo" />

      {/* Greeting Title */}
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-white text-balance">
        {title}
      </h1>
      <p className="mt-3 text-sm sm:text-base text-white/60 max-w-lg mx-auto leading-relaxed">
        What are you looking for now, a buying signal, niche, or role?
      </p>

      {/* 3 Main Action Cards: compact horizontal rows on phones so the hero
          fits the viewport; vertical centered cards from sm: and up. */}
      <div
        data-tour="cards"
        className="mt-6 sm:mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4"
      >
        {/* Find People — display-only, not clickable */}
        <div
          role="presentation"
          className="liquid-glass rounded-2xl p-4 sm:p-8 flex flex-row items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-4 sm:text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group cursor-default select-none"
        >
          <div className="size-10 sm:size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
            <Users className="size-5 sm:size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-white group-hover:text-white/90">
              Find People
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Match with executives, investors, and founders for your niche, stage, and location.
            </p>
          </div>
        </div>

        {/* Find Companies — display-only, not clickable */}
        <div
          role="presentation"
          className="liquid-glass rounded-2xl p-4 sm:p-8 flex flex-row items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-4 sm:text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group cursor-default select-none"
        >
          <div className="size-10 sm:size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
            <Building2 className="size-5 sm:size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-white group-hover:text-white/90">
              Find Companies
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Surface company intel, firmographics, and buyer signals in real time.
            </p>
          </div>
        </div>

        {/* Find Businesses — display-only, not clickable */}
        <div
          role="presentation"
          className="liquid-glass rounded-2xl p-4 sm:p-8 flex flex-row items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-4 sm:text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group cursor-default select-none"
        >
          <div className="size-10 sm:size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
            <Store className="size-5 sm:size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-white group-hover:text-white/90">
              Find Businesses
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Discover local business opportunities ready for your pitch.
            </p>
          </div>
        </div>
      </div>

      {/* Add Your Information — idle hero only, below cards, above composer */}
      <AddYourInformation
        onGenerate={(p) => {
          try {
            localStorage.setItem(
              "scrapivo:user-info",
              JSON.stringify({ ...p, at: new Date().toISOString() }),
            );
          } catch {
            // Private-mode storage may throw — server save still runs via onAddInfo.
          }
          onAddInfo?.(p);
        }}
      />
    </div>
  );
}
