import {
  Search,
  Filter,
  Bookmark,
  MessageSquare,
  Flame,
  Zap,
  TrendingUp,
  Github,
  MessageCircle,
  Hash,
} from "lucide-react";

/**
 * Static Scrapivo lead-feed mockup used inside the landing hero panel.
 * No live data — pure presentation. Lit from above by HeroBeam.
 */
type LeadCard = {
  platform: "Reddit" | "Hacker News" | "GitHub" | "Bluesky";
  tier: "Hot" | "Warm";
  title: string;
  snippet: string;
  score: number;
  posted: string;
};

const LEADS: LeadCard[] = [
  {
    platform: "Reddit",
    tier: "Hot",
    title: "Looking to hire a React + Postgres dev for a 6-week MVP",
    snippet:
      "We've got the designs done, need someone senior who can ship. Paying market rate. DMs open — please include 2 prior projects.",
    score: 94,
    posted: "2h ago",
  },
  {
    platform: "Hacker News",
    tier: "Hot",
    title: "Ask HN: who do you use for cold outbound that actually works?",
    snippet:
      "Tried Apollo and Instantly, hated both. Want something that finds intent, not just emails. 15-person agency, budget flexible.",
    score: 89,
    posted: "5h ago",
  },
  {
    platform: "GitHub",
    tier: "Warm",
    title: "[Discussion] Replacing our self-hosted Mailchimp setup",
    snippet:
      "Our team of 8 has outgrown the OSS version. Looking for managed alternatives — pricing and deliverability are top concerns.",
    score: 76,
    posted: "1d ago",
  },
  {
    platform: "Bluesky",
    tier: "Warm",
    title: "anyone know a freelance brand designer for fintech?",
    snippet:
      "Need a logo + identity system in the next 4 weeks. Will pay for quality. Quote replies welcome with portfolio links.",
    score: 71,
    posted: "1d ago",
  },
];

const platformIcon = (p: LeadCard["platform"]) => {
  switch (p) {
    case "Reddit":
      return <MessageCircle className="size-3.5" />;
    case "Hacker News":
      return <Hash className="size-3.5" />;
    case "GitHub":
      return <Github className="size-3.5" />;
    case "Bluesky":
      return <MessageSquare className="size-3.5" />;
  }
};

export function DashboardPreview() {
  return (
    <div className="relative">
      {/* beam-to-panel glow bleed */}
      <div
        aria-hidden
        className="absolute -top-24 left-[60%] -translate-x-1/2 w-[80%] h-48 pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(235,240,255,0.32), rgba(200,210,230,0.14) 45%, transparent 75%)",
          filter: "blur(40px)",
        }}
      />

      <div className="relative rounded-2xl border border-white/10 bg-[#0a0a0b]/90 backdrop-blur-2xl shadow-2xl overflow-hidden">
        {/* top gradient catching beam light */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-32 pointer-events-none"
          style={{
            background: "linear-gradient(180deg, rgba(235,240,255,0.14) 0%, transparent 100%)",
          }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-3.5 border-b border-white/5 bg-white/[0.015]">
          <div className="flex items-center gap-3">
            <div className="size-6 rounded-md bg-primary flex items-center justify-center">
              <Search className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-medium tracking-tight text-white">Scrapivo</span>
            <span className="hidden md:inline text-xs text-white/30">/ Discover</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 min-w-[260px]">
              <Search className="size-3.5 text-white/40" />
              <span className="text-xs text-white/40">
                Find buyers for "React + Postgres devs"…
              </span>
            </div>
            <div className="size-7 rounded-full bg-gradient-to-tr from-primary to-amber-400 border border-white/20" />
          </div>
        </div>

        <div className="flex flex-col md:flex-row min-h-[460px]">
          {/* Sidebar */}
          <aside className="w-full md:w-64 border-r border-white/5 p-4 flex flex-col gap-5 bg-white/[0.01]">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40 mb-2.5">
                Saved Searches
              </div>
              <ul className="space-y-1 text-xs">
                <li className="flex items-center justify-between px-2.5 py-2 rounded-md bg-white/[0.06] text-white">
                  <span className="truncate">React + Postgres devs</span>
                  <span className="text-white/40">24</span>
                </li>
                <li className="flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-white/[0.04] text-white/60">
                  <span className="truncate">Outbound tools — agencies</span>
                  <span className="text-white/40">12</span>
                </li>
                <li className="flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-white/[0.04] text-white/60">
                  <span className="truncate">Fintech brand designers</span>
                  <span className="text-white/40">7</span>
                </li>
              </ul>
            </div>

            <div className="mt-auto rounded-xl border border-white/5 bg-black/30 p-4">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40 mb-2">
                Pipeline
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-light text-white tracking-tight leading-none">
                    43
                  </div>
                  <div className="text-[11px] text-white/40 mt-1">active leads</div>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <TrendingUp className="size-3" />
                  +18%
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[11px]">
                <span className="text-white/40">Replies this week</span>
                <span className="text-white">11</span>
              </div>
            </div>
          </aside>

          {/* Feed */}
          <div className="flex-1 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5">
                <button className="px-2.5 py-1 rounded-md text-xs font-medium bg-white/10 text-white">
                  All
                </button>
                <button className="px-2.5 py-1 rounded-md text-xs font-medium text-white/50 hover:text-white inline-flex items-center gap-1">
                  <Flame className="size-3" /> Hot
                </button>
                <button className="px-2.5 py-1 rounded-md text-xs font-medium text-white/50 hover:text-white inline-flex items-center gap-1">
                  <Zap className="size-3" /> Warm
                </button>
              </div>
              <button className="inline-flex items-center gap-1.5 text-xs text-white/50 border border-white/10 rounded-md px-2.5 py-1">
                <Filter className="size-3" /> Filter
              </button>
            </div>

            <div className="space-y-2.5">
              {LEADS.map((l) => (
                <article
                  key={l.title}
                  className="group rounded-xl border border-white/8 bg-white/[0.015] hover:bg-white/[0.03] transition-colors p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-[11px] text-white/50">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 bg-black/30">
                        {platformIcon(l.platform)}
                        {l.platform}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                          l.tier === "Hot"
                            ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {l.tier === "Hot" ? (
                          <Flame className="size-3" />
                        ) : (
                          <Zap className="size-3" />
                        )}
                        {l.tier}
                      </span>
                      <span className="text-white/30">· {l.posted}</span>
                    </div>
                    <div className="text-[11px] text-white/40">
                      Score <span className="text-white font-medium">{l.score}</span>
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-white tracking-tight">{l.title}</h3>
                  <p className="text-xs text-white/50 mt-1.5 leading-relaxed line-clamp-2">
                    {l.snippet}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button className="inline-flex items-center gap-1 text-[11px] text-white/60 hover:text-white border border-white/10 rounded-md px-2 py-1">
                      <Bookmark className="size-3" /> Save
                    </button>
                    <button className="inline-flex items-center gap-1 text-[11px] text-white border border-primary/40 bg-primary/15 hover:bg-primary/25 rounded-md px-2 py-1">
                      <MessageSquare className="size-3" /> Draft reply
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
