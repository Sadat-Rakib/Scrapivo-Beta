/**
 * Canonical people reader — S3 Parquet, country-partition pruned (Phase 1).
 * Every call returns rows + DbHitMeta proving the canonical dataset was hit.
 */
import { listPartitionFilesBySize, readFiltered, type DbHitMeta } from "./read-parquet.server";
import { COUNTRY_ISO } from "@/lib/search/search-spec-extract";

export interface CanonicalPerson {
  name: string | null;
  title: string | null;
  company_name: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  employees: string | null;
  personal_linkedin: string | null;
  company_linkedin: string | null;
  facebook: string | null;
  twitter: string | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  tools_used: string | null;
  quality_score: number | null;
}

const COLS = ["name", "title", "company_name", "website", "email", "phone",
  "employees", "personal_linkedin", "company_linkedin", "facebook", "twitter",
  "country", "city", "industry", "tools_used", "quality_score"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

/**
 * Country query → partition slugs that actually exist (pure, tested).
 * The query may be a full name ("India"), an abbreviation ("USA", "UK"),
 * or an ISO code ("IN"): all resolve through the shared COUNTRY_ISO map to
 * every known name, slugged, then filtered to partitions present in the
 * listing. Region slugs ("arizona") and unknown words pass through as-is —
 * an empty result means "no shard", never a wrong shard.
 */
export function resolvePeopleShards(allKeys: string[], countryQuery: string): string[] {
  const existing = new Set(
    allKeys.map((k) => {
      const m = /_part=([^/]+)\//.exec(k);
      return m ? m[1].toLowerCase() : "";
    }),
  );
  const q = (countryQuery ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const isos = new Set<string>();
  if (/^[a-z]{2}$/.test(q)) isos.add(q);
  for (const iso of COUNTRY_ISO[q] ?? []) isos.add(iso.toLowerCase());
  const candidates = [slug(q)];
  for (const [name, list] of Object.entries(COUNTRY_ISO)) {
    if (list.some((iso) => isos.has(iso.toLowerCase())) && !candidates.includes(slug(name))) {
      candidates.push(slug(name));
    }
  }
  const hits: string[] = [];
  for (const c of candidates) {
    if (existing.has(c)) {
      hits.push(...allKeys.filter((k) => k.toLowerCase().includes(`_part=${c}/`)));
    }
  }
  return [...new Set(hits)];
}

export interface PersonQuery {
  role?: string;
  industry?: string;
  country?: string;
  city?: string;
  name?: string;
  company?: string;
  limit?: number;
}

const like = (v: unknown, needle: string) =>
  typeof v === "string" && v.toLowerCase().includes(needle.toLowerCase());

/** Title matching is token-aware so `sales manager` satisfies `manager`,
 * while normalization differences (hyphen/plural) do not create false zeroes. */
export function personRoleMatches(value: unknown, wanted: string): boolean {
  if (typeof value !== "string") return false;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = norm(value);
  const b = norm(wanted);
  if (!a || !b) return false;
  if (a.includes(b)) return true;
  const singular = (s: string) => s.replace(/s$/, "");
  const have = new Set(a.split(" ").map(singular));
  return b.split(" ").map(singular).every((t) => have.has(t));
}

export function personCountryMatches(value: unknown, wanted: string): boolean {
  if (typeof value !== "string") return false;
  if (like(value, wanted)) return true;
  const isoSet = (raw: string) => {
    const q = raw.trim().toLowerCase();
    const out = new Set<string>(COUNTRY_ISO[q] ?? []);
    if (/^[a-z]{2}$/.test(q)) out.add(q);
    return out;
  };
  const a = isoSet(value);
  const b = isoSet(wanted);
  return [...a].some((iso) => b.has(iso));
}

export async function searchPeopleDB(
  q: PersonQuery,
): Promise<{ rows: CanonicalPerson[]; meta: DbHitMeta }> {
  const limit = Math.min(q.limit ?? 50, 200);
  let keys: string[];
  const read: string[] = [];
  if (q.country) {
    // Partition pruning via resolvePeopleShards: full names, abbreviations
    // ("USA"), and ISO codes ("IN") all resolve to existing shards only.
    const all = (await listPartitionFilesBySize("processed/people_by_country/")).map(
      (f) => f.key,
    );
    keys = resolvePeopleShards(all, q.country);
    read.push(
      `processed/people_by_country/ (resolved shards for "${q.country}": ${keys.length} file(s))`,
    );
    if (!keys.length) {
      return {
        rows: [],
        meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read, rowsScanned: 0, rowsReturned: 0 },
      };
    }
  } else {
    // No country → size-ordered shards (largest first). readFiltered stops
    // at `limit`, so small shards are touched only when needed.
    const all = (
      await listPartitionFilesBySize("processed/people_by_country/")
    ).map((f) => f.key);
    keys = all.slice(0, 12);
    read.push("processed/people_by_country/ (size-ordered, 12 largest)");
    const where = (r: Record<string, unknown>) =>
      (!q.role || personRoleMatches(r.title, q.role) || (q.role === "founder" && like(r.title, "found"))) &&
      (!q.industry || like(r.industry, q.industry)) &&
      (!q.country || personCountryMatches(r.country, q.country)) &&
      (!q.city || like(r.city, q.city)) &&
      (!q.name || like(r.name, q.name)) &&
      (!q.company || like(r.company_name, q.company));
    const first = await readFiltered<CanonicalPerson>({
      keys,
      columns: COLS,
      limit,
      meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read },
      where,
    });
    if (first.rows.length >= limit) return first;
    // Thin first pass → widen to the remaining shards (whole prefix is only
    // ~62MB). Same bounded pattern as the companies reader.
    const rest = all.slice(12);
    if (!rest.length) return first;
    read.push(`processed/people_by_country/ (widened +${rest.length} shard(s))`);
    const second = await readFiltered<CanonicalPerson>({
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
  const first = await readFiltered<CanonicalPerson>({
    keys,
    columns: COLS,
    limit,
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read },
    where: (r) =>
      (!q.role || personRoleMatches(r.title, q.role) || (q.role === "founder" && like(r.title, "found"))) &&
      (!q.industry || like(r.industry, q.industry)) &&
      (!q.country || personCountryMatches(r.country, q.country)) &&
      (!q.city || like(r.city, q.city)) &&
      (!q.name || like(r.name, q.name)) &&
      (!q.company || like(r.company_name, q.company)),
  });
  return first;
}
