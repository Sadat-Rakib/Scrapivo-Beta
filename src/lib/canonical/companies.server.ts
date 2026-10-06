/**
 * Canonical companies reader — S3 Parquet, initial-partition pruned (Phase 1).
 */
import { listPartitionFilesBySize, readFiltered, type DbHitMeta } from "./read-parquet.server";

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

export interface CompanyQuery {
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
  };
  return aliases[key] ?? [industry];
}

export function companyCategoryMatches(value: unknown, wanted: string): boolean {
  if (typeof value !== "string") return false;
  return companyCategoryTerms(wanted).some((term) => like(value, term));
}

/**
 * Location matching against data-derived values (no hand-typed region maps).
 * Distinct company locations come from processed/gazetteer/gazetteer.json.
 * The ONLY hand seed is country abbreviations (us/usa/uk — pure linguistic
 * knowledge, documented here): everything else matches data values directly.
 */
const ABBREV_SEED: Record<string, string[]> = {
  us: ["northeastern us", "southern us", "midwestern us", "western us", "east coast", "west coast", "america"],
  usa: ["northeastern us", "southern us", "midwestern us", "western us", "east coast", "west coast", "america"],
  uk: ["london", "britain", "england"],
};

function locationMatches(v: unknown, needle: string): boolean {
  if (like(v, needle)) return true;
  const n = needle.toLowerCase().trim();
  // Abbreviation seed expands to region phrases that DO exist in data.
  const seeds = ABBREV_SEED[n] ?? [];
  if (seeds.length) return seeds.some((a) => like(v, a));
  // Token overlap against known data values: "new york" matches
  // "Greater New York Area, ..." without anyone typing the mapping.
  const toks = n.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (toks.length && typeof v === "string") {
    const vl = v.toLowerCase();
    if (toks.every((t) => vl.includes(t))) return true;
  }
  return false;
}

export async function searchCompaniesDB(
  q: CompanyQuery,
): Promise<{ rows: CanonicalCompany[]; meta: DbHitMeta }> {
  const limit = Math.min(q.limit ?? 50, 200);
  // Size-ordered shards (largest first): alphabetical order reads the
  // emptiest shards first and starves results. Read until the limit is met.
  const all = (await listPartitionFilesBySize("processed/companies_by_initial/")).map((f) => f.key);
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
    (!q.location || locationMatches(r.location, q.location));
  const first = await readFiltered<CanonicalCompany>({
    keys,
    columns: COLS,
    limit,
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read },
    where,
  });
  if (first.rows.length >= limit || keys.length >= all.length) return first;
  // Thin first pass (location-only queries match no particular initial):
  // widen to the remaining shards, same limit. Bounded: one extra pass over
  // small files, then stop — the tier timeout owns the wall clock.
  const rest = all.filter((k) => !keys.includes(k));
  read.push(`processed/companies_by_initial/ (widened +${rest.length} shard(s))`);
  const second = await readFiltered<CanonicalCompany>({
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
