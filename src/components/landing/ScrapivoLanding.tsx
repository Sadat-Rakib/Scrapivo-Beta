import { Link } from "@tanstack/react-router";
import { ScrapivoLandingFooter } from "./ScrapivoLandingFooter";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Menu, X, ArrowUp, Plus } from "lucide-react";
import "@/styles/scrapivo-landing.css";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";
const HERO_VIDEO =
  "https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/6eb86888-1f8c-4442-b4bc-9051f9883443_video.mp4";
const HERO_POSTER =
  "https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/8386b20f-fd12-44d9-a4f3-5e16320a7682_3840w.jpg";
const DEMO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260604_125109_19424216-4e2a-4560-b9f2-f1b5f6eb2c2e.mp4";
const FAQ_VIDEO =
  "https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/8d64c20b-6bad-46e7-8eaa-daa5ecc4b8aa_video.mp4";

type Props = {
  cta: string;
  ctaLabel: string;
  children?: ReactNode;
};

const FAQ_ITEMS = [
  {
    q: "What does Scrapivo actually do?",
    a: "Scrapivo is the first real-time AI lead generation tool that finds the latest and active opportunities and customers for you. It surfaces people who are actively looking for what you offer, then scores and ranks them by buyer intent so you can reach out while demand is fresh.",
  },
  {
    q: "Which sources do you search?",
    a: "We search across public sites, public communities, public servers, social media platforms, company pages, and public government sites. The focus is live, open web activity, not a closed private database.",
  },
  {
    q: "How is this different from existing systems?",
    a: "Most existing systems hand you a static list. They scrape millions of company pages or profiles once, store everything in their database, and serve matches from that pile forever. There is often no buying signal, no recent activity, and sometimes no posts at all. You only get people loosely related to your role or service. Scrapivo is different. It finds real-time moments where someone is actively looking, so you reach out while intent is still alive.",
  },
  {
    q: "How does AI scoring work?",
    a: "Each result is filtered for buyer intent and skill relevance, then ranked Hot or Warm. Hot means strong, recent intent with clear decision maker or urgency cues. Warm means solid relevance with useful timing signals, still worth acting on. Scoring weighs recency, decision maker detection, urgency, and budget cues so the strongest opportunities rise first.",
  },
  {
    q: "How do you stop scams and throwaway accounts?",
    a: "We run account verification on top of intent scoring. That includes account age checks, post history review, and cross platform corroboration so single post throwaways and fake profiles get filtered out. Verified posters are badged so you can trust what you see.",
  },
  {
    q: "Will the outreach sound like me?",
    a: "Yes. Our model is trained on outreach frameworks that actually convert, and every script is grounded in the original public post so it stays specific to you. We also keep inbox legalities in mind for channels like Gmail and Outlook, so bounce risk and deliverability practices are covered instead of spray and pray templates.",
  },
  {
    q: "Is the data public?",
    a: "Yes. We only scrape public data assets. We do not touch private or gated content because that is not legal. Even for social media platforms, we rely on public algorithms and public patterns, never private access, so the product stays on the right side of the line.",
  },
  {
    q: "How much does it cost?",
    a: "Start free. Upgrade when Scrapivo pays for itself. Reach out at mirsadat@scrapivo.com for pricing.",
  },
];

function appleTopAttachedNavPath(w: number, h: number) {
  const r = Math.min(34, h * 0.52, w * 0.105);
  const k = r * 0.5;
  return (
    `M0,0` +
    ` H${w}` +
    ` V${h - r}` +
    ` C${w},${h - k} ${w - k},${h} ${w - r},${h}` +
    ` H${r}` +
    ` C${k},${h} 0,${h - k} 0,${h - r}` +
    ` V0` +
    ` Z`
  );
}

function useInViewVideo(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.playsInline = true;
    const play = () => {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };
    if (!("IntersectionObserver" in window)) {
      play();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) play();
          else video.pause();
        });
      },
      { threshold: 0.2 },
    );
    obs.observe(video);
    return () => obs.disconnect();
  }, [ref]);
}

