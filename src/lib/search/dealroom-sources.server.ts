// Dealroom public feeds — PitchBook-lite company + founder volume (no API key).
import type { ExpandedQueries } from "./query-expander";
import type { Lead } from "../scoring";

export type SourceLead = Lead & { intentBoost?: number };

type DealroomFounder = {
  name?: string;
  title?: string;
  linkedin?: string;
  photo?: string;
};

type DealroomStartup = {
  name?: string;
  slug?: string;
  website?: string;
  dealroomUrl?: string;
  fundingStatus?: string;
  sector?: string[];
  tagline?: string;
  location?: string;
  founded?: string;
  founders?: DealroomFounder[];
  story?: { building?: string };
};

function isInvestorHunt(qx: ExpandedQueries): boolean {
  const blob = `${qx.skill} ${qx.role} ${(qx.relatedSkills || []).join(" ")}`;
  return /investor|raising|fundraising|seed round|angel|venture/i.test(blob);
}

function craftHit(text: string, qx: ExpandedQueries): boolean {
  // Investors want newly founded / fundraising startups — not craft-title match.
  if (isInvestorHunt(qx)) return true;
  const needles = [qx.skill, qx.role, ...(qx.relatedSkills || [])]
    .filter(Boolean)
    .map((s) => s!.toLowerCase().trim())
    .filter((s) => s.length >= 3);
  if (!needles.length) return true;
  const hay = text.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

/**
 * Freshly founded startups from Dealroom's public just-founded feed.
 * Emits company rows + founder people (leading indicators → Warm cap).
 */
export async function searchDealroomJustFounded(qx: ExpandedQueries): Promise<SourceLead[]> {
  let startups: DealroomStartup[] = [];
  try {
    const res = await fetch("https://dealroom.co/data/just-founded.json", {
      headers: { Accept: "application/json", "User-Agent": "Scrapivo/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { startups?: DealroomStartup[] };
    startups = data.startups ?? [];
  } catch {
    return [];
  }

  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const s of startups) {
    const name = (s.name || "").trim();
    if (!name || name.toLowerCase() === "stealth startup") continue;
    const website = (s.website || "").trim();
    const url = s.dealroomUrl || website;
    if (!url || seen.has(url)) continue;

    const sector = (s.sector || []).join(" ");
    const hay = `${name} ${s.tagline || ""} ${sector} ${s.story?.building || ""} ${s.location || ""}`;
    // Prefer craft match; still take a handful of fresh founders for volume.
    if (!craftHit(hay, qx) && out.filter((l) => l.source === "dealroom").length >= 8) continue;

    seen.add(url);
    const snippet = [
      s.tagline || s.story?.building?.slice(0, 220) || `${name} — newly founded`,
      s.location ? `Location: ${s.location}` : "",
      s.fundingStatus ? `Funding: ${s.fundingStatus}` : "",
      website ? `Website: ${website}` : "",
      `Company: ${name}`,
    ]
      .filter(Boolean)
      .join("\n");

    out.push({
      source: "dealroom",
      platform: "Dealroom",
      platform_label: "Just founded",
      title: `${name} (newly founded)`,
      snippet: snippet.slice(0, 400),
      full_post_url: url,
      author: name,
      posted_at: undefined,
      is_decision_maker: true,
      signal_type: "leading_indicator",
      intentBoost: craftHit(hay, qx) ? 10 : 6,
      source_confidence: 70,
      match_reasons: ["Dealroom just-founded", ...(craftHit(hay, qx) ? ["Matches craft/sector"] : [])],
      why_match: "Newly founded startup — likely in-market for services soon",
    });

    for (const f of s.founders || []) {
      const fname = (f.name || "").trim();
      if (!fname || fname.length < 3) continue;
      const fUrl = f.linkedin || `${url}#founder-${encodeURIComponent(fname)}`;
      if (seen.has(fUrl)) continue;
      seen.add(fUrl);
      out.push({
        source: "dealroom",
        platform: "Dealroom",
        platform_label: "Founder",
        title: `${fname} — founder at ${name}`,
        snippet: [
          f.title || "Founder",
          `Company: ${name}`,
          s.tagline || "",
          website ? `Website: ${website}` : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 400),
        full_post_url: fUrl,
        author: fname,
        author_url: f.linkedin || undefined,
        is_decision_maker: true,
        signal_type: "leading_indicator",
        intentBoost: 8,
        source_confidence: 68,
        match_reasons: ["Dealroom founder", `At ${name}`],
        why_match: `Founder of newly founded ${name}`,
      });
    }
  }

  return out.slice(0, 40);
}
