import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight, Radar, Layers, Sparkles, Network, ShieldCheck, Search,
  MessageCircle, Hash, Github, MessageSquare, Twitter, Code2, Check,
} from "lucide-react";

/**
 * Five feature cards with real animated content.
 * Each card: top visual zone (h-44, content-safe) + bottom solid text zone.
 */
export function FeaturesGrid({ cta }: { cta: string }) {
  return (
    <section
      id="features"
      className="relative border-t"
      style={{
        backgroundColor: "var(--bg-base)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between mb-16">
          <div>
            <p
              className="text-[10px] uppercase tracking-[0.25em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              Product capabilities
            </p>
            <h2
              className="text-3xl sm:text-5xl font-light tracking-tight mt-3 max-w-xl"
              style={{ color: "var(--text-primary)" }}
            >
              One workspace, every way to close.
            </h2>
            <p
              className="mt-4 text-sm sm:text-base max-w-xl"
              style={{ color: "var(--text-secondary)" }}
            >
              Real-time signals from the open web, scored by AI, verified by
              account history — every lead is a person actually asking, right now.
            </p>
          </div>
          <Link to={cta}>
            <button
              className="inline-flex items-center gap-2 px-5 h-11 rounded-full text-sm font-medium transition-all"
              style={{
                background: "linear-gradient(180deg, #ffffff 0%, #d8d8dc 100%)",
                color: "#0a0a0b",
                boxShadow: "0 0 32px var(--accent-glow)",
              }}
            >
              Get started free <ArrowRight className="size-4" />
            </button>
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Buyer-intent discovery" desc="Only posts where someone is hiring, buying or asking — never job-board reposts." icon={<Radar className="size-4" />}>
            <KeywordOrb />
          </Card>
          <Card title="Every source, one feed" desc="Reddit, HN, GitHub, Bluesky, X, Dev.to and more — unified, deduped, live." icon={<Layers className="size-4" />}>
            <SourceMarquee />
          </Card>
          <Card title="AI scoring you can trust" desc="Hot / Warm tiers with confidence — only warm-or-better leads are shown." icon={<Sparkles className="size-4" />}>
            <DonutScore />
          </Card>
        </div>
        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <Card title="Cross-platform corroboration" desc="When the same buyer surfaces on two sources, we rank them higher." icon={<Network className="size-4" />}>
            <CrossPlatformMatches />
          </Card>
          <Card title="Verified posters only" desc="Account age, post history and freshness decay filter throwaways and stale posts." icon={<ShieldCheck className="size-4" />}>
            <TypewriterSearch />
          </Card>
        </div>
      </div>
    </section>
  );
}

function Card({
  title, desc, icon, children,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border transition-colors flex flex-col"
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border-subtle)",
        height: 380,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-elevated-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-elevated)")}
    >
      {/* Visual zone */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center">
        {children}
      </div>
      {/* Solid text zone — no gradient overlap */}
      <div
        className="relative px-6 py-5 border-t"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-elevated)" }}
      >
        <div className="flex items-center gap-2 mb-1.5" style={{ color: "var(--text-tertiary)" }}>
          {icon}
          <span className="text-[10px] uppercase tracking-[0.22em]">Live</span>
        </div>
        <div className="font-medium text-base" style={{ color: "var(--text-primary)" }}>{title}</div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{desc}</p>
      </div>
    </div>
  );
}

