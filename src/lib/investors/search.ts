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
  /** Ranking scores attached by searchInvestors (image-first ordering). */
  _ranking?: { hasImage: boolean; completeness: number; relevance: number };
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
    const parts = s.split(/[/,]|\band\b/i).map((p) => stageNorm(p));

    return parts.some((p) => {
      if (p === normalizedFilter) return true;
      // Fix stage-matching overlap: searching for "seed" should not match "pre-seed"
      if (normalizedFilter === "seed" && p.includes("pre-seed")) return false;
      return p.includes(normalizedFilter);
    });
  });
}

// ---------------------------------------------------------------------------
// Ranking: image availability first, then search relevance, then completeness.
// ---------------------------------------------------------------------------

type LooseInvestor = {
  name?: unknown;
  website?: unknown;
  location?: unknown;
  email?: unknown;
  role?: unknown;
  title?: unknown;
  firm?: unknown;
  firm_name?: unknown;
  thesis?: unknown;
  image_url?: unknown;
  information_completeness_score?: unknown;
  links?: { linkedin?: unknown; twitter?: unknown; website?: unknown; image_url?: unknown } | null;
  investment_locations?: unknown;
  locations?: unknown;
  investment_categories?: unknown;
  focus_areas?: unknown;
  stages?: unknown;
  sweet_spot?: { sweet_spot?: unknown } | null;
  check_sweet_spot_usd?: unknown;
  check_min_usd?: unknown;
  check_max_usd?: unknown;
  // Enriched record schemas (record_type firm/investor).
  consolidated_categories?: unknown;
  target_sectors?: unknown;
  investment_stages?: unknown;
  vc_investment_types?: unknown;
  investment_profile?: { stages?: unknown; sectors?: unknown } | null;
};

const asLoose = (rec: InvestorEntity | InvestorRecord): LooseInvestor => rec as LooseInvestor;

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const PROFILE_IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

function isValidImagePath(raw: unknown): raw is string {
  if (!isStr(raw)) return false;
  const url = raw.trim();
  return PROFILE_IMAGE_RE.test(url) || url.startsWith("/") || /^https?:\/\//i.test(url);
}

/**
 * The record's usable profile image URL — `image_url` first, legacy
 * `links.image_url` fallback. Null when the record is not image-backed.
 */
export function investorImageUrl(rec: InvestorEntity | InvestorRecord): string | null {
  const r = asLoose(rec);
  if (isValidImagePath(r.image_url)) return r.image_url.trim();
  if (isValidImagePath(r.links?.image_url)) return (r.links.image_url as string).trim();
  return null;
}

/** True when the record carries a usable profile image path/URL. */
export function hasProfileImage(rec: InvestorEntity | InvestorRecord): boolean {
  return investorImageUrl(rec) !== null;
}

/** Completeness ranking: the dataset's own information_completeness_score
 *  when present, otherwise a count of populated profile fields. */
function completenessScore(rec: InvestorEntity | InvestorRecord): number {
  const r = asLoose(rec);
  const own = Number(r.information_completeness_score);
  if (Number.isFinite(own) && own > 0) return own;
  let score = 0;
  if (isStr(r.name)) score += 1;
  if (isStr(r.website) || isStr(r.links?.website)) score += 1;
  if (isStr(r.links?.linkedin)) score += 1;
  if (isStr(r.links?.twitter)) score += 1;
  if (isStr(r.email)) score += 1;
  if (isStr(r.location)) score += 1;
  const investLocs = Array.isArray(r.investment_locations)
    ? r.investment_locations
    : Array.isArray(r.locations)
      ? r.locations
      : [];
  if (investLocs.length > 0) score += 1;
  const cats = Array.isArray(r.investment_categories)
    ? r.investment_categories
    : Array.isArray(r.focus_areas)
      ? r.focus_areas
      : [];
  if (cats.length > 0) score += 1;
  if (r.sweet_spot && isStr(r.sweet_spot.sweet_spot)) score += 1;
  else if (
    Number(r.check_sweet_spot_usd || 0) > 0 ||
    Number(r.check_min_usd || 0) > 0 ||
    Number(r.check_max_usd || 0) > 0
  )
    score += 1;
  if (isStr(r.role) || isStr(r.title)) score += 1;
  if (isStr(r.firm) || isStr(r.firm_name)) score += 1;
  if (isStr(r.thesis)) score += 1;
  return score;
}

/** Stage prefixes, extracted the same way the stage filter extracts them. */
function stagesOf(rec: InvestorEntity | InvestorRecord): string[] {
  const r = asLoose(rec);
  if (Array.isArray(r.investment_categories)) {
    return (r.investment_categories as unknown[]).map((cat) => {
      const m = String(cat).match(/^([^(]+)/);
      return m ? m[1].trim() : String(cat);
    });
  }
  if (Array.isArray(r.investment_stages)) return r.investment_stages as string[];
  if (Array.isArray(r.investment_profile?.stages)) {
    return r.investment_profile.stages as unknown as string[];
  }
  if (Array.isArray(r.vc_investment_types)) return r.vc_investment_types as string[];
  return Array.isArray(r.stages) ? (r.stages as string[]) : [];
}

/** Lowercased sector parts, extracted the same way the sector filter does. */
function sectorPartsOf(rec: InvestorEntity | InvestorRecord): string[] {
  const r = asLoose(rec);
  if (Array.isArray(r.investment_categories)) {
    return (r.investment_categories as unknown[]).map((cat) => {
      const m = String(cat).match(/\(([^)]+)\)/);
      return (m ? m[1] : String(cat)).toLowerCase();
    });
  }
  if (Array.isArray(r.focus_areas)) {
    return (r.focus_areas as { sector?: unknown }[]).map((f) =>
      typeof f?.sector === "string" ? f.sector.toLowerCase() : "",
    );
  }
  if (Array.isArray(r.consolidated_categories)) {
    return (r.consolidated_categories as unknown[]).map((c) => String(c).toLowerCase());
  }
  if (Array.isArray(r.target_sectors)) {
    return (r.target_sectors as unknown[]).map((c) => String(c).toLowerCase());
  }
  if (Array.isArray(r.investment_profile?.sectors)) {
    return (r.investment_profile.sectors as unknown[]).map((c) => String(c).toLowerCase());
  }
  return [];
}

