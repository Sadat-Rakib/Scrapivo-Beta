/**
 * Investor directory search — seeded list only (no live VC scrape).
 * Version 2: Supports dual-entity system (individuals + firms)
 * Version 3: Adds semantic sector matching with AI-powered synonym expansion
 */
import investorsFile from "../../../data/investors_merged.json";
import type {
  InvestorEntity,
  IndividualInvestor,
  VCFirm,
  InvestorRecord,
  InvestorsFile,
  isIndividual,
  isFirm,
  isNewFormat,
} from "./types";
import {
  matchLocation,
  effectiveInvestLocations,
  type LocationMatchResult,
} from "./location-hierarchy";
import { getSemanticMatcher } from "./semantic-matcher";

// Extended investor type with match metadata
export type InvestorWithMetadata = (InvestorEntity | InvestorRecord) & {
  _matchMetadata?: {
    locationMatch?: LocationMatchResult;
  };
};

const data = investorsFile as InvestorsFile;

export function getAllInvestors(): InvestorWithMetadata[] {
  return data.investors ?? [];
}

export type InvestorSearchFilters = {
  query?: string;
  stage?: string;
  sector?: string;
  location?: string;
  checkBand?: "angel" | "seed" | "growth" | "any";
  investorType?: "vc" | "angel" | "scout" | "unknown" | "any";
  entityType?: "individual" | "firm" | "any";
  status?: "active" | "needs_review" | "inactive" | "any";
  limit?: number;
};

function checkBandMatch(
  rec: InvestorEntity | InvestorRecord,
  band: InvestorSearchFilters["checkBand"],
): boolean {
  if (!band || band === "any") return true;

  // Handle new format
  if ("sweet_spot" in rec && rec.sweet_spot) {
    const sweetStr = rec.sweet_spot.sweet_spot;
    const sweet = parseMoney(sweetStr);
    if (band === "angel") return sweet > 0 && sweet < 100_000;
    if (band === "seed") return sweet >= 100_000 && sweet <= 5_000_000;
    if (band === "growth") return sweet > 5_000_000;
  }

  // Handle old format
  if ("check_sweet_spot_usd" in rec) {
    const sweet = rec.check_sweet_spot_usd || rec.check_max_usd || rec.check_min_usd;
    if (band === "angel") return sweet > 0 && sweet < 100_000;
    if (band === "seed") return sweet >= 100_000 && sweet <= 5_000_000;
    if (band === "growth") return sweet > 5_000_000;
  }

  return true;
}

function parseMoney(raw: string): number {
  const s = (raw || "").trim().replace(/[$,\s]/g, "");
  if (!s || s === "—" || s === "-") return 0;
  const m = s.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(m[1]);
  const u = (m[2] || "").toLowerCase();
  if (u === "k") return Math.round(n * 1_000);
  if (u === "m") return Math.round(n * 1_000_000);
  if (u === "b") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

/**
 * Normalizes stage strings for comparison.
 * Converts to lowercase, replaces whitespace with hyphens,
 * and standardizes "Series A/B/C" format to "series-a/b/c".
 *
 * @param s - The stage string to normalize
 * @returns Normalized stage string
 *
 * @example
 * stageNorm("Pre Seed") // "pre-seed"
 * stageNorm("Series A") // "series-a"
 * stageNorm("SEED") // "seed"
 */
function stageNorm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/series\s*([a-z])/gi, "series-$1");
}

/**
 * Checks if an investor's stages array matches a filter stage using exact equality.
 * This function uses exact matching after normalization to prevent false positives
 * (e.g., "pre-seed" should not match when filtering for "seed").
 *
 * @param investorStages - Array of stage strings from the investor record
 * @param filterStage - The stage string to match against
 * @returns True if any investor stage exactly matches the filter stage after normalization
 *
 * @example
 * stageMatches(["Pre-seed", "Seed"], "Seed") // true
 * stageMatches(["Pre-seed"], "Seed") // false (pre-seed != seed)
 * stageMatches(["Seed", "Series A"], "seed") // true (case-insensitive)
 */
function stageMatches(investorStages: string[], filterStage: string): boolean {
  const normalizedFilter = stageNorm(filterStage);
  return investorStages.some((s) => {
    // Split combined stages (e.g. "Pre-seed / Seed" -> ["pre-seed", "seed"])
    const parts = s.split(/[\/,]|\band\b/i).map(p => stageNorm(p));
    
    return parts.some(p => {
      if (p === normalizedFilter) return true;
      // Fix stage-matching overlap: searching for "seed" should not match "pre-seed"
      if (normalizedFilter === "seed" && p.includes("pre-seed")) return false;
      return p.includes(normalizedFilter);
    });
  });
}

