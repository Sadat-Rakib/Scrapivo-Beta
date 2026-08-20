import { Landmark, Users, Briefcase } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

export function DiscoverWelcomeHero({
  onFocusComposer,
  greetingName,
}: {
  onFocusComposer: () => void;
  onChooseChat?: () => void;
  projectQuery?: string;
  onFindLeads?: () => void;
  onOpenWizard?: () => void;
  greetingName?: string;
}) {
  const navigate = useNavigate();

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
      <div className="mt-6 sm:mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Find Investors */}
        <button
          type="button"
          onClick={() => navigate({ to: "/investors" })}
          className="liquid-glass rounded-2xl p-4 sm:p-8 flex flex-row items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-4 sm:text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="size-10 sm:size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
            <Landmark className="size-5 sm:size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-white group-hover:text-white/90">
              Find Investors
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Match with active VCs & angels for your stage, sector, and location.
            </p>
          </div>
        </button>

        {/* Find Customers & Buyers */}
        <button
          type="button"
          onClick={onFocusComposer}
          className="liquid-glass rounded-2xl p-4 sm:p-8 flex flex-row items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-4 sm:text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="size-10 sm:size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
            <Users className="size-5 sm:size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-white group-hover:text-white/90">
              Find Customers & Buyers
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Surface buyer-intent signals from real-time posts and hiring data.
            </p>
          </div>
        </button>

        {/* Find Jobs & Businesses */}
        <button
          type="button"
          onClick={() => navigate({ to: "/jobs" })}
          className="liquid-glass rounded-2xl p-4 sm:p-8 flex flex-row items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-4 sm:text-center hover:bg-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="size-10 sm:size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform">
            <Briefcase className="size-5 sm:size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-white group-hover:text-white/90">
              Find Jobs & Businesses
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Discover active job postings and local business opportunities.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
