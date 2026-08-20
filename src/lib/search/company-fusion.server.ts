// Lightweight company-signal fusion: group leads that share a company name and
// attach multi-signal "why now" reasons at search time (not only on research click).
import type { Lead } from "../scoring";

function companyKey(lead: Lead): string | null {
  const fromAuthor = (lead.author || "").trim();
  if (fromAuthor && fromAuthor.length > 1 && fromAuthor.toLowerCase() !== "anon") {
    return fromAuthor
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  const m = lead.title.match(/@\s*([^—\-|]+)/);
  if (m)
    return m[1]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const dir = lead.title.match(/^(.+?)\s*(?:—|-)\s*/);
  if (
    lead.source === "geoapify" ||
    lead.source === "foursquare" ||
    lead.source === "startupsgallery" ||
    lead.source === "startups_gallery"
  ) {
    return (dir?.[1] || lead.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  return null;
}

/**
 * For companies that appear on 2+ leads/sources, enrich the highest-scoring
 * lead with fused why-now reasons. Does not invent facts.
 */
export function fuseCompanySignals(leads: Lead[]): Lead[] {
  const byCompany = new Map<string, Lead[]>();
  for (const l of leads) {
    const key = companyKey(l);
    if (!key || key.length < 2) continue;
    const arr = byCompany.get(key) ?? [];
    arr.push(l);
    byCompany.set(key, arr);
  }

  const enrichUrl = new Map<string, string[]>();
  for (const [company, group] of byCompany) {
    if (group.length < 2) continue;
    const reasons: string[] = [];
    const platforms = Array.from(new Set(group.map((g) => g.platform)));
    if (platforms.length >= 2) {
      reasons.push(`Seen across ${platforms.slice(0, 3).join(", ")}`);
    }
    if (group.some((g) => g.signal_type === "leading_indicator")) {
      reasons.push("Has a leading indicator (funding / directory / Form D)");
    }
    if (group.some((g) => /hiring|looking for|urgent/i.test(`${g.title} ${g.snippet}`))) {
      reasons.push(`Active hiring / “looking for” signal at ${company}`);
    }
    if (group.some((g) => g.has_urgency)) {
      reasons.push("Urgent timing language detected");
    }
    if (group.some((g) => /geoapify|foursquare|local business/i.test(g.platform))) {
      reasons.push("Matched as a local/SMB listing");
    }
    if (!reasons.length) continue;
    // Attach to the highest-scoring member
    const best = [...group].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    enrichUrl.set(best.full_post_url, reasons);
  }

  return leads.map((l) => {
    const extra = enrichUrl.get(l.full_post_url);
    if (!extra?.length) return l;
    const match_reasons = Array.from(new Set([...(l.match_reasons ?? []), ...extra]));
    const why_match = `Why now: ${extra.slice(0, 3).join("; ")}.`;
    return {
      ...l,
      match_reasons,
      why_match: l.why_match ? `${l.why_match} ${why_match}` : why_match,
      score: Math.min(100, (l.score ?? 0) + Math.min(8, extra.length * 3)),
    };
  });
}
