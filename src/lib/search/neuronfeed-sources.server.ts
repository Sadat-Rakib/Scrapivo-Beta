// NeuronFeed — free JSON feed of startups (funding + tagline). No API key.
// Useful for investor / raising-intent Discover volume alongside Dealroom.
import type { ExpandedQueries } from "./query-expander";
import type { Lead } from "../scoring";

export type SourceLead = Lead & { intentBoost?: number };

type NfStartup = {
  slug?: string;
  name?: string;
  tagline?: string;
  description?: string;
  website?: string;
  url?: string;
  hq?: { country?: string | null; city?: string | null };
  funding?: {
    total_usd?: number | null;
    latest_round_type?: string | null;
    latest_round_date?: string | null;
  };
  founded_year?: number | null;
};

function isInvestorHunt(qx: ExpandedQueries): boolean {
  const blob = `${qx.skill} ${qx.role} ${(qx.relatedSkills || []).join(" ")} ${(qx.buyerPhrases || []).join(" ")}`;
  return /investor|raising|fundraising|seed|angel|venture|capital/i.test(blob);
}

function craftHit(text: string, qx: ExpandedQueries): boolean {
  if (isInvestorHunt(qx)) {
    // Investor mode: early-stage / funding signal is the match, not craft nouns.
    return /seed|pre-?seed|angel|series[- ]?[ab]|raising|fundraising|founded/i.test(text);
  }
  const needles = [qx.skill, qx.role, ...(qx.relatedSkills || [])]
    .filter(Boolean)
    .map((s) => s!.toLowerCase().trim())
    .filter((s) => s.length >= 3 && !/^(product|app|tool)$/i.test(s));
  if (!needles.length) return true;
  const hay = text.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

/**
 * Newest startups from NeuronFeed public API.
 * Prefer early rounds for investor queries; craft-match otherwise.
 */
export async function searchNeuronFeedStartups(qx: ExpandedQueries): Promise<SourceLead[]> {
  let rows: NfStartup[] = [];
  try {
    const res = await fetch("https://neuronfeed.com/api/v1/startups?sort=newest&limit=40", {
      headers: { Accept: "application/json", "User-Agent": "Scrapivo/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: NfStartup[] };
    rows = data.data ?? [];
  } catch {
    return [];
  }

  const out: SourceLead[] = [];
  const seen = new Set<string>();
  const investor = isInvestorHunt(qx);

  for (const s of rows) {
    const name = (s.name || "").trim();
    if (!name) continue;
    const url = (
      s.website ||
      s.url ||
      (s.slug ? `https://neuronfeed.com/startups/${s.slug}` : "")
    ).trim();
    if (!url || seen.has(url)) continue;

    const round = (s.funding?.latest_round_type || "").toLowerCase();
    const loc = [s.hq?.city, s.hq?.country].filter(Boolean).join(", ");
    const hay = `${name} ${s.tagline || ""} ${s.description || ""} ${round} ${loc}`;

    if (investor) {
      // Prefer pre-seed / seed / angel; still take a few series-a for volume.
      const early = /pre-?seed|seed|angel|bootstrapp/i.test(round) || !round;
      if (!early && out.length >= 12) continue;
    } else if (!craftHit(hay, qx) && out.length >= 6) {
      continue;
    }

    seen.add(url);
    const snippet = [
      s.tagline || (s.description || "").slice(0, 220) || `${name} — startup`,
      loc ? `Location: ${loc}` : "",
      round
        ? `Funding: ${round}${s.funding?.latest_round_date ? ` (${s.funding.latest_round_date})` : ""}`
        : "",
      s.website ? `Website: ${s.website}` : "",
      `Company: ${name}`,
    ]
      .filter(Boolean)
      .join("\n");

    out.push({
      source: "neuronfeed",
      platform: "NeuronFeed",
      platform_label: investor ? "Startup (funding)" : "Startup",
      title: investor
        ? `${name}${round ? ` — ${round}` : " — startup"}`
        : `${name}${s.tagline ? `: ${s.tagline.slice(0, 80)}` : ""}`,
      snippet: snippet.slice(0, 400),
      full_post_url: url,
      author: name,
      posted_at: s.funding?.latest_round_date
        ? new Date(s.funding.latest_round_date).toISOString()
        : undefined,
      is_decision_maker: true,
      signal_type: "leading_indicator",
      intentBoost: investor ? 12 : craftHit(hay, qx) ? 9 : 5,
      source_confidence: 72,
      match_reasons: [
        "NeuronFeed startup",
        ...(round ? [`Round: ${round}`] : []),
        ...(loc ? [`HQ: ${loc}`] : []),
      ],
      why_match: investor
        ? `${name} appears in a public startup feed${round ? ` (${round})` : ""} — useful for deal-flow / outreach`
        : `Startup matching craft/sector signals`,
    });
  }

  return out.slice(0, investor ? 36 : 20);
}
