import type { Lead } from "@/lib/scoring";
import {
  Bookmark,
  Crown,
  DollarSign,
  ExternalLink,
  ShieldCheck,
  ShieldQuestion,
  Zap,
} from "lucide-react";

const tierStyle = {
  hot: "bg-primary/15 text-primary border-primary/30",
  warm: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

/** Sources where `author` is the hiring COMPANY — show that, not the scraper. */
const ATS_SOURCES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "workatastartup",
  "usajobs",
  "samgov",
]);

/**
 * Badge: company name for ATS; named platform for social/marketplace.
 */
function displaySource(lead: Lead): string {
  if (ATS_SOURCES.has(lead.source)) {
    const company = (lead.author || "").trim();
    if (company) return company.charAt(0).toUpperCase() + company.slice(1);
    return "Company careers";
  }
  if (lead.source === "secedgar") return "SEC filing";
  if (lead.source === "news") return "News";
  const label = lead.platform_label ?? lead.platform ?? "";
  if (label) {
    return label.includes(":") ? label.split(":").slice(1).join(":").trim() || label : label;
  }
  const fallback: Record<string, string> = {
    reddit: "Reddit",
    redditrss: "Reddit",
    linkedin: "LinkedIn",
    twitter: "X",
    instagram: "Instagram",
    facebook: "Facebook",
    hn: "Hacker News",
    bluesky: "Bluesky",
    mastodon: "Mastodon",
    freelancer: "Freelancer",
    fiverr: "Fiverr",
    serpapi: "Web",
    tavily: "Web",
    searxng: "Web",
    webboolean: "Web",
  };
  return fallback[lead.source] || lead.source || "Web";
}

function VerificationBadge({ lead }: { lead: Lead }) {
  const level = lead.verification_level;
  if (!level || level === "scam") return null;
  if (level === "verified") {
    return (
      <span
        title={`Verified: ${(lead.legitimacy_proofs ?? []).join(" · ") || "identity checks passed"}`}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]"
      >
        <ShieldCheck className="size-3" /> Verified
      </span>
    );
  }
  if (level === "checked") {
    return (
      <span
        title={`Checked: ${(lead.legitimacy_proofs ?? []).join(" · ")}`}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border text-[10px]"
      >
        <ShieldCheck className="size-3" /> Checked
      </span>
    );
  }
  return (
    <span
      title={
        (lead.legitimacy_flags?.length
          ? `Caution: ${lead.legitimacy_flags.join(" · ")}`
          : "Could not verify the poster's identity yet") + " — do your own diligence."
      }
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]"
    >
      <ShieldQuestion className="size-3" /> Unverified
    </span>
  );
}

export function LeadCard({
  lead,
  onOpen,
  onSave,
  saved,
}: {
  lead: Lead & { id?: string };
  onOpen: () => void;
  onSave: () => void;
  saved?: boolean;
}) {
  const rawTier = lead.intent_tier ?? lead.tier;
  const tier: "hot" | "warm" | undefined =
    rawTier === "hot" ? "hot" : rawTier ? "warm" : undefined;
  const score = lead.intent_score ?? lead.score;
  const sourceLabel = displaySource(lead);
  return (
    <button
      onClick={onOpen}
      className="lead-card-hover text-left w-full p-4 rounded-xl border border-border bg-card transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
            {sourceLabel}
          </span>
          {tier && (
            <span
              className={`px-2 py-0.5 rounded-md border ${tierStyle[tier]} uppercase tracking-wide text-[10px] font-medium`}
            >
              {tier}
            </span>
          )}
          <VerificationBadge lead={lead} />
          {lead.is_decision_maker && (
            <span
              title="Decision maker"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20"
            >
              <Crown className="size-3" />
            </span>
          )}
          {lead.has_budget && (
            <span
              title="Mentions budget"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            >
              <DollarSign className="size-3" />
            </span>
          )}
          {lead.has_urgency && (
            <span
              title="Urgent"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20"
            >
              <Zap className="size-3" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {typeof score === "number" && (
            <span className="font-mono text-xs text-muted-foreground">{score}</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSave();
            }}
            className={`p-1 rounded hover:bg-accent ${saved ? "text-primary" : "text-muted-foreground"}`}
            aria-label="Save lead"
          >
            <Bookmark className="size-4" fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
      <div className="font-medium text-sm leading-snug line-clamp-2">{lead.title}</div>
      {lead.ai_summary && (
        <div className="mt-1.5 text-xs text-foreground/80 line-clamp-2">{lead.ai_summary}</div>
      )}
      {!lead.ai_summary && (
        <div className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{lead.snippet}</div>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">
          {lead.author ?? "anon"} · {lead.engagement ?? 0} eng.
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {lead.posted_at_relative ??
            (lead.posted_at ? new Date(lead.posted_at).toLocaleDateString() : "Recently (undated)")}
          <ExternalLink className="size-3" />
        </span>
      </div>
    </button>
  );
}
