import { FindCard } from "./find-card";
import type { AddInfoPayload } from "./add-your-information";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

export function DiscoverWelcomeHero({
  greetingName,
  onAddInfo,
}: {
  greetingName?: string;
  onAddInfo?: (payload: AddInfoPayload) => void;
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

      {/* Single Find card: rotating categories + nested Add Info pill */}
      <FindCard
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
