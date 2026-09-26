import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { UserRoundPlus } from "lucide-react";

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
 * Single consolidated hero card: Find + rotating category word, with an
 * Add Info pill that navigates to the Memory page. Display-only — typing
 * still happens in the bottom composer.
 */
export function FindCard() {
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

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
        People, companies, businesses, etc. Everything matched to your needs.
      </p>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => navigate({ to: "/memory" })}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-xl px-3 py-1.5 text-xs font-medium text-white/75 hover:bg-white/[0.12] hover:text-white transition-all"
        >
          <UserRoundPlus className="size-3.5" />
          <span>Add Info</span>
        </button>
      </div>
    </div>
  );
}
