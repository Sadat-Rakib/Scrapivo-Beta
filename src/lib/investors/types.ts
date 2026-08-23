/**
 * Investor directory types — AI-friendly structured records for seed DB search.
 * Version 2: Supports both individual investors and VC firms
 */

// Backward compatibility
export type InvestorFocus = {
  sector: string;
  stage: string;
};

// Base entity fields shared by both individuals and firms
interface BaseEntity {
  id: string;
  type: "individual" | "firm";
  name: string;
  entity_type: string;
  website?: string;
  links: {
    linkedin?: string | null;
    twitter?: string | null;
    website?: string | null;
    firm?: string | null;
  };
  location: string;
  investment_locations: string[];
  investment_categories: string[];
  sweet_spot?: {
    sweet_spot: string;
    range_min: string;
    range_max: string;
    raw: string;
  };
  verification_status?: string;
  source?: string;
}

// Individual investor (person)
export interface IndividualInvestor extends BaseEntity {
  type: "individual";
  firm: string;
  firm_id?: string;
  role: string;
  entity_type: "vc" | "angel" | "scout" | "investor";
  email?: string;
}

// VC firm/organization
export interface VCFirm extends BaseEntity {
  type: "firm";
  entity_type: "venture_capital_firm" | "micro_vc" | "angel_network" | "accelerator";
  thesis?: string;
  founded_year?: number;
  total_investments?: number;
  team_size?: number;
}

// Union type for any investor entity
export type InvestorEntity = IndividualInvestor | VCFirm;

// Backward compatible - old format (deprecated, but still supported)
export type InvestorRecord = {
  id: string;
  name: string;
  firm: string;
  title: string;
  investor_type: "vc" | "angel" | "scout" | "unknown";
  check_sweet_spot_usd: number;
  check_min_usd: number;
  check_max_usd: number;
  locations: string[];
  focus_areas: InvestorFocus[];
  stages: string[];
  status: "active" | "needs_review" | "inactive";
  verification: {
    state: "unverified" | "verified" | "stale";
    last_checked_at: string | null;
    notes: string;
  };
  links: {
    linkedin: string | null;
    firm: string | null;
    profile: string | null;
  };
  source_batch: string;
};

export type InvestorsFile = {
  schema_version: number;
  generated_at: string;
  total_entities?: number;
  firms?: number;
  individuals?: number;
  investors: (InvestorRecord | InvestorEntity)[];
};

// Type guards
export function isIndividual(
  entity: InvestorEntity | InvestorRecord,
): entity is IndividualInvestor {
  return "type" in entity && entity.type === "individual";
}

export function isFirm(entity: InvestorEntity | InvestorRecord): entity is VCFirm {
  return "type" in entity && entity.type === "firm";
}

export function isNewFormat(entity: InvestorEntity | InvestorRecord): entity is InvestorEntity {
  return "type" in entity;
}