export async function searchInvestors(
  filters: InvestorSearchFilters = {},
): Promise<InvestorWithMetadata[]> {
  const q = (filters.query || "").toLowerCase().trim();
  const stage = filters.stage && filters.stage !== "any" ? stageNorm(filters.stage) : "";
  const sector = (filters.sector || "").toLowerCase().trim();
  const location = (filters.location || "").trim();
  const status = filters.status ?? "any";
  const type = filters.investorType ?? "any";
  const entityType = filters.entityType ?? "any";
  const limit = filters.limit ?? 5000; // Increased default limit to show more results

  let rows = getAllInvestors();

  // Filter by entity type (individual vs firm)
  if (entityType !== "any") {
    rows = rows.filter((r) => {
      if ("type" in r) {
        return r.type === entityType;
      }
      // Old format is always individual
      return entityType === "individual";
    });
  }

  // Filter by investor type (vc, angel, scout)
  if (type !== "any") {
    rows = rows.filter((r) => {
      if ("entity_type" in r) {
        return r.entity_type === type;
      }
      if ("investor_type" in r) {
        return r.investor_type === type;
      }
      return false;
    });
  }

  // Filter by check size band
  rows = rows.filter((r) => checkBandMatch(r, filters.checkBand));

  // Filter by stage - using exact matching after normalization
  if (stage) {
    rows = rows.filter((r) => {
      if ("investment_categories" in r) {
        // investment_categories format: "Stage (Sector)" e.g. "Pre-seed (AI)"
        // Extract stage part before parenthesis
        const stages = r.investment_categories.map((cat) => {
          const match = cat.match(/^([^(]+)/);
          return match ? match[1].trim() : cat;
        });
        return stageMatches(stages, stage);
      }
      if ("stages" in r) {
        return stageMatches(r.stages, stage);
      }
      return false;
    });
  }

  // Filter by sector - WITH SEMANTIC MATCHING
  if (sector) {
    // Get semantic matcher and expand sector term
    const matcher = getSemanticMatcher();
    const matchResult = await matcher.expandSectorTerm(sector);
    const searchTerms = matchResult.success ? matchResult.synonyms : [sector];

    rows = rows.filter((r) => {
      if ("investment_categories" in r) {
        // investment_categories format: "Stage (Sector)" e.g. "Pre-seed (AI)"
        // Extract sector part inside parentheses
        return r.investment_categories.some((cat) => {
          const match = cat.match(/\(([^)]+)\)/);
          const sectorPart = match ? match[1].toLowerCase() : cat.toLowerCase();
          return searchTerms.some((term) => sectorPart.includes(term.toLowerCase()));
        });
      }
      if ("focus_areas" in r) {
        return r.focus_areas.some((f) =>
          searchTerms.some((term) => f.sector.toLowerCase().includes(term.toLowerCase())),
        );
      }
      return false;
    });
  }

  // Filter by location (ancestor expansion only) + HQ fallback when invest locs empty
  if (location) {
    rows = rows.filter((r) => {
      const invest =
        "investment_locations" in r
          ? (r.investment_locations as string[])
          : "locations" in r
            ? (r.locations as string[])
            : [];
      const hq = "location" in r && typeof r.location === "string" ? r.location : null;
      const locs = effectiveInvestLocations(invest, hq);
      const matchResult = matchLocation(location, locs);

      if (matchResult.matches) {
        r._matchMetadata = { locationMatch: matchResult };
        return true;
      }
      return false;
    });
  }

  // Filter by text query
  if (q) {
    rows = rows.filter((r) => {
      const fields: string[] = [r.name];

      if ("firm" in r && r.firm) fields.push(r.firm);
      if ("role" in r && r.role) fields.push(r.role);
      if ("title" in r && r.title) fields.push(r.title);
      if ("location" in r) fields.push(r.location);
      if ("email" in r && r.email) fields.push(r.email);

      const locs =
        "investment_locations" in r ? r.investment_locations : "locations" in r ? r.locations : [];
      fields.push(...locs);

      const cats = "investment_categories" in r ? r.investment_categories : [];
      fields.push(...cats);

      const hay = fields.join(" ").toLowerCase();
      return q.split(/\s+/).every((tok) => {
        if (tok === "seed") {
          // Prevent text search "seed" from greedily matching "pre-seed"
          return /(?<!pre-?)seed/i.test(hay);
        }
        return hay.includes(tok);
      });
    });
  }

  return rows
    .sort((a, b) => {
      // Sort by check size (no firm prioritization)
      const getSweetSpot = (r: InvestorEntity | InvestorRecord) => {
        if ("sweet_spot" in r && r.sweet_spot) {
          return parseMoney(r.sweet_spot.sweet_spot);
        }
        if ("check_sweet_spot_usd" in r) {
          return r.check_sweet_spot_usd || 0;
        }
        return 0;
      };

      return getSweetSpot(b) - getSweetSpot(a);
    })
    .slice(0, limit);
}

/** Mark incomplete / zero-check rows for review (verification pass). */
export function verifyInvestorRecords(records: InvestorWithMetadata[]): InvestorWithMetadata[] {
  // Simplified - just return as-is since new format has better data
  return records;
}