function NitroButton({
  to,
  search,
  children,
  className,
  style,
}: {
  to: "/auth" | "/discover";
  search?: { mode?: "signin" | "signup" };
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const onMove = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (((e.clientX - rect.left) / rect.width) * 100).toFixed(1) + "%";
    const y = (((e.clientY - rect.top) / rect.height) * 100).toFixed(1) + "%";
    const shader = e.currentTarget.querySelector(".nitro-shader") as HTMLElement | null;
    if (shader) {
      shader.style.background = `radial-gradient(circle at ${x} ${y}, rgba(124,58,237,0.85) 0%, rgba(37,99,235,0.65) 35%, rgba(5,150,105,0.45) 65%, transparent 85%)`;
      shader.style.opacity = "0.60";
    }
  }, []);
  const onLeave = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    const shader = e.currentTarget.querySelector(".nitro-shader") as HTMLElement | null;
    if (shader) shader.style.opacity = "0";
  }, []);

  return (
    <Link
      to={to}
      search={search}
      className={`liquid-glass ${className ?? ""}`}
      style={style}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "scale(1.04)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <span
        className="nitro-shader"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          background:
            "conic-gradient(from 0deg at 50% 50%, #7c3aed, #2563eb, #059669, #d97706, #dc2626, #7c3aed)",
          opacity: 0,
          transition: "opacity 0.4s ease",
          filter: "blur(8px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          position: "relative",
          zIndex: 1,
          background: "linear-gradient(135deg, #c4b5fd 0%, #e0d7ff 45%, #bfdbfe 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          pointerEvents: "none",
        }}
      >
        {children}
      </span>
    </Link>
  );
}

const DEMO_STATES = [
  {
    q: "AI agencies needing editors",
    h: "Found 28 live opportunities",
    c: "PixelForge AI",
    b: [
      { l: "Buying Signal", d: "Founder asked for freelance video partners 2 days ago." },
      { l: "Best Contact", d: "Rahul Mehta • Founder" },
      { l: "Confidence", d: "96%" },
    ],
  },
  {
    q: "Startups hiring React devs",
    h: "43 companies growing engineering teams",
    c: "NovaStack",
    b: [
      {
        l: "Signals",
        u: ["Hiring 6 React Engineers", "Recently raised Seed", "Careers page updated yesterday"],
      },
      { d: "Verified CTO contact available." },
    ],
  },
  {
    q: "Businesses running Meta ads",
    h: "61 active advertisers detected",
    c: "Glow Naturals",
    b: [
      { l: "Signals", u: ["New Meta campaigns launched", "Pixel detected", "Landing pages updated"] },
      { l: "Estimated monthly spend", d: "$2k-$3k" },
    ],
  },
  {
    q: "Founders discussing AI automation",
    h: "19 high-intent founders found",
    c: "FlowSync",
    b: [
      {
        l: "Why it matched",
        u: [
          "Founder posted about repetitive workflows",
          "Looking for AI implementation",
          "Team hiring operations roles",
        ],
      },
      { d: "Founder contact verified." },
    ],
  },
  {
    q: "Web design clients in SF",
    h: "34 businesses matched",
    c: "Urban Interiors",
    b: [
      {
        l: "Opportunity",
        u: [
          "Website redesign announced",
          "Google reviews increasing rapidly",
          "No developer listed internally",
        ],
      },
      { l: "Decision Maker", d: "Owner • Verified Email" },
    ],
  },
] as const;

function AiDemoSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const typedRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLParagraphElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useInViewVideo(videoRef);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let si = 0;
    let started = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };

    const FF = '"Times New Roman MT Condensed", "Times New Roman", Times, serif';
    const ACC = "#d8c2ff";
    const esc = (s: string) =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    function build(st: (typeof DEMO_STATES)[number]) {
      if (!cardRef.current) return;
      let html = `<div class="ai-line" style="margin:0;"><h3 style="margin:0;font-family:${FF};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">${esc(st.c)}</h3><div style="width:52px;height:2px;background:${ACC};margin-top:10px;border-radius:999px;opacity:0.88;"></div></div>`;
      st.b.forEach((bl) => {
        html += `<div class="ai-line" style="padding-top:18px;margin-top:18px;border-top:1px solid rgba(255,255,255,0.08);">`;
        if ("l" in bl && bl.l) {
          const label = `<span style="font-family:${FF};font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${ACC};">${esc(bl.l)}</span>`;
          if ("d" in bl && bl.d && !("u" in bl)) {
            if (bl.d.length > 46) {
              html += `<div style="margin-bottom:8px;">${label}</div><div style="margin-top:8px;font-family:${FF};font-size:14px;line-height:1.55;color:rgba(255,255,255,0.88);font-weight:500;">${esc(bl.d)}</div>`;
            } else {
              const isStat = /^\d+%$/.test(bl.d) || /^\$/.test(bl.d);
              const stl = isStat
                ? `font-size:17px;font-weight:700;color:${ACC};`
                : "font-size:14px;font-weight:600;color:#ffffff;";
              html += `<div style="font-family:${FF};line-height:1.55;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;">${label}<span style="color:${ACC};font-weight:700;">:</span><span style="font-family:${FF};line-height:1.5;${stl}">${esc(bl.d)}</span></div>`;
            }
          } else {
            html += `<div style="margin-bottom:8px;">${label}</div>`;
          }
        }
        if ("u" in bl && bl.u) {
          bl.u.forEach((t) => {
            html += `<div class="ai-line" style="display:flex;align-items:flex-start;gap:10px;margin-top:8px;font-family:${FF};font-size:13px;line-height:1.55;color:rgba(255,255,255,0.84);"><span style="color:${ACC};font-size:15px;line-height:1.35;flex-shrink:0;">•</span><span>${esc(t)}</span></div>`;
          });
        }
        if ("d" in bl && bl.d && (!("l" in bl) || "u" in bl)) {
          html += `<div class="ai-line" style="margin-top:10px;font-family:${FF};font-size:13px;line-height:1.55;color:rgba(255,255,255,0.84);font-weight:500;">${esc(bl.d)}</div>`;
        }
        html += `</div>`;
      });
      cardRef.current.innerHTML = html;
    }

    function showFinal() {
      const st = DEMO_STATES[0];
      if (typedRef.current) typedRef.current.textContent = st.q;
      if (cursorRef.current) cursorRef.current.style.display = "none";
      if (headerRef.current) {
        headerRef.current.textContent = st.h;
        headerRef.current.classList.add("in");
      }
      build(st);
      resultsRef.current?.classList.add("in");
      cardRef.current?.querySelectorAll(".ai-line").forEach((l) => l.classList.add("in"));
    }

    if (reduced) {
      showFinal();
      return;
    }

    function runState() {
      timers.forEach(clearTimeout);
      timers.length = 0;
      const st = DEMO_STATES[si];
      if (typedRef.current) typedRef.current.textContent = "";
      if (cursorRef.current) cursorRef.current.style.display = "inline-block";
      headerRef.current?.classList.remove("in");
      resultsRef.current?.classList.remove("in");
      if (headerRef.current) headerRef.current.textContent = st.h;
      build(st);
      let i = 0;
      const typeChar = () => {
        if (i < st.q.length) {
          if (typedRef.current) typedRef.current.textContent += st.q.charAt(i);
          i++;
          later(typeChar, 40 + Math.random() * 20);
        } else {
          later(press, 650);
        }
      };
      const press = () => {
        submitRef.current?.classList.add("pressed");
        later(() => {
          submitRef.current?.classList.remove("pressed");
          reveal();
        }, 260);
      };
      const reveal = () => {
        headerRef.current?.classList.add("in");
        later(() => {
          resultsRef.current?.classList.add("in");
          const lines = cardRef.current?.querySelectorAll(".ai-line") ?? [];
          lines.forEach((l, idx) => {
            later(() => l.classList.add("in"), 160 + idx * 100);
          });
          later(exit, 160 + lines.length * 100 + 3600);
        }, 200);
      };
      const exit = () => {
        resultsRef.current?.classList.remove("in");
        headerRef.current?.classList.remove("in");
        later(() => {
          si = (si + 1) % DEMO_STATES.length;
          runState();
        }, 450);
      };
      later(typeChar, 300);
    }

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started) {
            started = true;
            runState();
          }
        });
      },
      { threshold: 0.35 },
    );
    obs.observe(section);
    return () => {
      obs.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="ai-demo-section"
      style={{
        position: "relative",
        zIndex: 10,
        background: "#050505",
        padding: "130px 20px 140px",
        overflow: "hidden",
      }}
      aria-label="Scrapivo AI search demo"
    >
      <video
        ref={videoRef}
        src={DEMO_VIDEO}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          zIndex: 0,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          background: "rgba(0,0,0,0.87)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 45%, rgba(0,0,0,0.45) 100%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", zIndex: 2, maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "clamp(36px,5.5vw,60px)",
            lineHeight: 1.08,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            textShadow: "rgba(0,0,0,0.7) 0px 2px 20px",
          }}
        >
          Ready <span style={{ fontStyle: "italic" }}>clients.</span> Right{" "}
          <span style={{ fontStyle: "italic" }}>Now.</span>
        </h2>
        <p
          style={{
            fontFamily: '"Times New Roman MT Condensed", "Times New Roman", Times, serif',
            fontSize: 15,
            lineHeight: 1.65,
            color: "rgba(255,255,255,0.78)",
            maxWidth: 460,
            margin: "16px auto 0",
            textShadow: "0 2px 20px rgba(0,0,0,0.7)",
          }}
        >
          No more guesswork. No more cold lists. Scrapivo hunts down your next client in real time!
          Verified, Ready, and Worth Your Time!
        </p>
        <div
          id="ai-demo-searchbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: 520,
            margin: "42px auto 0",
            padding: "8px 8px 8px 20px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              flex: "1 1 0%",
              minWidth: 0,
              textAlign: "left",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: 14,
              color: "#ffffff",
              fontFamily: '"Times New Roman MT Condensed", "Times New Roman", Times, serif',
            }}
          >
            <span ref={typedRef} id="ai-demo-typed" />
            <span ref={cursorRef} id="ai-demo-cursor" aria-hidden />
          </span>
          <button
            ref={submitRef}
            id="ai-demo-submit"
            type="button"
            tabIndex={-1}
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: "#16161f",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "#d8c2ff",
              display: "grid",
              placeItems: "center",
              cursor: "default",
              flexShrink: 0,
            }}
          >
            <ArrowUp size={18} />
          </button>
        </div>
        <p
          ref={headerRef}
          id="ai-demo-header"
          style={{
            maxWidth: 520,
            margin: "22px auto 0",
            textAlign: "left",
            fontFamily: '"Times New Roman MT Condensed", "Times New Roman", Times, serif',
            fontSize: 13,
            fontWeight: 600,
            color: "#d8c2ff",
            letterSpacing: "0.02em",
          }}
        />
        <div
          ref={resultsRef}
          id="ai-demo-results"
          style={{
            maxWidth: 520,
            margin: "12px auto 0",
            textAlign: "left",
            borderRadius: 24,
            padding: "28px 30px",
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
        >
          <div ref={cardRef} id="ai-demo-card" />
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState<number | null>(0);
  useInViewVideo(videoRef);

  return (
    <section
      id="faq-section"
      style={{
        position: "relative",
        zIndex: 10,
        overflow: "hidden",
        padding: "100px 20px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <video
        ref={videoRef}
        src={FAQ_VIDEO}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.65) 100%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 560, margin: "0 auto" }}>
        <h2
          style={{
            fontSize: "clamp(1.8rem,3.5vw,2.4rem)",
            color: "white",
            textAlign: "center",
            margin: "0 0 8px 0",
            letterSpacing: "-0.04em",
            textShadow: "0 2px 12px rgba(0,0,0,0.40)",
          }}
        >
          Questions, answered.
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.9)",
            textAlign: "center",
            margin: "0 0 28px 0",
            lineHeight: 1.6,
            textShadow: "0 1px 12px rgba(0,0,0,0.40)",
          }}
        >
          Everything you need to know before you join the Inner Circle.
        </p>
        <div
          className="faq-panel"
          style={{
            position: "relative",
            width: "100%",
            margin: "0 auto",
            padding: "28px 28px 20px",
            borderRadius: 28,
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow:
              "0 20px 60px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.05)",
          }}
        >
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className={`faq-item${isOpen ? " open" : ""}`}>
                <button
                  type="button"
                  className="faq-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <span className="faq-icon" aria-hidden>
                    <Plus size={14} />
                  </span>
                </button>
                <div
                  className="faq-body"
                  style={{ maxHeight: isOpen ? 480 : 0 }}
                >
                  <div className="faq-body-inner">{item.a}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