/* ── Visual 1: Orb with rotating keyword chips ─────────── */
function KeywordOrb() {
  const keywords = ["hiring", "looking for", "need a dev", "who can build", "recommend", "anyone know"];
  return (
    <div className="relative w-[260px] h-[220px] flex items-center justify-center">
      {/* glowing core */}
      <div
        className="absolute size-14 rounded-full"
        style={{
          background: "radial-gradient(circle, #ffffff 0%, rgba(255,255,255,0.4) 40%, transparent 70%)",
          filter: "blur(2px)",
        }}
      />
      <div
        className="absolute size-6 rounded-full"
        style={{ background: "#f4f4f6", boxShadow: "0 0 24px rgba(255,255,255,0.6)" }}
      />
      {/* concentric rings */}
      {[80, 110].map((r) => (
        <div
          key={r}
          className="absolute rounded-full border"
          style={{
            width: r * 2,
            height: r * 2,
            borderColor: "rgba(255,255,255,0.08)",
            borderStyle: "dashed",
          }}
        />
      ))}
      {/* orbit ring with chips (counter-rotated so text stays upright) */}
      {[0, 1].map((ring) => {
        const radius = ring === 0 ? 80 : 110;
        const dur = ring === 0 ? 24 : 32;
        const dir = ring === 0 ? "" : "reverse";
        const slice = keywords.slice(ring * 3, ring * 3 + 3);
        return (
          <div
            key={ring}
            className="absolute"
            style={{
              width: radius * 2,
              height: radius * 2,
              animation: `orbitSpin ${dur}s linear infinite ${dir}`,
            }}
          >
            {slice.map((kw, i) => {
              const angle = (360 / slice.length) * i;
              return (
                <div
                  key={kw}
                  className="absolute top-1/2 left-1/2"
                  style={{ transform: `rotate(${angle}deg) translateX(${radius}px) rotate(-${angle}deg)` }}
                >
                  <span
                    className="inline-block -translate-x-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap font-mono"
                    style={{
                      backgroundColor: "var(--bg-elevated-2)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                      animation: `counterSpin ${dur}s linear infinite ${dir === "reverse" ? "" : "reverse"}`,
                    }}
                  >
                    {kw}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ── Visual 2: 4-row icon marquee (constrained) ───────── */
function SourceMarquee() {
  const rows = [
    ["Reddit", "Hacker News", "GitHub", "Bluesky", "Dev.to", "Lobsters"],
    ["X / Twitter", "Mastodon", "Remotive", "RemoteOK", "Jobicy", "Lemmy"],
    ["WWR", "SAM.gov", "ProductHunt", "IndieHackers", "Quora", "Stack Exchange"],
    ["Substack", "Discord", "Slack groups", "Threads", "Forums", "Tildes"],
  ];
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2 px-2 overflow-hidden">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 whitespace-nowrap" style={{
          animation: `marqueeX ${20 + i * 4}s linear infinite ${i % 2 ? "reverse" : ""}`,
          width: "max-content",
        }}>
          {[...row, ...row].map((label, j) => (
            <span
              key={j}
              className="text-[11px] px-2.5 py-1 rounded-full border"
              style={{
                color: "var(--text-secondary)",
                borderColor: "var(--border-subtle)",
                backgroundColor: "var(--bg-elevated-2)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Visual 3: animated donut score → 92 ──────────────── */
function DonutScore() {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const dur = 1800;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * 92));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const C = 2 * Math.PI * 42; // ~264
  const offset = C * (1 - val / 100);
  return (
    <div className="relative">
      <svg viewBox="0 0 120 120" className="w-[180px] h-[180px] -rotate-90">
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
        <circle
          cx="60" cy="60" r="42" fill="none"
          stroke="#f4f4f6" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 60ms linear", filter: "drop-shadow(0 0 6px rgba(255,255,255,0.35))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-light tabular-nums" style={{ color: "var(--text-primary)" }}>
          {val}<span className="text-base" style={{ color: "var(--text-tertiary)" }}>%</span>
        </div>
        <div
          className="text-[10px] uppercase tracking-[0.22em] mt-1 px-2 py-0.5 rounded-full border"
          style={{ color: "var(--text-primary)", borderColor: "var(--border-default)", backgroundColor: "var(--bg-elevated-2)" }}
        >
          Hot
        </div>
      </div>
    </div>
  );
}

/* ── Visual 4: Cross-platform match rows ──────────────── */
function CrossPlatformMatches() {
  const rows: Array<{ handle: string; a: React.ReactNode; b: React.ReactNode; aName: string; bName: string }> = [
    { handle: "@sarah_b", aName: "Reddit", bName: "HN", a: <MessageCircle className="size-3.5" />, b: <Hash className="size-3.5" /> },
    { handle: "@devmark", aName: "GitHub", bName: "Bluesky", a: <Github className="size-3.5" />, b: <MessageSquare className="size-3.5" /> },
    { handle: "@nora.k", aName: "X", bName: "Dev.to", a: <Twitter className="size-3.5" />, b: <Code2 className="size-3.5" /> },
  ];
  return (
    <div className="w-[88%] max-w-md space-y-2.5">
      {rows.map((r, i) => (
        <div
          key={r.handle}
          className="flex items-center gap-2 rounded-xl border px-3 py-2"
          style={{
            backgroundColor: "var(--bg-elevated-2)",
            borderColor: "var(--border-subtle)",
            animation: `nodePulse ${3 + i * 0.4}s ease-in-out infinite ${i * 0.5}s`,
          }}
        >
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border"
            style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}
          >
            {r.a} {r.aName}
          </span>
          {/* connector */}
          <div className="flex-1 relative h-px" style={{ backgroundColor: "var(--border-default)" }}>
            <div
              className="absolute -top-[3px] left-1/2 -translate-x-1/2 size-1.5 rounded-full"
              style={{ background: "#f4f4f6", boxShadow: "0 0 6px rgba(255,255,255,0.6)" }}
            />
          </div>
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border"
            style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}
          >
            {r.b} {r.bName}
          </span>
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ml-1"
            style={{
              color: "#86efac",
              borderColor: "rgba(134,239,172,0.3)",
              backgroundColor: "rgba(34,197,94,0.08)",
            }}
          >
            <Check className="size-3" /> matched
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Visual 5: JS-driven typewriter (no truncation) ──── */
function TypewriterSearch() {
  const phrases = [
    "looking for a React + Postgres dev",
    "anyone know a good outbound tool",
    "need a fintech brand designer",
  ];
  const [text, setText] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const full = phrases[phraseIdx];
    let i = 0;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const type = () => {
      if (cancelled) return;
      if (i <= full.length) {
        setText(full.slice(0, i));
        i++;
        timeoutId = setTimeout(type, 55);
      } else {
        timeoutId = setTimeout(erase, 1600);
      }
    };
    const erase = () => {
      if (cancelled) return;
      if (i > 0) {
        i--;
        setText(full.slice(0, i));
        timeoutId = setTimeout(erase, 25);
      } else {
        setPhraseIdx((p) => (p + 1) % phrases.length);
      }
    };
    type();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [phraseIdx]);

  return (
    <div className="w-[88%] max-w-md">
      <div
        className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5"
        style={{ backgroundColor: "var(--bg-elevated-2)", borderColor: "var(--border-default)" }}
      >
        <Search className="size-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <span
          className="text-sm font-mono whitespace-nowrap overflow-hidden text-ellipsis flex-1"
          style={{ color: "var(--text-primary)" }}
        >
          {text}
        </span>
        <span style={{ animation: "caretBlink 1s steps(1) infinite", color: "var(--text-primary)" }}>▍</span>
      </div>
      <div className="flex items-center gap-2 mt-3 px-1">
        <span
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
          style={{
            color: "#86efac",
            borderColor: "rgba(134,239,172,0.3)",
            backgroundColor: "rgba(34,197,94,0.08)",
          }}
        >
          <ShieldCheck className="size-3" /> Verified poster · 4y old
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>posted 2h ago</span>
      </div>
    </div>
  );
}
