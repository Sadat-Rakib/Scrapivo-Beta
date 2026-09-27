import { FindCard } from "./find-card";
import { Mascot } from "page-mascot";
import { useIsMobile } from "@/hooks/use-mobile";

export function DiscoverWelcomeHero({ greetingName }: { greetingName?: string }) {
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
      <div className="mb-2 flex justify-center">
        <Mascot
          directions="/mascots/cat-directions.webp"
          reactions="/mascots/cat-reactions.webp"
          size={mascotSize}
          label="Scrapy"
        />
      </div>

      {/* Personalized greeting — no fabricated names. */}
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-white text-balance">
        {firstName ? `Hey ${firstName}, I'm Scrapy.` : "Hey, I'm Scrapy."}
      </h1>
      <p className="mt-3 text-sm sm:text-base text-white/60 max-w-lg mx-auto leading-relaxed">
        Welcome to Scrapivo. What are you looking for?
      </p>

      {/* Single Find card — Add Info lives on the Memory page */}
      <FindCard />
    </div>
  );
}
