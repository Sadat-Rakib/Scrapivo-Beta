/**
 * Generates "Relevant Because" explanations for investor matches
 * Explains WHY an investor matches the user's search criteria
 */
import type { InvestorEntity, InvestorRecord } from "./types";
import type { LocationMatchResult } from "./location-hierarchy";

export interface SearchFilters {
  location?: string;
  stage?: string;
  sector?: string;
  checkBand?: "angel" | "seed" | "growth" | "any";
  query?: string;
}

export interface MatchMetadata {
  locationMatch?: LocationMatchResult;
}

function formatCheckRange(investor: InvestorEntity | InvestorRecord): string {
  // Handle new format
  if ("sweet_spot" in investor && investor.sweet_spot) {
    const { range_min, range_max } = investor.sweet_spot;
    return `${range_min}–${range_max}`;
  }

  // Handle old format
  if ("check_min_usd" in investor && "check_max_usd" in investor) {
    const formatUsd = (n: number): string => {
      if (!n) return "$0";
      if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
      if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
      return `$${n}`;
    };

    return `${formatUsd(investor.check_min_usd)}–${formatUsd(investor.check_max_usd)}`;
  }

  return "Check size available";
}

function extractStageAndSector(
  investor: InvestorEntity | InvestorRecord,
  filters: SearchFilters,
): { stage?: string; sector?: string } {
  let stage: string | undefined;
  let sector: string | undefined;

  // Extract from new format
  if ("investment_categories" in investor && investor.investment_categories.length > 0) {
    const firstCat = investor.investment_categories[0];
    // Format: "Stage (Sector)" e.g., "Pre-seed (AI)"
    const match = firstCat.match(/^([^(]+)\(([^)]+)\)/);
    if (match) {
      stage = match[1].trim();
      sector = match[2].trim();
    }
  }

  // Extract from old format
  if ("stages" in investor && investor.stages.length > 0) {
    stage = investor.stages[0];
  }
  if ("focus_areas" in investor && investor.focus_areas.length > 0) {
    sector = investor.focus_areas[0].sector;
  }

  // Filter to only show stage/sector if they match the search
  if (filters.stage && stage) {
    const normalizeStage = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
    if (normalizeStage(stage) !== normalizeStage(filters.stage)) {
      stage = undefined;
    }
  }

  if (filters.sector && sector) {
    if (!sector.toLowerCase().includes(filters.sector.toLowerCase())) {
      sector = undefined;
    }
  }

  return { stage, sector };
}

/**
 * Generates a concise "Relevant Because" explanation
 *
 * @example
 * // User searches "Bangladesh", investor has ["Asia"]
 * // Returns: "Invests in Asia region (includes Bangladesh). Focus on Pre-seed AI startups ($100K–$500K)"
 *
 * @example
 * // User searches "Bangladesh", investor has ["Bangladesh", "India"]
 * // Returns: "Directly invests in Bangladesh. Focus on Seed Fintech companies ($500K–$2M)"
 */
export function generateRelevantBecause(
  investor: InvestorEntity | InvestorRecord,
  filters: SearchFilters,
  metadata: MatchMetadata,
): string {
  const parts: string[] = [];

  // Location explanation
  if (filters.location && metadata.locationMatch?.matches) {
    const { matchType, matchedRegion } = metadata.locationMatch;

    if (matchType === "direct") {
      if (matchedRegion?.toLowerCase() === filters.location.toLowerCase()) {
        parts.push(`Directly invests in ${filters.location}`);
      } else {
        parts.push(`Invests in ${matchedRegion}`);
      }
    } else if (matchType === "region") {
      parts.push(`Invests in ${matchedRegion} region (includes ${filters.location})`);
    } else if (matchType === "continent") {
      parts.push(`Invests in ${matchedRegion} (includes ${filters.location})`);
    }
  }

  // Stage and sector
  const { stage, sector } = extractStageAndSector(investor, filters);

  if (stage && sector) {
    parts.push(`Focus on ${stage} ${sector} startups`);
  } else if (stage) {
    parts.push(`Focus on ${stage} stage`);
  } else if (sector) {
    parts.push(`Focus on ${sector}`);
  }

  // Check size range
  const range = formatCheckRange(investor);
  parts.push(`(${range})`);

  // Join parts
  if (parts.length === 0) {
    return "Matches your search criteria";
  }

  // Smart joining: location + focus details + range
  let result = parts[0];
  if (parts.length > 1) {
    result += ". " + parts.slice(1, -1).join(". ");
    if (parts.length > 1) {
      result += " " + parts[parts.length - 1];
    }
  }

  return result;
}
