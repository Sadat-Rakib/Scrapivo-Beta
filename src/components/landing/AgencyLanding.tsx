import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  Calendar,
  CheckSquare,
  ChevronDown,
  Flame,
  Github,
  MessageSquare,
  Search,
  Zap,
} from "lucide-react";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { DashboardPreview } from "./DashboardPreview";

type Props = {
  cta: string;
  ctaLabel: string;
  children?: ReactNode;
};

function GlowCta({ to, label }: { to: string; label: string }) {
  const onMove = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
  }, []);

  return (
    <div className="relative group mb-20">
      <div className="absolute -inset-1 bg-gradient-to-r from-[#ff8964] to-orange-400 rounded-full blur opacity-70 group-hover:opacity-100 transition duration-1000 group-hover:duration-200" />
      <Link
        to={to}
        onMouseMove={onMove}
        onMouseEnter={(e) => e.currentTarget.style.setProperty("--glow-opacity", "1")}
        onMouseLeave={(e) => e.currentTarget.style.setProperty("--glow-opacity", "0")}
        className="agency-cta-glow group inline-flex text-[13px] sm:text-sm uppercase whitespace-nowrap transition-all duration-500 hover:scale-[1.02] outline-none font-semibold tracking-widest pt-4 pr-10 pb-4 pl-10 relative items-center justify-center"
      >
        <span
          className="absolute -inset-10 z-[-2] rounded-full opacity-[var(--glow-opacity)] transition-opacity duration-500 pointer-events-none"
          style={{
            background:
              "radial-gradient(180px circle at var(--x) var(--y), rgba(255, 116, 44, 0.22) 0%, rgba(255, 116, 44, 0.12) 32%, transparent 70%)",
            filter: "blur(22px)",
          }}
        />
        <span
          className="absolute -inset-3 z-[-1] rounded-full opacity-[var(--glow-opacity)] transition-opacity duration-500 pointer-events-none"
          style={{
            background:
              "radial-gradient(130px circle at var(--x) var(--y), rgba(255, 235, 180, 0.36) 0%, rgba(255, 132, 55, 0.2) 42%, transparent 78%)",
            filter: "blur(10px)",
          }}
        />
        <span className="absolute inset-0 z-0 rounded-full overflow-hidden bg-gradient-to-b from-[#fbfbfb] via-[#eeeeef] to-[#d9dadd] shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.06),0_6px_16px_rgba(0,0,0,0.28)] ring-1 ring-white/70 pointer-events-none">
          <span
            className="absolute inset-0 opacity-[var(--glow-opacity)] transition-opacity duration-500"
            style={{
              background:
                "radial-gradient(145px circle at var(--x) var(--y), rgba(255,255,245,0.95) 0%, rgba(255,244,205,0.65) 24%, rgba(255,152,78,0.22) 52%, transparent 78%)",
            }}
          />
        </span>
        <span className="relative z-10 flex items-center gap-2 text-[#3b2110] drop-shadow-[0_1px_0_rgba(255,255,255,0.75)]">
          {label}
          <ArrowRight className="w-4 h-4 transition-transform duration-500 group-hover:translate-x-1" />
        </span>
      </Link>
    </div>
  );
}