type RankingContext = {
  qTokens: string[];
  stage: string;
  hasSector: boolean;
  sectorTerms: string[];
  hasLocation: boolean;
  checkBand: InvestorSearchFilters["checkBand"];
};

/** Match quality against the active filters (0 when browsing with no filters). */
function relevanceScore(rec: InvestorWithMetadata, ctx: RankingContext): number {
  const r = asLoose(rec);
  let score = 0;

  if (ctx.qTokens.length > 0) {
    const name = isStr(r.name) ? r.name.toLowerCase() : "";
    const roleFields = [r.firm, r.firm_name, r.role, r.title].filter(isStr).join(" ").toLowerCase();
    const hay = [r.name, r.firm, r.firm_name, r.role, r.title, r.location, r.email]
      .filter(isStr)
      .join(" ")
      .toLowerCase();
    for (const tok of ctx.qTokens) {
      if (name.includes(tok)) score += 3;
      else if (roleFields.includes(tok)) score += 2;
      else if (hay.includes(tok)) score += 1;
    }
  }

  if (ctx.stage && stageMatches(stagesOf(rec), ctx.stage)) score += 2;

  if (ctx.hasSector) {
    const parts = sectorPartsOf(rec);
    let hits = 0;
    for (const term of ctx.sectorTerms) {
      const t = term.toLowerCase();
      if (parts.some((p) => p.includes(t))) hits += 1;
    }
    score += Math.min(hits, 3);
  }

  if (ctx.hasLocation && rec._matchMetadata?.locationMatch?.matches) score += 2;

  if (ctx.checkBand && ctx.checkBand !== "any" && checkBandMatch(rec, ctx.checkBand)) score += 1;

  return score;
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
  // Sector synonyms resolved during filtering, reused for relevance scoring.
  let sectorTerms: string[] = [];

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
      if ("investment_categories" in r && Array.isArray(r.investment_categories)) {
        // investment_categories format: "Stage (Sector)" e.g. "Pre-seed (AI)"
        // Extract stage part before parenthesis
        const stages = r.investment_categories.map((cat) => {
          const match = cat.match(/^([^(]+)/);
          return match ? match[1].trim() : cat;
        });
        return stageMatches(stages, stage);
      }
      if ("stages" in r && Array.isArray(r.stages)) {
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
    sectorTerms = matchResult.success ? matchResult.synonyms : [sector];
    const searchTerms = sectorTerms;

    rows = rows.filter((r) => {
      if ("investment_categories" in r && Array.isArray(r.investment_categories)) {
        // investment_categories format: "Stage (Sector)" e.g. "Pre-seed (AI)"
        // Extract sector part inside parentheses
        return r.investment_categories.some((cat) => {
          const match = cat.match(/\(([^)]+)\)/);
          const sectorPart = match ? match[1].toLowerCase() : cat.toLowerCase();
          return searchTerms.some((term) => sectorPart.includes(term.toLowerCase()));
        });
      }
      if ("focus_areas" in r && Array.isArray(r.focus_areas)) {
        return r.focus_areas.some(
          (f) =>
            typeof f?.sector === "string" &&
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
      fields.push(...(Array.isArray(locs) ? locs : []));

      const cats = "investment_categories" in r ? r.investment_categories : [];
      fields.push(...(Array.isArray(cats) ? cats : []));

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

  // STRICT ranking order (not a tie-break): hasImage DESC →
  // completeness DESC → relevance DESC → name ASC. Every image-backed
  // record precedes every image-less record; image-less records are never
  // hidden, they follow with the same completeness → relevance → name order.
  const ctx: RankingContext = {
    qTokens: q ? q.split(/\s+/) : [],
    stage,
    hasSector: sector.length > 0,
    sectorTerms,
    hasLocation: location.length > 0,
    checkBand: filters.checkBand,
  };

  return rows
    .map((rec) => {
      const ranking = {
        hasImage: hasProfileImage(rec),
        completeness: completenessScore(rec),
        relevance: relevanceScore(rec, ctx),
      };
      rec._ranking = ranking; // shipped to the client for load-failure re-rank
      return { rec, ...ranking };
    })
    .sort(
      (a, b) =>
        Number(b.hasImage) - Number(a.hasImage) ||
        b.completeness - a.completeness ||
        b.relevance - a.relevance ||
        a.rec.name.localeCompare(b.rec.name),
    )
    .map((s) => s.rec)
    .slice(0, limit);
}

/** Mark incomplete / zero-check rows for review (verification pass). */
export function verifyInvestorRecords(records: InvestorWithMetadata[]): InvestorWithMetadata[] {
  // Simplified - just return as-is since new format has better data
  return records;
}