export function ScrapivoLanding({ cta }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const revealRef = useRef<HTMLDivElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const outlineSvgRef = useRef<SVGSVGElement>(null);
  useInViewVideo(heroVideoRef);

  const authTo: "/auth" | "/discover" = cta === "/discover" ? "/discover" : "/auth";
  const signupSearch = authTo === "/auth" ? { mode: "signup" as const } : undefined;

  useEffect(() => {
    const onScroll = () => setHasScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Hero spotlight mask
  useEffect(() => {
    const reveal = revealRef.current;
    if (!reveal) return;
    const SPOTLIGHT_W = 620;
    const SPOTLIGHT_H = 500;
    const startX = window.innerWidth * 0.68;
    const startY = window.innerHeight * 0.44;
    const mouse = { x: startX, y: startY };
    const smooth = { x: startX, y: startY };
    let rafId: number | null = null;
    let heroVisible = true;

    const drawMask = (cx: number, cy: number) => {
      const mask = `radial-gradient(ellipse ${SPOTLIGHT_W}px ${SPOTLIGHT_H}px at ${cx}px ${cy}px, rgba(255,255,255,1) 0%, rgba(255,255,255,1) 30%, rgba(255,255,255,.82) 48%, rgba(255,255,255,.42) 68%, rgba(255,255,255,.12) 88%, rgba(255,255,255,0) 100%)`;
      reveal.style.maskImage = mask;
      reveal.style.webkitMaskImage = mask;
    };
    const loop = () => {
      if (!heroVisible) {
        rafId = null;
        return;
      }
      smooth.x += (mouse.x - smooth.x) * 0.095;
      smooth.y += (mouse.y - smooth.y) * 0.095;
      drawMask(smooth.x, smooth.y);
      rafId = requestAnimationFrame(loop);
    };
    const startLoop = () => {
      if (rafId == null) loop();
    };
    const stopLoop = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    const onMove = (event: PointerEvent) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };
    const onLeave = () => {
      mouse.x = window.innerWidth * 0.68;
      mouse.y = window.innerHeight * 0.44;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });
    drawMask(smooth.x, smooth.y);

    const heroSection = reveal.closest("section");
    let heroObserver: IntersectionObserver | null = null;
    if (heroSection && "IntersectionObserver" in window) {
      heroObserver = new IntersectionObserver(
        (entries) => {
          heroVisible = entries[0]?.isIntersecting ?? false;
          if (heroVisible) startLoop();
          else stopLoop();
        },
        { threshold: 0 },
      );
      heroObserver.observe(heroSection);
      startLoop();
    } else {
      startLoop();
    }

    return () => {
      stopLoop();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      heroObserver?.disconnect();
    };
  }, []);

  // Nav pill continuous shape
  useEffect(() => {
    const nav = navRef.current;
    const outline = outlineRef.current;
    const outlineSvg = outlineSvgRef.current;
    if (!nav || !outline || !outlineSvg) return;

    const update = () => {
      const w = nav.offsetWidth;
      const h = nav.offsetHeight;
      if (w < 4 || h < 4) return;
      const d = appleTopAttachedNavPath(w, h);
      const clip = `path('${d}')`;
      nav.style.setProperty("--nav-clip-path", clip);
      outline.setAttribute("d", d);
      outlineSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      outlineSvg.setAttribute("width", String(w));
      outlineSvg.setAttribute("height", String(h));
    };
    update();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(nav);
    window.addEventListener("resize", update);
    document.fonts?.ready?.then(update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [menuOpen]);

  const navLinkStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(255, 255, 255, 0.85)",
    textDecoration: "none",
    transition: "color 0.15s, opacity 0.15s",
    padding: "5px 13px",
  };

  return (
    <div className={`scrapivo-landing${hasScrolled ? " has-scrolled" : ""}`}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&display=swap"
      />

      <a href="#top" id="main-logo" aria-label="Scrapivo">
        <img src={LOGO_SRC} alt="Scrapivo" />
        <span>Scrapivo</span>
      </a>

      <nav className="floating-nav" aria-label="Main navigation" id="nav-pill" ref={navRef}>
        <svg
          className="nav-pill-outline"
          aria-hidden
          focusable="false"
          ref={outlineSvgRef}
        >
          <path id="nav-pill-outline-path" ref={outlineRef} />
        </svg>
        <div className="nav-pill-links">
          <a href="#top" style={navLinkStyle}>
            Home
          </a>
          <a
            href="https://www.instagram.com/scrapivo"
            target="_blank"
            rel="noreferrer"
            style={navLinkStyle}
          >
            Instagram
          </a>
          <a
            href="https://www.linkedin.com/company/scrapivo/"
            target="_blank"
            rel="noreferrer"
            style={navLinkStyle}
          >
            LinkedIn
          </a>
          <a href="mailto:mirsadat@scrapivo.com" style={navLinkStyle}>
            Contact
          </a>
        </div>
        <button
          id="hamburger-btn"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex lg:hidden items-center justify-center rounded-full text-white"
          style={{
            width: 36,
            height: 36,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {menuOpen && (
        <div
          id="mobile-menu"
          style={{
            position: "fixed",
            top: 72,
            left: 16,
            right: 16,
            zIndex: 999,
            background: "rgba(15, 15, 22, 0.6)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 20,
            padding: 20,
            boxShadow:
              "0 20px 60px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { href: "#top", label: "Home" },
              { href: "https://www.linkedin.com/company/scrapivo/", label: "LinkedIn", ext: true },
              { href: "https://www.instagram.com/scrapivo", label: "Instagram", ext: true },
              { href: "mailto:mirsadat@scrapivo.com", label: "Contact" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.ext ? "_blank" : undefined}
                rel={item.ext ? "noreferrer" : undefined}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "block",
                  padding: "14px 18px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "white",
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {item.label}
              </a>
            ))}
            <Link
              to={authTo}
              search={signupSearch}
              onClick={() => setMenuOpen(false)}
              style={{
                display: "block",
                padding: "14px 18px",
                borderRadius: 12,
                background: "white",
                fontSize: 15,
                fontWeight: 700,
                textDecoration: "none",
                textAlign: "center",
                marginTop: 4,
                color: "#0a0a14",
              }}
            >
              Join Inner Circle
            </Link>
          </div>
        </div>
      )}

      <main className="min-h-screen bg-black" id="top">
        <section
          className="relative h-screen w-full overflow-hidden bg-black"
          style={{ height: "100dvh" }}
          aria-label="Scrapivo hero"
        >
          <div className="hero-base hero-zoom absolute inset-0 z-10" />
          <div
            ref={revealRef}
            id="revealLayer"
            className="hero-reveal-layer absolute inset-0 z-[42] pointer-events-none"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
            aria-hidden
          >
            <video
              ref={heroVideoRef}
              src={HERO_VIDEO}
              poster={HERO_POSTER}
              muted
              playsInline
              preload="metadata"
              loop
              className="h-full w-full object-cover opacity-[0.82]"
            />
          </div>
          <div className="hero-scrim pointer-events-none absolute inset-0 z-40" aria-hidden />
          <div
            className="hero-bottom-mask pointer-events-none absolute inset-x-0 bottom-0 z-[45] h-[62vh]"
            aria-hidden
          />

          <div
            className="pointer-events-none absolute inset-0 z-50 scrapivo-hero-copy"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingTop: "22vh",
            }}
          >
            <div
              className="pointer-events-auto"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "0 20px",
                marginTop: 32,
              }}
            >
              <h1
                id="hero-title"
                style={{
                  margin: 0,
                  lineHeight: 1.1,
                  textShadow: "0 4px 48px rgba(0,0,0,0.60)",
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: "clamp(44px, 6vw, 74px)",
                    fontWeight: 400,
                    color: "white",
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                  }}
                >
                  Get <span style={{ fontStyle: "italic" }}>verified leads</span>
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "clamp(44px, 6vw, 74px)",
                    fontWeight: 400,
                    color: "white",
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                  }}
                >
                  Without chaos.
                </span>
              </h1>
              <p
                id="hero-desc"
                style={{
                  fontWeight: 400,
                  fontSize: 18,
                  lineHeight: 1.4,
                  color: "rgba(255, 255, 255, 0.85)",
                  textAlign: "center",
                  maxWidth: 480,
                  margin: "4px auto 0",
                  textShadow: "0 1px 10px rgba(0,0,0,0.80)",
                }}
              >
                AI powered real-time opportunity finder,
                <br />
                get verified leads just by talking.
              </p>
            </div>
            <div style={{ flex: 1 }} />
            <div
              className="pointer-events-auto"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                padding: "0 20px",
                marginBottom: "clamp(24px, 5vh, 52px)",
              }}
            >
              <div style={{ position: "relative", display: "inline-block", marginBottom: 12 }}>
                <NitroButton
                  to={authTo}
                  search={signupSearch}
                  style={{
                    position: "relative",
                    zIndex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 999,
                    padding: "15px 42px",
                    cursor: "pointer",
                    overflow: "hidden",
                    transition: "transform 0.2s, box-shadow 0.2s",
                    textDecoration: "none",
                  }}
                >
                  Join Inner Circle →
                </NitroButton>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(255, 255, 255, 0.42)",
                  letterSpacing: "0.06em",
                  margin: 0,
                  textAlign: "center",
                  textShadow: "rgba(0, 0, 0, 0.8) 0px 1px 8px",
                  fontFamily: '"Times New Roman MT Condensed", "Times New Roman", Times, serif',
                }}
              >
                Only a few spots are left
              </p>
            </div>
          </div>
        </section>

        <AiDemoSection />
        <FaqSection />
        <ScrapivoLandingFooter authTo={authTo} authSearch={signupSearch} />
      </main>
    </div>
  );
}
