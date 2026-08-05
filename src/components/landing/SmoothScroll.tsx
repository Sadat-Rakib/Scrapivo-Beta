import { useEffect } from "react";

/**
 * Mounts Lenis smooth scroll for the landing page only.
 * Respects prefers-reduced-motion. Cleans up on unmount so
 * other routes (auth, discover) get native scroll back.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let lenis: any;
    let rafId = 0;
    let cancelled = false;
    let onAnchor: ((e: MouseEvent) => void) | null = null;

    (async () => {
      const Lenis = (await import("lenis")).default;
      if (cancelled) return;
      lenis = new Lenis({ duration: 1.15, smoothWheel: true });
      const raf = (time: number) => {
        lenis.raf(time);
        rafId = requestAnimationFrame(raf);
      };
      rafId = requestAnimationFrame(raf);

      onAnchor = (e: MouseEvent) => {
        const a = (e.target as HTMLElement)?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
        if (!a) return;
        const id = a.getAttribute("href");
        if (!id || id === "#") return;
        const el = document.querySelector(id);
        if (!el) return;
        e.preventDefault();
        lenis.scrollTo(el as HTMLElement, { offset: -72 });
      };
      document.addEventListener("click", onAnchor);
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (onAnchor) document.removeEventListener("click", onAnchor);
      if (lenis) lenis.destroy();
    };
  }, []);

  return null;
}