function AgencyNav({ cta, ctaLabel }: { cta: string; ctaLabel: string }) {
  const [communityOpen, setCommunityOpen] = useState(false);

  return (
    <nav className="agency-nav fixed z-50 border-white/10 border-b top-0 right-0 left-0 backdrop-blur-lg">
      <div className="flex h-16 max-w-[80rem] mx-auto px-6 items-center justify-between w-full">
        <div className="flex items-center gap-6 lg:gap-10">
          <a href="#top" className="group flex items-center gap-2">
            <span className="agency-logo-mark flex items-center justify-center shadow-orange-500/20 group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(251,146,60,0.4)] transition-all duration-300 text-sm font-semibold text-white bg-gradient-to-br from-[#ff8964] via-orange-400 to-blue-500 w-8 h-8 rounded-xl relative shadow-lg">
              S
            </span>
            <span className="agency-wordmark group-hover:text-white/90 transition-colors duration-300 text-lg font-semibold text-white tracking-tight">
              Scrapivo
            </span>
            <span className="hidden sm:inline text-[10px] uppercase tracking-[0.28em] text-[#797d86] ml-1 group-hover:text-gray-400 transition-colors duration-300">
              Intent
            </span>
          </a>

          <div className="hidden md:flex items-center gap-1 bg-white/[0.03] border border-white/5 rounded-full p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md">
            <a href="#product" className="relative px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-white transition-colors rounded-full group">
              <span className="relative z-10">Product</span>
              <div className="absolute inset-0 bg-white/10 scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-300 rounded-full" />
            </a>
            <div
              className="relative group/dropdown flex items-center"
              onMouseEnter={() => setCommunityOpen(true)}
              onMouseLeave={() => setCommunityOpen(false)}
            >
              <button
                type="button"
                className="relative px-4 py-1.5 text-sm font-medium text-gray-400 group-hover/dropdown:text-white transition-colors rounded-full"
              >
                <span className="relative z-10 flex items-center gap-1">
                  Sources
                  <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${communityOpen ? "-rotate-180" : ""}`} />
                </span>
                <div className="absolute inset-0 bg-white/10 scale-50 opacity-0 group-hover/dropdown:scale-100 group-hover/dropdown:opacity-100 transition-all duration-300 rounded-full" />
              </button>
              <div
                className={`absolute top-full left-1/2 -translate-x-1/2 pt-4 z-50 transition-all duration-300 ${
                  communityOpen ? "opacity-100 visible translate-y-0 scale-100" : "opacity-0 invisible translate-y-2 scale-[0.98]"
                }`}
              >
                <div className="w-[420px] bg-[#090a0d]/95 backdrop-blur-2xl border border-white/10 rounded-3xl p-3 shadow-[0_24px_48px_rgba(0,0,0,0.5)] grid grid-cols-2 gap-2 text-left">
                  {[
                    { t: "Reddit", d: "Buyer threads & hiring posts" },
                    { t: "Hacker News", d: "Who is Hiring & Ask HN" },
                    { t: "GitHub", d: "Issues & discussions" },
                    { t: "Bluesky", d: "Public intent signals" },
                    { t: "Job boards", d: "RemoteOK, WWR, Remotive" },
                    { t: "More", d: "Dev.to, Mastodon, Lobsters" },
                  ].map((item) => (
                    <a
                      key={item.t}
                      href="#product"
                      className="flex flex-col gap-0.5 p-3 rounded-2xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all"
                    >
                      <span className="text-white font-medium text-sm">{item.t}</span>
                      <span className="text-gray-400 text-xs font-light">{item.d}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <a href="#faq" className="relative px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-white transition-colors rounded-full group">
              <span className="relative z-10">FAQ</span>
              <div className="absolute inset-0 bg-white/10 scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-300 rounded-full" />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            to={cta}
            className="relative px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-white transition-colors rounded-full hidden sm:block"
          >
            {ctaLabel === "Open app" ? "Open app" : "Sign in"}
          </Link>
          <Link
            to={cta}
            className="group relative font-medium text-black bg-white rounded-full transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] ml-2 border border-white/50 px-4 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm"
          >
            <span className="relative z-10 flex items-center gap-2">
              {ctaLabel === "Open app" ? "Open app" : "Start free"}
              <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-300" />
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

function DiscoverMock() {
  return (
    <div
      className="overflow-hidden min-h-[520px] flex flex-col md:flex-row agency-animate-entrance bg-[#0d0e12]/95 w-full max-w-6xl border-white/10 border rounded-[20px] mx-auto relative shadow-[0_0_80px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
      style={{
        maskImage: "linear-gradient(180deg, transparent, black 0%, black 55%, transparent)",
        WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 55%, transparent)",
      }}
    >
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

      {/* Thin sidebar */}
      <div className="hidden sm:flex flex-col shrink-0 bg-[#090a0d] w-16 z-20 border-white/5 border-r py-4 gap-6 items-center">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 text-xs font-bold">
          S
        </div>
        <div className="overflow-hidden cursor-pointer group bg-[#07080a] w-12 h-24 border-orange-500/25 border rounded-xl relative shadow-[0_0_24px_rgba(249,115,22,0.12)]">
          <div className="absolute inset-0 bg-gradient-to-b from-orange-500/25 via-orange-500/10 to-transparent opacity-70" />
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 w-9 rounded-xl bg-black/35 border border-orange-500/20 px-1.5 py-1 text-center">
            <div className="text-[15px] leading-none font-medium text-white">
              94<span className="text-[9px] text-white/70">%</span>
            </div>
            <div className="mt-2 h-[3px] w-full rounded-full bg-white/15 overflow-hidden">
              <div className="h-full w-[94%] rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.9)]" />
            </div>
          </div>
          <div className="absolute bottom-3 left-0 right-0 z-10 text-center">
            <span className="text-[9px] font-semibold tracking-wider text-white">HOT</span>
          </div>
        </div>
        <div className="flex flex-col gap-4 mt-2 w-full items-center">
          {[Bell, Calendar, MessageSquare, CheckSquare].map((Icon, i) => (
            <button
              key={i}
              type="button"
              className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                i === 3 ? "bg-white/10 text-white" : "text-white/40 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={1.5} />
              {i === 0 && <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-orange-500 rounded-full border border-[#090a0d]" />}
              {i === 3 && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-full" />}
            </button>
          ))}
        </div>
      </div>

      {/* Tracker */}
      <div className="w-56 bg-[#121318]/90 border-r border-white/5 p-4 flex-col shrink-0 hidden md:flex z-10">
        <h2 className="text-xl font-medium text-white mb-6 tracking-tight">Discover</h2>
        <div className="relative mb-6">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#797d86] w-4 h-4" strokeWidth={1.5} />
          <input
            readOnly
            type="text"
            placeholder="React freelancer..."
            className="w-full bg-[#1b1c22] border border-white/5 rounded-lg py-1.5 pl-9 pr-3 text-sm text-white placeholder-white/30 focus:outline-none"
          />
        </div>
        <div className="space-y-1 mb-6">
          {["Posts", "Companies", "People"].map((label, i) => (
            <button
              key={label}
              type="button"
              className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-colors ${
                i === 0 ? "text-white bg-white/5" : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[10px] font-medium text-white/40 px-2 mb-2 tracking-wider">SOURCES</div>
        <div className="space-y-1">
          {[
            { c: "border-orange-500", t: "Reddit" },
            { c: "border-blue-500 rounded-full", t: "Hacker News" },
            { c: "border-white/30 rounded-sm", t: "GitHub" },
          ].map((p) => (
            <button
              key={p.t}
              type="button"
              className="w-full flex items-center gap-2 px-2 py-1.5 text-white/70 hover:text-white hover:bg-white/5 rounded-md text-sm"
            >
              <div className={`w-3 h-3 border ${p.c} flex-shrink-0`} />
              {p.t}
            </button>
          ))}
        </div>
      </div>

      {/* Main + floating card */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#14151a]/90 relative overflow-hidden">
        <div className="px-6 py-5 border-b border-white/5 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 text-[13px] font-medium text-white/50">
              <span>Discover</span>
              <span className="text-white/20">/</span>
              <span className="text-[#ff8964]">Buyer intent</span>
            </div>
            <div className="flex -space-x-2">
              <div className="w-6 h-6 rounded-full border-2 border-[#14151a] bg-gradient-to-tr from-purple-500 to-pink-500" />
              <div className="w-6 h-6 rounded-full border-2 border-[#14151a] bg-gradient-to-tr from-blue-500 to-cyan-500" />
              <div className="w-6 h-6 rounded-full border-2 border-[#14151a] bg-[#2a2c33] flex items-center justify-center text-[10px] text-white/80">
                +3
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-normal text-white tracking-tight">Live leads</h2>
          <div className="flex gap-6 border-b border-white/5 pb-2 -mb-5">
            <button type="button" className="flex items-center gap-2 text-sm font-medium text-white pb-2 border-b-2 border-white">
              <Flame className="w-4 h-4 text-[#ff8964]" /> Hot
            </button>
            <button type="button" className="flex items-center gap-2 text-sm font-medium text-white/40 pb-2">
              Warm
            </button>
            <button type="button" className="flex items-center gap-2 text-sm font-medium text-white/40 pb-2">
              Signal
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 relative">
          <div className="scale-[0.92] origin-top -mt-2 pointer-events-none">
            <DashboardPreview />
          </div>

          <div className="absolute top-[28%] left-[8%] md:left-[18%] z-50 w-72 bg-[#1b1c23]/95 backdrop-blur-xl border border-white/20 rounded-xl p-4 flex-col gap-3 agency-float-card hidden sm:flex">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50 rounded-xl pointer-events-none" />
            <p className="text-sm font-medium leading-snug text-white relative z-10">
              Looking to hire a React + Postgres dev for a 6-week MVP
            </p>
            <div className="flex flex-wrap gap-1.5 relative z-10">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-300 border border-orange-500/30">
                Hot · 94%
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
                Reddit
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                Hiring
              </span>
            </div>
            <div className="flex items-center justify-between mt-1 relative z-10 text-[11px] text-white/40">
              <span className="flex items-center gap-1">
                <Github className="w-3.5 h-3.5" /> 2h ago
              </span>
              <span className="text-[#ff8964] font-medium">DM ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MomentumSection() {
  const cards = [
    {
      title: "Intent search",
      body: "Describe who you sell to. Scrapivo finds people asking for it right now — not cold lists.",
      icon: Search,
    },
    {
      title: "AI scoring",
      body: "Hot or Warm — ranked by recency, urgency, decision-maker cues, and budget signals.",
      icon: Zap,
    },
    {
      title: "1-click outreach",
      body: "Tailored DM, email, and call scripts grounded in the original post — no spray-and-pray.",
      icon: MessageSquare,
    },
    {
      title: "Pipeline ready",
      body: "Save leads, track replies, and keep every warm opportunity in one clean workspace.",
      icon: CheckSquare,
    },
  ];

  return (
    <section id="product" className="agency-section overflow-hidden text-white bg-[#050507] pt-28 pb-24 px-6 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-blue-900/10 via-purple-900/5 to-transparent blur-[120px] rounded-full pointer-events-none" />
      <div className="z-10 max-w-[80rem] mx-auto relative">
        <h2 className="md:text-7xl lg:text-[80px] font-normal tracking-tight leading-none mb-6 text-center text-balance text-5xl sm:text-6xl">
          Buyer-intent momentum
        </h2>
        <p className="md:text-2xl text-balance text-xl font-light text-gray-400 text-center max-w-3xl mx-auto mb-16">
          Scrapivo brings discovery, scoring, outreach, and pipeline into one refined system for operators who sell to people already asking.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {cards.map((c) => (
            <div
              key={c.title}
              className="relative overflow-hidden flex flex-col bg-[#0a0a0c] rounded-[32px] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_24px_48px_rgba(0,0,0,0.4)] p-8 md:p-10 min-h-[240px] group transition-all duration-500 hover:scale-[1.01] hover:border-white/[0.12]"
            >
              <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-orange-600/10 blur-[80px] pointer-events-none group-hover:opacity-100 opacity-70 transition-opacity" />
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-[#ff8964]">
                <c.icon className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <h3 className="text-2xl font-medium tracking-tight text-white mb-3">{c.title}</h3>
              <p className="text-gray-400 font-light leading-relaxed text-lg">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CollabSection() {
  return (
    <section className="overflow-hidden text-gray-900 font-sans bg-white pt-20 pb-28 relative">
      <div className="absolute top-0 inset-x-0 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-transparent opacity-80 pointer-events-none" />
      <div className="z-10 max-w-[80rem] mx-auto px-6 relative">
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200/60 text-blue-600 text-sm font-medium mb-8 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            Live discovery workspace
          </div>
          <h2 className="md:text-7xl font-semibold tracking-tighter text-gray-900 leading-[1.05] mb-6 text-4xl sm:text-5xl">
            Find, score, and
            <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">reach together.</span>
          </h2>
          <p className="text-lg md:text-xl text-gray-500 font-normal leading-relaxed max-w-2xl mx-auto">
            Posts, companies, and people — segmented from the same search — so your team can jump from signal to conversation in one place.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-16 max-w-6xl mx-auto">
          {[
            { n: "01", t: "Search once", d: "Natural language in. Scrapivo fans out across public sources and returns ranked intent." },
            { n: "02", t: "Segment cleanly", d: "Posts, companies, and decision-makers — recovered and enriched without the noise." },
            { n: "03", t: "Outreach in context", d: "Every lead links back to the original post so your reply sounds human, not automated." },
          ].map((f) => (
            <div
              key={f.n}
              className="group relative overflow-hidden rounded-[28px] border border-gray-200/70 bg-white/80 p-6 md:p-7 shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(15,23,42,0.10)]"
            >
              <div className="mb-8 flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200/80 bg-white/70 text-gray-700 shadow-sm">
                  <Zap className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-gray-200/80 bg-white/60 px-2.5 py-1 text-xs text-gray-500">{f.n}</span>
              </div>
              <h3 className="mb-2 text-xl font-medium tracking-tight text-gray-950">{f.t}</h3>
              <p className="text-base font-normal leading-relaxed text-gray-500">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgencyFooterCta({ cta }: { cta: string }) {
  return (
    <footer className="overflow-hidden flex flex-col text-white font-sans bg-[#050507] relative border-t border-white/10">
      <div className="absolute top-[20%] left-[-10%] w-[50vw] h-[160px] -rotate-[160deg] z-0 pointer-events-none opacity-60">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(249, 115, 22, 0.42) 1.4px, transparent 1.4px)",
            backgroundSize: "8px 8px",
            maskImage: "linear-gradient(105deg, transparent 0%, black 18%, black 68%, transparent 100%)",
          }}
        />
      </div>
      <div className="z-10 flex-1 flex flex-col lg:flex-row gap-12 lg:gap-20 w-full max-w-[80rem] mx-auto py-20 px-6 relative items-center justify-between">
        <div className="relative w-[220px] h-[220px] sm:w-[280px] sm:h-[280px] shrink-0">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/18 via-[#17181d] to-black shadow-[0_40px_100px_rgba(0,0,0,0.9)]" />
          <div className="absolute inset-[12px] rounded-full bg-[#050608]" />
          <div className="absolute inset-[24px] rounded-full overflow-hidden border border-white/[0.06] bg-[radial-gradient(circle_at_30%_48%,rgba(249,115,22,0.35),transparent_34%),radial-gradient(circle_at_68%_38%,rgba(79,112,255,0.42),transparent_38%),linear-gradient(180deg,rgba(18,20,26,0.88),rgba(4,5,7,0.98))]">
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-5xl font-semibold tracking-tighter text-white/90">S</span>
            </div>
            <div
              className="absolute inset-0 rounded-full animate-[spin_14s_linear_infinite]"
              style={{
                background:
                  "conic-gradient(from 292deg, transparent 0deg, transparent 10deg, rgba(96,165,250,0.75) 42deg, rgba(255,255,255,1) 64deg, transparent 76deg)",
                maskImage: "radial-gradient(circle, transparent 61%, black 62%, black 65%, transparent 66%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 61%, black 62%, black 65%, transparent 66%)",
              }}
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col items-start">
          <div className="text-xs font-medium text-gray-400 tracking-widest uppercase mb-5">SCRAPIVO</div>
          <h2 className="md:text-6xl lg:text-7xl leading-[1.05] text-balance font-normal text-white tracking-tight mb-6 text-4xl sm:text-5xl">
            Find buyers who already want you
          </h2>
          <p className="text-xl md:text-2xl text-gray-400 font-light leading-relaxed mb-10 max-w-xl">
            Scan public intent across Reddit, HN, GitHub, and more — scored, segmented, and ready to reach.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <div className="relative group w-full sm:w-auto">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500 rounded-full blur-md opacity-50 group-hover:opacity-100 transition-all duration-500" />
              <Link
                to={cta}
                className="relative w-full sm:w-auto bg-gradient-to-b from-white to-gray-200 text-black px-10 py-4 rounded-full text-base font-medium flex items-center justify-center gap-2 transform group-hover:-translate-y-[2px] transition-transform"
              >
                Start free
                <span className="text-lg">→</span>
              </Link>
            </div>
            <a
              href="#product"
              className="w-full sm:w-auto px-8 py-4 rounded-full border border-white/10 text-white text-base font-medium flex items-center justify-center gap-3 hover:bg-white/[0.03] hover:border-white/20 transition-all"
            >
              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-orange-400" style={{ animation: "agencyPulseBadge 2s infinite" }} />
              See how it works
            </a>
          </div>
        </div>
      </div>

      <div className="w-full relative z-10 border-t border-white/[0.06] mt-auto bg-black/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-500 font-light tracking-wide text-center md:text-left">
          <div>Copyright © {new Date().getFullYear()} Scrapivo. All rights reserved.</div>
          <div className="flex items-center gap-6">
            <a href="mailto:hello@scrapivo.app" className="hover:text-gray-200 transition-colors">
              hello@scrapivo.app
            </a>
            <a href="#faq" className="hover:text-gray-200 transition-colors">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-orange-500 text-base">♥</span>
            <span>Made for operators who sell</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function AgencyLanding({ cta, ctaLabel, children }: Props) {
  return (
    <div className="agency-theme antialiased selection:bg-[#ff8964] selection:text-white min-h-screen">
      <AgencyNav cta={cta} ctaLabel={ctaLabel} />

      <div id="top" className="flex flex-col z-10 max-w-[80rem] mx-auto pt-32 px-6 pb-12 relative items-start">
        <div className="agency-eyebrow inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.28em] text-white/70 mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff8964] shadow-[0_0_18px_rgba(255,137,100,.9)]" />
          Search · Score · Reach
        </div>
        <h1 className="md:text-8xl leading-none text-balance font-normal text-white tracking-tighter max-w-3xl mb-6 text-5xl sm:text-6xl">
          Find buyers
          <br />
          who already want you
        </h1>
        <p className="md:text-xl text-[#95979e] leading-relaxed text-lg font-light max-w-2xl mb-10">
          Scrapivo scans Reddit, Hacker News, GitHub, Bluesky and more to surface people actively asking for what you sell — scored and ready to reach.
        </p>

        <GlowCta to={cta} label={ctaLabel === "Open app" ? "Open app" : "See in action"} />

        <DiscoverMock />

        <div className="w-full max-w-6xl mx-auto mt-16 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-white/10 pt-8 relative z-10">
          <span className="text-[#95979e] text-sm sm:text-base text-center md:text-left">
            Everything you need to close warm leads:
          </span>
          <div className="flex flex-wrap font-medium gap-x-4 gap-y-2 text-sm sm:text-base justify-center md:justify-end">
            {["Buyer-Intent Search", "AI Scoring", "1-Click Outreach", "Pipeline", "Saved Leads"].map((t, i, arr) => (
              <span key={t} className="flex items-center gap-4">
                <span className="text-white">{t}</span>
                {i < arr.length - 1 && <span className="text-[#797d86]">·</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      <MomentumSection />
      <CollabSection />
      {children}
      <AgencyFooterCta cta={cta} />
    </div>
  );
}
