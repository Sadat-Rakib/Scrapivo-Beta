import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Mail, Github, Twitter, ArrowUpRight } from "lucide-react";

/**
 * Scrapivo footer: canvas scan-lines, 4-layer parallax wordmark,
 * live UTC clock. Three useEffect hooks, all client-side.
 */
export function Footer({ cta }: { cta: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wordmarkRef = useRef<HTMLDivElement | null>(null);
  const [utc, setUtc] = useState("");

  // 1) Canvas scan-lines
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const lines = Array.from({ length: 14 }, () => ({
      y: Math.random() * 400,
      speed: 0.2 + Math.random() * 0.6,
      alpha: 0.05 + Math.random() * 0.1,
    }));
    const resize = () => {
      c.width = c.offsetWidth;
      c.height = c.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const l of lines) {
        ctx.strokeStyle = `rgba(255,255,255,${l.alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, l.y);
        ctx.lineTo(c.width, l.y);
        ctx.stroke();
        l.y += l.speed;
        if (l.y > c.height) {
          l.y = -10;
          l.alpha = 0.05 + Math.random() * 0.1;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // 2) Parallax wordmark
  useEffect(() => {
    const el = wordmarkRef.current;
    if (!el) return;
    let raf = 0;
    const layers = el.querySelectorAll<HTMLSpanElement>("[data-layer]");
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const progress = 1 - Math.min(1, Math.max(0, rect.top / window.innerHeight));
        layers.forEach((layer, i) => {
          const depth = (i - 1.5) * 18;
          const t = progress * Math.PI;
          const x = Math.sin(t + i) * depth;
          const y = Math.cos(t * 0.7 + i) * depth * 0.3;
          layer.style.transform = `translate(${x}px, ${y}px)`;
        });
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // 3) Live UTC clock
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const ss = String(d.getUTCSeconds()).padStart(2, "0");
      setUtc(`${hh}:${mm}:${ss} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer
      id="contact"
      className="relative overflow-hidden border-t"
      style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border-subtle)" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none opacity-40"
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-20 pb-8">
        {/* Tagline + CTA */}
        <div
          className="grid gap-10 md:grid-cols-[1fr_auto] md:items-end pb-14 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <p
            className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight max-w-2xl"
            style={{ color: "var(--text-primary)" }}
          >
            Scrapivo finds buyers before they find you — scanning the open web for real, active
            intent, every single day.
          </p>
          <div className="flex flex-col gap-4">
            <Link to={cta}>
              <button
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium transition-all"
                style={{
                  background: "linear-gradient(180deg, #ffffff 0%, #d8d8dc 100%)",
                  color: "#0a0a0b",
                  boxShadow: "0 0 50px var(--accent-glow)",
                }}
              >
                Get Started <ArrowRight className="size-4" />
              </button>
            </Link>

            <a
              href="mailto:hello@scrapivo.app"
              className="inline-flex items-center gap-2 text-sm w-fit transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              <Mail className="size-4" /> hello@scrapivo.app
            </a>
          </div>
        </div>

        {/* Nav columns */}
        <div
          className="grid gap-10 md:grid-cols-4 py-12 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <FooterCol
            heading="Product"
            links={[
              { l: "Features", h: "#features" },
              { l: "Testimonials", h: "#testimonials" },
              { l: "FAQ", h: "#faq" },
              { l: "Pricing", h: "#" },
            ]}
          />
          <FooterCol
            heading="Resources"
            links={[
              { l: "Blog", h: "#" },
              { l: "Source coverage", h: "#features" },
              { l: "Changelog", h: "#" },
              { l: "Status", h: "#" },
            ]}
          />
          <FooterCol
            heading="Company"
            links={[
              { l: "About", h: "#" },
              { l: "Contact", h: "mailto:hello@scrapivo.app" },
              { l: "Privacy", h: "#" },
              { l: "Terms", h: "#" },
            ]}
          />
          <div>
            <div
              className="text-[10px] uppercase tracking-[0.22em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Newsletter
            </div>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex items-center rounded-full border overflow-hidden"
              style={{
                borderColor: "var(--border-default)",
                backgroundColor: "var(--bg-elevated)",
              }}
            >
              <input
                type="email"
                placeholder="you@company.com"
                className="flex-1 bg-transparent px-4 py-2.5 text-sm outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                type="submit"
                className="px-4 py-2.5"
                aria-label="Subscribe"
                style={{ color: "var(--accent-warm)" }}
              >
                <ArrowUpRight className="size-4" />
              </button>
            </form>
            <div className="flex items-center gap-2 mt-5">
              <a
                href="#"
                aria-label="X"
                className="size-9 rounded-full border flex items-center justify-center"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                <Twitter className="size-4" />
              </a>
              <a
                href="#"
                aria-label="GitHub"
                className="size-9 rounded-full border flex items-center justify-center"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                <Github className="size-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Layered wordmark */}
        <div
          ref={wordmarkRef}
          className="relative h-[160px] sm:h-[220px] my-10 select-none overflow-hidden"
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              data-layer
              className="absolute inset-0 flex items-center justify-center font-light tracking-tighter whitespace-nowrap leading-none transition-transform duration-300"
              style={{
                fontSize: "clamp(80px, 18vw, 220px)",
                color:
                  i === 0
                    ? "rgba(255,255,255,0.06)"
                    : i === 1
                      ? "rgba(255,255,255,0.10)"
                      : i === 2
                        ? "rgba(245,245,247,0.18)"
                        : "var(--text-primary)",
                WebkitTextStroke: i === 2 ? "0.5px rgba(245,245,247,0.3)" : "0",
                zIndex: i,
                mixBlendMode: i === 3 ? "normal" : "screen",
              }}
            >
              SCRAPIVO
            </span>
          ))}
        </div>

        {/* Bottom row */}
        <div className="pt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            © 2026 Scrapivo, Inc. · Built for operators who'd rather reply to real intent.
          </p>
          <div
            className="font-mono text-xs tabular-nums px-3 py-1.5 rounded-md border"
            style={{
              color: "var(--accent-amber)",
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--bg-elevated)",
            }}
          >
            {utc || "--:--:-- UTC"}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ heading, links }: { heading: string; links: { l: string; h: string }[] }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.22em] mb-4"
        style={{ color: "var(--text-tertiary)" }}
      >
        {heading}
      </div>
      <ul className="space-y-2.5">
        {links.map((n) => (
          <li key={n.l}>
            <a
              href={n.h}
              className="text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              {n.l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
