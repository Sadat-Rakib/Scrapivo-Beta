import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const STORAGE_PREFIX = "scrapivo:section-open:";

function readInitialOpen(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${id}`);
  if (raw === null) return fallback;
  return raw === "1";
}

/**
 * Collapsible glass section used by the Settings page.
 *
 * The header row is the expand/collapse control (full-width touch target);
 * open/closed state is remembered for the browser session via sessionStorage.
 */
export function CollapsibleSection({
  id,
  title,
  description,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readInitialOpen(id, defaultOpen));

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(`${STORAGE_PREFIX}${id}`, next ? "1" : "0");
      }
      return next;
    });
  };

  return (
    <section className="liquid-glass rounded-2xl">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        className="w-full flex items-center justify-between gap-3 px-5 sm:px-6 py-4 text-left"
      >
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">{title}</h2>
          {description && (
            <p className="text-[11px] text-white/40 mt-0.5 truncate">{description}</p>
          )}
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-white/50 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div id={`section-${id}`} className="px-5 sm:px-6 pb-6 space-y-5">
          <div className="border-t border-white/10 pt-5 space-y-5">{children}</div>
        </div>
      )}
    </section>
  );
}
