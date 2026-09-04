import { useEffect, useState } from "react";
import { ChevronDown, UserRoundPlus } from "lucide-react";
import { AddInfoForm, type AddInfoPayload } from "./add-your-information";

/** Rotating category words under the Find title. Longest item sets the slot width. */
const FIND_WORDS = [
  "executives",
  "founders",
  "investors",
  "VCs",
  "CEOs",
  "owners",
  "companies",
  "startups",
  "agencies",
  "local businesses",
  "clients",
  "talent",
] as const;

const ROTATE_MS = 2500;

/**
 * Single consolidated hero card: Find + rotating category word, with a nested
 * collapsed-by-default Add Info pill that expands the info form in place.
 * Display-only — typing still happens in the bottom composer.
 */
export function FindCard({ onGenerate }: { onGenerate: (payload: AddInfoPayload) => void }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const t = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIdx((i) => (i + 1) % FIND_WORDS.length);
        setVisible(true);
      }, 220);
    }, ROTATE_MS);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div
      data-tour="cards"
      role="presentation"
      className="liquid-glass rounded-2xl px-6 py-6 sm:px-10 sm:py-8 mt-6 sm:mt-10 max-w-2xl mx-auto w-full cursor-default select-none"
    >
      <h3 className="font-semibold text-xl sm:text-2xl text-white min-h-8">
        Find{" "}
        <span
          aria-live="off"
          className={`inline-block text-white/80 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
        >
          {FIND_WORDS[idx]}
        </span>
      </h3>
      <p className="text-xs text-white/50 mt-2 leading-relaxed">
        People, companies, and local businesses — matched to your niche and location.
      </p>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => setInfoOpen((o) => !o)}
          aria-expanded={infoOpen}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl px-3 py-1.5 text-xs font-medium text-white/75 hover:bg-white/[0.12] hover:text-white transition-all"
        >
          <UserRoundPlus className="size-3.5" />
          <span>Add Info</span>
          <ChevronDown
            className={`size-3.5 transition-transform ${infoOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {infoOpen ? (
        <div className="text-left">
          <p className="mt-3 text-center text-xs font-medium text-white/75">
            Scrapy personalizes future chats
          </p>
          <p className="text-center text-[11px] text-white/40 mt-0.5">
            Scrapy will understand your information and use it for future chats where applicable.
          </p>
          <AddInfoForm onGenerate={onGenerate} />
        </div>
      ) : null}
    </div>
  );
}