export function slugifyInvestor(name: string, firm: string): string {
  return `${name}-${firm}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function parseMoney(raw: string): number {
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

export function parseRange(raw: string): { min: number; max: number } {
  const parts = (raw || "").split(/[–—-]/).map((p) => p.trim());
  if (parts.length >= 2) {
    return { min: parseMoney(parts[0]), max: parseMoney(parts[1]) };
  }
  const n = parseMoney(raw);
  return { min: n, max: n };
}

export function parseFocus(items: string[]): InvestorFocus[] {
  const out: InvestorFocus[] = [];
  for (const item of items) {
    const m = item.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) out.push({ sector: m[1].trim(), stage: m[2].trim() });
    else if (item.trim()) out.push({ sector: item.trim(), stage: "Unknown" });
  }
  return out;
}

/**
 * Dedupe display labels with a comparison that is robust to capitalization,
 * leading/trailing whitespace, and repeated whitespace — while preserving the
 * first-seen clean label for display (never lowercases the rendered text).
 */
export function dedupeLabels(labels: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Extract the sector/focus portion of an `investment_categories` entry.
 * Entries look like "Pre-seed (AI)" or "Series A (Agentic AI ... (AI) ...)" —
 * the sector is everything between the first "(" and the LAST ")", so nested
 * parentheticals survive intact. Entries without parens are returned trimmed.
 */
export function categorySector(cat: string): string {
  const s = (cat || "").trim();
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  if (open >= 0 && close > open) return s.slice(open + 1, close).trim();
  return s;
}

/** Stage prefix of an `investment_categories` entry ("Pre-seed (AI)" → "Pre-seed"). */
export function categoryStage(cat: string): string {
  const s = (cat || "").trim();
  const open = s.indexOf("(");
  return (open > 0 ? s.slice(0, open) : s).trim();
}

/**
 * Canonical display sectors for any investor record, from whichever source
 * field carries them (`investment_categories` new format, `focus_areas`
 * legacy). Deduped via dedupeLabels so the same sector repeated across
 * stages ("Pre-seed (AI)", "Series A (AI)") renders once. Single source of
 * truth for sector/tag chips across cards, tables, and the detail drawer.
 */
export function getInvestorSectors(rec: InvestorEntity | InvestorRecord): string[] {
  if ("investment_categories" in rec && Array.isArray(rec.investment_categories)) {
    return dedupeLabels(rec.investment_categories.map(categorySector));
  }
  if ("focus_areas" in rec && Array.isArray(rec.focus_areas)) {
    return dedupeLabels(rec.focus_areas.map((f) => f?.sector));
  }
  // Enriched records store sectors under schema-specific keys.
  const loose = rec as {
    consolidated_categories?: unknown;
    target_sectors?: unknown;
    investment_profile?: { sectors?: unknown } | null;
  };
  if (Array.isArray(loose.consolidated_categories)) {
    return dedupeLabels(loose.consolidated_categories as (string | undefined)[]);
  }
  if (Array.isArray(loose.target_sectors)) {
    return dedupeLabels(loose.target_sectors as (string | undefined)[]);
  }
  if (Array.isArray(loose.investment_profile?.sectors)) {
    return dedupeLabels(loose.investment_profile.sectors as (string | undefined)[]);
  }
  return [];
}

/** Canonical investment stages for any investor record, deduped, order-preserving. */
export function getInvestorStages(rec: InvestorEntity | InvestorRecord): string[] {
  if ("investment_categories" in rec && Array.isArray(rec.investment_categories)) {
    return dedupeLabels(rec.investment_categories.map(categoryStage));
  }
  if ("stages" in rec && Array.isArray(rec.stages)) {
    return dedupeLabels(rec.stages);
  }
  // Enriched records store stages under schema-specific keys.
  const loose = rec as {
    investment_stages?: unknown;
    vc_investment_types?: unknown;
    investment_profile?: { stages?: unknown } | null;
  };
  if (Array.isArray(loose.investment_stages)) {
    return dedupeLabels(loose.investment_stages as (string | undefined)[]);
  }
  if (Array.isArray(loose.investment_profile?.stages)) {
    return dedupeLabels(loose.investment_profile.stages as (string | undefined)[]);
  }
  if (Array.isArray(loose.vc_investment_types)) {
    return dedupeLabels(loose.vc_investment_types as (string | undefined)[]);
  }
  return [];
}

export function inferType(title: string, firm: string): InvestorRecord["investor_type"] {
  const t = `${title} ${firm}`.toLowerCase();
  if (/\bangel\b/.test(t) || /independent/i.test(firm)) return "angel";
  if (/\bscout\b/.test(t)) return "scout";
  if (/\b(partner|principal|associate|investor|gp|managing)\b/.test(t)) return "vc";
  return "unknown";
}

export function deriveStatus(
  rec: Pick<
    InvestorRecord,
    | "check_sweet_spot_usd"
    | "check_min_usd"
    | "check_max_usd"
    | "title"
    | "locations"
    | "focus_areas"
  >,
): InvestorRecord["status"] {
  if (
    (rec.check_sweet_spot_usd === 0 && rec.check_min_usd === 0 && rec.check_max_usd === 0) ||
    /^unknown$/i.test(rec.title) ||
    !rec.locations.length ||
    !rec.focus_areas.length
  ) {
    return "needs_review";
  }
  return "active";
}
