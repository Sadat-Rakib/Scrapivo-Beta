/**
 * Investor directory search — seeded list only (no live VC scrape).
 */
import investorsFile from "../../../data/investors.json";
import type { InvestorRecord, InvestorsFile } from "./types";
import { deriveStatus } from "./types";

const data = investorsFile as InvestorsFile;

export function getAllInvestors(): InvestorRecord[] {
  return data.investors ?? [];
}

export type InvestorSearchFilters = {
  query?: string;
  stage?: string;
  sector?: string;
  location?: string;
  checkBand?: "angel" | "seed" | "growth" | "any";
  investorType?: "vc" | "angel" | "scout" | "unknown" | "any";
  status?: "active" | "needs_review" | "inactive" | "any";
  limit?: number;
};

function checkBandMatch(rec: InvestorRecord, band: InvestorSearchFilters["checkBand"]): boolean {
  if (!band || band === "any") return true;
  const sweet = rec.check_sweet_spot_usd || rec.check_max_usd || rec.check_min_usd;
  if (band === "angel") return sweet > 0 && sweet < 100_000;
  if (band === "seed") return sweet >= 100_000 && sweet <= 5_000_000;
  if (band === "growth") return sweet > 5_000_000;
  return true;
}

function stageNorm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/series-?/g, "series-");
}

export function searchInvestors(filters: InvestorSearchFilters = {}): InvestorRecord[] {
  const q = (filters.query || "").toLowerCase().trim();
  const stage = filters.stage && filters.stage !== "any" ? stageNorm(filters.stage) : "";
  const sector = (filters.sector || "").toLowerCase().trim();
  const location = (filters.location || "").toLowerCase().trim();
  const status = filters.status ?? "active";
  const type = filters.investorType ?? "any";
  const limit = filters.limit ?? 80;

  let rows = getAllInvestors().map((r) => ({
    ...r,
    status: deriveStatus(r),
  }));

  if (status !== "any") {
    rows = rows.filter((r) => r.status === status || (status === "active" && r.status === "needs_review" && q));
  }
  // Default directory: show active + needs_review (still useful), hide inactive.
  if (!filters.status) {
    rows = getAllInvestors().filter((r) => r.status !== "inactive");
  }

  if (type !== "any") rows = rows.filter((r) => r.investor_type === type);
  if (!checkBandMatch) {
    /* noop */
  }
  rows = rows.filter((r) => checkBandMatch(r, filters.checkBand));

  if (stage) {
    rows = rows.filter((r) =>
      r.stages.some((s) => stageNorm(s).includes(stage) || stage.includes(stageNorm(s))),
    );
  }
  if (sector) {
    rows = rows.filter((r) =>
      r.focus_areas.some((f) => f.sector.toLowerCase().includes(sector)),
    );
  }
  if (location) {
    rows = rows.filter((r) =>
      r.locations.some((l) => l.toLowerCase().includes(location)),
    );
  }
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.name,
        r.firm,
        r.title,
        ...r.locations,
        ...r.focus_areas.map((f) => `${f.sector} ${f.stage}`),
      ]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    });
  }

  return rows
    .sort((a, b) => {
      // Prefer active, then larger sweet spot as weak relevance proxy.
      const as = a.status === "active" ? 1 : 0;
      const bs = b.status === "active" ? 1 : 0;
      if (bs !== as) return bs - as;
      return (b.check_sweet_spot_usd || 0) - (a.check_sweet_spot_usd || 0);
    })
    .slice(0, limit);
}

/** Mark incomplete / zero-check rows for review (verification pass). */
export function verifyInvestorRecords(records: InvestorRecord[]): InvestorRecord[] {
  const now = new Date().toISOString();
  return records.map((r) => {
    const status = deriveStatus(r);
    const notes: string[] = [];
    if (status === "needs_review") {
      if (!r.locations.length) notes.push("missing_location");
      if (!r.focus_areas.length) notes.push("missing_focus");
      if (r.check_sweet_spot_usd === 0 && r.check_min_usd === 0) notes.push("zero_check_size");
      if (/^unknown$/i.test(r.title)) notes.push("unknown_title");
    }
    return {
      ...r,
      status,
      verification: {
        state: status === "needs_review" ? "unverified" : r.verification.state,
        last_checked_at: now,
        notes: notes.join(","),
      },
    };
  });
}
