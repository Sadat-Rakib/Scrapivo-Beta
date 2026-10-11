/**
 * Canonical companies reader — S3 Parquet, initial-partition pruned (Phase 1).
 */
import { listPartitionFilesBySize, readFiltered, type DbHitMeta, type ReadBudget } from "./read-parquet.server";
import { criterionAlternatives, criterionPhraseMatches } from "@/lib/search/criterion-match";
import { locationSatisfies, resolveCanonicalLocation } from "@/lib/search/location-resolver";

export interface CanonicalCompany {
  company_name: string | null;
  website: string | null;
  location: string | null;
  category: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  facebook: string | null;
  twitter: string | null;
  description: string | null;
  employees: string | null;
  quality_score: number | null;
}

const COLS = ["company_name", "website", "location", "category", "email", "phone",
  "linkedin", "facebook", "twitter", "description", "employees", "quality_score"];

export interface CompanyQuery extends ReadBudget {
  name?: string;
  category?: string;
  industry?: string;
  location?: string;
  limit?: number;
}

const like = (v: unknown, needle: string) =>
  typeof v === "string" && v.toLowerCase().includes(needle.toLowerCase());

/** Query vocabulary differs from stored category labels. Aliases stay narrow:
 * AI must not become a two-letter substring match against words like retail. */
export function companyCategoryTerms(wanted: string): string[] {
  const industry = wanted.trim().replace(/\s+compan(?:y|ies)$/i, "");
  const key = industry.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const aliases: Record<string, string[]> = {
    saas: ["saas", "software"],
    ai: ["artificial intelligence", "machine learning"],
    "artificial intelligence": ["artificial intelligence", "machine learning"],
    healthcare: ["healthcare", "health care"],
    fintech: ["fintech", "financial technology"],
    "e commerce": ["e-commerce", "ecommerce"],
    cybersecurity: ["cybersecurity", "cyber security", "computer & network security", "computer and network security", "network security"],
    "cyber security": ["cybersecurity", "cyber security", "computer & network security", "computer and network security", "network security"],
  };
  return aliases[key] ?? [industry];
}

export function companyCategoryMatches(value: unknown, wanted: string): boolean {
  if (typeof value !== "string") return false;
  return criterionPhraseMatches(value, wanted) || criterionAlternatives(wanted)
    .some(part => companyCategoryTerms(part.replace(/\s+startups?$/i, "")).some((term) => like(value, term)));
}

function canonicalCompanyPlace(raw: string) {
  // ISO abbreviations are language, not a city-to-country dictionary.
  const token = raw.trim().replace(/^CAN$/i, "Canada").replace(/^US$/i, "USA");
  return resolveCanonicalLocation(token);
}

/** Only observed country/city/region tokens establish country membership. */
export function companyCountryCode(raw: string | null | undefined): string | null {
  const codes = new Set<string>();
  const explicit = new Set<string>();
  for (const part of (raw ?? "").split(",").map(value => value.trim()).filter(Boolean)) {
    if (/^(?:(?:north|south|central|latin)\s+)?america$/i.test(part)) continue;
    const regional = part.match(/^(?:north(?:east|west)?ern|south(?:east|west)?ern|midwestern|western|eastern)\s+(US|USA|Canada|CAN)$/i);
    const geo = canonicalCompanyPlace(regional?.[1] ?? part);
    if (geo?.country_code && geo.resolution === "resolved") {
      codes.add(geo.country_code);
      if (geo.kind === "country" || regional) explicit.add(geo.country_code);
    }
  }
  if (explicit.size) return explicit.size === 1 ? [...explicit][0] : null;
  return codes.size === 1 ? [...codes][0] : null;
}

export function companyLocationMatches(v: unknown, needle: string): boolean {
  if (typeof v !== "string") return false;
  const required = canonicalCompanyPlace(needle);
  if (!required) return false;
  if (required.kind === "country") return companyCountryCode(v) === required.country_code;
  return locationSatisfies(v, required);
}

export async function searchCompaniesDB(
  q: CompanyQuery,
): Promise<{ rows: CanonicalCompany[]; meta: DbHitMeta }> {
  const limit = Math.min(q.limit ?? 50, 200);
  // Size-ordered shards (largest first): alphabetical order reads the
  // emptiest shards first and starves results. Read until the limit is met.
  const budget = { signal: q.signal, deadline: q.deadline };
  const all = (await listPartitionFilesBySize("processed/companies_by_initial/", budget)).map((f) => f.key);
  let keys = all;
  const read: string[] = [];
  if (q.name) {
    // Partition pruning by name initial.
    const initial = q.name.trim().charAt(0).toLowerCase();
    const pruned = all.filter((k) => k.includes(`_part=${initial}/`));
    if (pruned.length) {
      keys = pruned;
      read.push(`processed/companies_by_initial/_part=${initial}/`);
    }
  }
  if (!read.length) {
    // Biggest shards first; readFiltered stops at `limit`, so small shards
    // are only touched when the big ones cannot fill the page.
    keys = all.slice(0, 8);
    read.push("processed/companies_by_initial/ (size-ordered, 8 largest)");
  }
  const cat = q.category ?? q.industry;
  const where = (r: Record<string, unknown>) =>
    (!q.name || like(r.company_name, q.name)) &&
    (!cat || companyCategoryMatches(r.category, cat)) &&
    (!q.location || companyLocationMatches(r.location, q.location));
  const first = await readFiltered<CanonicalCompany>({
    ...budget,
    keys,
    columns: COLS,
    limit,
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read },
    where,
  });
  if (first.rows.length >= limit || keys.length >= all.length || first.meta.coverageIncomplete) return first;
  // Thin first pass (location-only queries match no particular initial):
  // widen to the remaining shards, same limit. Bounded: one extra pass over
  // small files, then stop — the tier timeout owns the wall clock.
  const rest = all.filter((k) => !keys.includes(k));
  read.push(`processed/companies_by_initial/ (widened +${rest.length} shard(s))`);
  const second = await readFiltered<CanonicalCompany>({
    ...budget,
    keys: rest,
    columns: COLS,
    limit,
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read },
    where,
  });
  return {
    rows: [...first.rows, ...second.rows].slice(0, limit),
    meta: {
      ...second.meta,
      partitionsRead: read,
      rowsScanned: first.meta.rowsScanned + second.meta.rowsScanned,
      rowsReturned: Math.min(limit, first.rows.length + second.rows.length),
      dbHit: first.rows.length + second.rows.length > 0,
    },
  };
}
