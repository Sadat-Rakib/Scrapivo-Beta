/**
 * DB-first local-business source — reads the per-country Overture places
 * JSONL extracts produced by scripts/pipeline/run_overture.py
 * (data/local_businesses_{iso2}.jsonl, global: Europe/Asia/Middle East/
 * Americas/Africa/Oceania, CDLA-Permissive licensed).
 *
 * Region routing: the query location is resolved to country file(s) via the
 * regions manifest + a major-city map, so a global dataset never loads whole
 * into memory. Files ≤ SMALL_FILE_CACHE_BYTES are parsed into a small LRU
 * cache; larger ones are stream-filtered per query. Live OSM/Geoapify/
 * Foursquare stays as fallback — this module never fetches anything.
 */
import { existsSync, createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Lead } from "../scoring";

export type BusinessFileRecord = {
  source: string;
  registry_id: string;
  name: string;
  name_normalized: string;
  category?: string | null;
  categories?: string[];
  address_raw?: string | null;
  address_normalized?: string | null;
  postal_code?: string | null;
  locality?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  domain?: string | null;
  confidence?: number;
  confidence_score?: number;
  source_tier?: string;
  evidence?: string[];
  last_seen?: string;
  content_hash?: string;
};

export type RegionManifestEntry = {
  file_stem: string;
  iso2: string;
  name: string;
  region: string;
  aliases: string[];
};

/** craft (singular, lowercase) → Overture category labels. Categories use
 *  gerund/label forms ("plumbing"), so synonyms carry both noun and stem. */
const CRAFT_CATEGORIES: Record<string, string[]> = {
  plumber: ["plumber", "plumbing"],
  plumbing: ["plumber", "plumbing"],
  dentist: ["dentist"],
  dental: ["dentist"],
  orthodontist: ["dentist", "orthodontist"],
  hvac: ["hvac_contractor", "heating_contractor", "air_conditioning_contractor"],
  electrician: ["electrician"],
  roofer: ["roofer", "roofing"],
  roofing: ["roofer", "roofing"],
  restaurant: ["restaurant"],
  cafe: ["cafe", "coffee_shop"],
  coffee: ["coffee_shop", "cafe"],
  gym: ["gym", "physical_fitness"],
  fitness: ["gym", "physical_fitness"],
  salon: ["hair_salon", "beauty_salon", "nail_salon"],
  barber: ["barber_shop"],
  lawyer: ["lawyer", "attorney", "legal_service"],
  attorney: ["lawyer", "attorney", "legal_service"],
  accountant: ["accountant", "accounting_firm", "tax_preparation"],
  insurance: ["insurance_agency", "insurance"],
  realtor: ["real_estate_agent", "real_estate_agency"],
  "real estate agency": ["real_estate_agency", "real_estate_agent"],
  mechanic: ["automotive_repair"],
  "auto repair": ["automotive_repair"],
  medical: ["health_and_medical", "doctor", "clinic"],
  doctor: ["health_and_medical", "doctor"],
  clinic: ["health_and_medical", "clinic"],
  bakery: ["bakery"],
  florist: ["florist", "florist_supplier"],
  photographer: ["photographer", "photography"],
  tattoo: ["tattoo_shop", "tattooing"],
  chiropractor: ["chiropractor", "chiropractic"],
  spa: ["spa", "medical_spa"],
  "med spa": ["medical_spa", "spa"],
  vet: ["veterinary_care", "veterinarian"],
  veterinarian: ["veterinary_care", "veterinarian"],
  hotel: ["hotel", "motel"],
  locksmith: ["locksmith"],
  landscaper: ["landscaping", "landscape_contractor"],
  landscaping: ["landscaping", "landscape_contractor"],
};

/** Major cities → country ISO2 (query routing only — coverage grows with the manifest). */

const DATA_DIRS = [resolve(process.cwd(), "data"), resolve(process.cwd(), "../data")];
const SMALL_FILE_CACHE_BYTES = 80 * 1024 * 1024;
const LRU_MAX_REGIONS = 3;

function dataDirs(): string[] {
  return DATA_DIRS.filter((d) => existsSync(d));
}

function findFile(stem: string): string | null {
  for (const dir of dataDirs()) {
    const p = join(dir, `local_businesses_${stem}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

// ── Regions manifest ────────────────────────────────────────────────────────
let manifestCache: RegionManifestEntry[] | null = null;

function loadRegionsManifest(): RegionManifestEntry[] {
  if (manifestCache) return manifestCache;
  for (const dir of dataDirs()) {
    const p = join(dir, "regions_manifest.json");
    if (existsSync(p)) {
      try {
        manifestCache = JSON.parse(readFileSync(p, "utf8")) as RegionManifestEntry[];
        return manifestCache;
      } catch {
        /* try next */
      }
    }
  }
  manifestCache = [];
  return manifestCache;
}

// ── Global city map (GeoNames cities15000 via scripts/build-city-map.mts) ──
export type CityMapEntry = { iso2: string; name: string; aliases: string[] };
type CityCountryMap = Record<string, CityMapEntry>;

let cityMapCache: CityCountryMap | null = null;

function loadCityCountryMap(): CityCountryMap {
  if (cityMapCache) return cityMapCache;
  for (const dir of dataDirs()) {
    const p = join(dir, "city_country_map.json");
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf8")) as { cities?: CityCountryMap };
        cityMapCache = parsed.cities ?? {};
        return cityMapCache;
      } catch {
        /* try next */
      }
    }
  }
  cityMapCache = {};
  return cityMapCache;
}

/** Location tokens → country file stems (max 2). Pure — unit-testable. */
export function resolveRegionFiles(
  location: string,
  manifest: RegionManifestEntry[],
  availableStems?: Set<string>,
  cityMap?: CityCountryMap,
): { stems: string[]; cityTokens: string[] } {
  // Unlike row-level location tokens, ISO2/short aliases ("us", "usa", "uk")
  // are meaningful HERE — they route to a country file.
  const tokens = (location || "")
    .split(/,|\bin\b|\bnear\b/i)
    .map((t) => t.trim().toLowerCase().replace(/^the\s+/, ""))
    .filter((t) => t.length >= 2 && !/^(the|near|me)$/i.test(t));
  if (!tokens.length) return { stems: [], cityTokens: [] };
  const avail = availableStems ?? new Set(manifest.map((m) => m.file_stem));
  const cities = cityMap ?? loadCityCountryMap();
  const scores = new Map<string, number>();
  const cityTokens = new Set<string>();

  const bump = (stem: string, by: number) => {
    if (!avail.has(stem)) return;
    scores.set(stem, (scores.get(stem) ?? 0) + by);
  };

  for (const token of tokens) {
    // Exact file-stem match (city-level extracts like "austin").
    if (avail.has(token)) bump(token, 100);
    // GeoNames city map: 33k+ cities worldwide — routes ANY typed city and
    // marks it so row scoring prefers that city's rows.
    const city = cities[token];
    if (city) {
      bump(city.iso2.toLowerCase(), 60);
      cityTokens.add(city.name.toLowerCase());
    }
    // Country name / alias match — exact for short aliases (a substring rule
    // would false-match "austin" ⊃ "us"); loose only for long names.
    for (const m of manifest) {
      const hay = [m.name.toLowerCase(), m.iso2.toLowerCase(), ...m.aliases];
      if (hay.some((a) => a === token)) bump(m.file_stem, 50);
      else if (token.length >= 5 && hay.some((a) => a.length >= 5 && (a.includes(token) || token.includes(a)))) {
        bump(m.file_stem, 20);
      }
    }
  }
  const stems = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([stem]) => stem);
  return { stems, cityTokens: [...cityTokens] };
}

// ── Region file loading (LRU for small files, stream for big ones) ─────────
const lru = new Map<string, BusinessFileRecord[]>();

function evictIfNeeded(): void {
  while (lru.size > LRU_MAX_REGIONS) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

function parseRecords(content: string): BusinessFileRecord[] {
  const byKey = new Map<string, BusinessFileRecord>();
  for (const line of content.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const rec = JSON.parse(s) as BusinessFileRecord;
      if (!rec?.registry_id || !rec?.name) continue;
      rec.name = rec.name.replace(/"+/g, "").trim();
      const key = `${rec.source}:${rec.registry_id}`;
      if (!byKey.has(key)) byKey.set(key, rec);
    } catch {
      /* skip bad line */
    }
  }
  return [...byKey.values()];
}

function loadRegionRecords(stem: string): BusinessFileRecord[] {
  const cached = lru.get(stem);
  if (cached) {
    lru.delete(stem);
    lru.set(stem, cached); // bump to most-recent
    return cached;
  }
  const path = findFile(stem);
  if (!path) return [];
  const size = statSync(path).size;
  if (size > SMALL_FILE_CACHE_BYTES) {
    // Big country file (IN/BR/US ≈ 0.8 GB): NEVER read whole — V8 strings cap
    // at ~512 MB and the parsed form would blow the heap. Stream-filter per
    // query via streamFilterFile instead.
    return [];
  }
  const content = readFileSync(path, "utf8");
  const records = parseRecords(content);
  lru.set(stem, records);
  evictIfNeeded();
  return records;
}

function isBigFile(stem: string): boolean {
  const path = findFile(stem);
  return !!path && statSync(path).size > SMALL_FILE_CACHE_BYTES;
}

/** Test/ops hook — drop all cached regions. */
export function clearLocalBusinessFileCache(): void {
  lru.clear();
  manifestCache = null;
}

// ── Filtering + scoring ─────────────────────────────────────────────────────
function isJunkName(name: string): boolean {
  const n = (name || "").trim();
  if (n.length < 3) return true;
  if (/^[#\d\s.\-/]+$/.test(n)) return true;
  if (/^(test|demo|sample|unknown|null|n\/a)$/i.test(n)) return true;
  return false;
}

function locationTokens(location: string): string[] {
  return (location || "")
    .split(/,|\bin\b|\bnear\b/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 4 && !/^(usa|united states|us|uk|the)$/i.test(t));
}

function craftKey(craft?: string | null): string {
  const c = (craft || "").trim().toLowerCase().replace(/s$/, "");
  return c || "";
}

function synonymsFor(craft: string): string[] {
  if (!craft) return [];
  const direct = CRAFT_CATEGORIES[craft];
  if (direct) return direct;
  return [craft.replace(/\s+/g, "_")];
}

function rowMatchesLocation(rec: BusinessFileRecord, tokens: string[]): boolean {
  const hay = `${rec.locality ?? ""} ${rec.region ?? ""} ${rec.postal_code ?? ""} ${
    rec.address_normalized ?? ""
  }`.toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

export type LocalFileQuery = {
  craft?: string | null;
  /** Extra craft candidates from the raw query — the classifier's coreSkill
   *  can pick the wrong token ("web" from "no web presence"), so raw-query
   *  words get a shot at the category synonyms too. */
  extraCrafts?: string[];
  /** Clarifier opportunity filter ("no_website" | "has_phone" | "sales_ready"). */
  opportunity?: string | null;
  location: string;
  /** Known-city names resolved by the city map — in city mode the country
   *  file IS the region (rows pass the location gate) and rows whose
   *  locality matches score higher. */
  cityTokens?: string[];
  keywords?: string[];
  limit?: number;
};

export type ScoredBusinessFileRecord = { rec: BusinessFileRecord; score: number };

/** Pure score (null = no match) — shared by the batch filter and the
 *  streaming path for big country files. Unit-testable without the fs. */
export function scoreRecord(rec: BusinessFileRecord, q: LocalFileQuery): number | null {
  const tokens = locationTokens(q.location);
  const cityTokens = (q.cityTokens ?? []).map((c) => c.toLowerCase());
  if (!tokens.length) return null;
  if (isJunkName(rec.name)) return null;

  const localityHay = `${rec.locality ?? ""} ${rec.address_normalized ?? ""}`.toLowerCase();
  const cityHit = cityTokens.filter((c) => localityHay.includes(c)).length;
  // In city mode the country file is the region: rows pass the location gate
  // (a 40k-population city can't be substring-matched against the whole
  // country file) and matching-locality rows rank higher.
  if (!cityTokens.length && !rowMatchesLocation(rec, tokens)) return null;

  const craftCandidates = [craftKey(q.craft), ...(q.extraCrafts ?? []).map((c) => craftKey(c))]
    .filter((c) => c && c !== "web");
  const keywords = (q.keywords ?? [])
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length >= 3);

  const cats = `${rec.category ?? ""} ${(rec.categories ?? []).join(" ")}`.toLowerCase();
  const nameLower = rec.name_normalized || rec.name.toLowerCase();
  let craftMatch = false;
  for (const candidate of craftCandidates) {
    const synonyms = synonymsFor(candidate);
    if (!synonyms.length) continue;
    if (synonyms.some((s) => cats.includes(s)) || nameLower.includes(candidate)) {
      craftMatch = true;
      break;
    }
  }
  const keywordHits = keywords.filter((k) => nameLower.includes(k)).length;
  const generalOnly = !craftCandidates.length && !keywords.length;
  if (!craftMatch && !keywordHits && !generalOnly) return null;

  // Opportunity filter (evidence-only; seo_poor needs a site check we don't
  // have at query time, so it passes through unfiltered here).
  if (q.opportunity === "no_website" && (rec.website || rec.domain)) return null;
  if (q.opportunity === "has_phone" && !rec.phone) return null;
  if (q.opportunity === "sales_ready" && !rec.phone && !rec.email) return null;

  let score = 30;
  if (craftMatch) score += 40;
  score += Math.min(20, keywordHits * 10);
  if (rec.phone) score += 6;
  if (rec.website || rec.domain) score += 6;
  if (rec.email) score += 4;
  if (rec.address_raw) score += 2;
  if (cityHit) score += Math.min(25, cityHit * 25);
  score += Math.round((rec.confidence_score ?? 50) / 10);
  return Math.min(98, score);
}

/** Pure filter + score — unit-testable without the filesystem. */
export function filterBusinessFileRecords(
  records: BusinessFileRecord[],
  q: LocalFileQuery,
): ScoredBusinessFileRecord[] {
  const out: ScoredBusinessFileRecord[] = [];
  for (const rec of records) {
    const score = scoreRecord(rec, q);
    if (score !== null) out.push({ rec, score });
  }
  out.sort((a, b) => b.score - a.score || a.rec.name.localeCompare(b.rec.name));
  return out.slice(0, q.limit ?? 80);
}

function mapsSearchUrl(rec: BusinessFileRecord): string {
  const q = [rec.name, rec.locality, rec.region].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function recordsToLeads(scored: ScoredBusinessFileRecord[]): Lead[] {
  return scored.map(({ rec, score }) => {
    const website = rec.website ?? undefined;
    const domain =
      rec.domain ??
      (website
        ? (() => {
            try {
              return new URL(website).hostname.replace(/^www\./, "");
            } catch {
              return undefined;
            }
          })()
        : undefined);
    const category = rec.category ?? "local business";
    const where = rec.locality ?? rec.region ?? "";
    return {
      source: "overture",
      platform: category.replace(/_/g, " "),
      platform_label: category.replace(/_/g, " "),
      title: rec.name,
      snippet: [
        rec.address_raw || [rec.locality, rec.region].filter(Boolean).join(", "),
        rec.phone ? `Phone: ${rec.phone}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      full_post_url: website || mapsSearchUrl(rec),
      author: rec.name,
      company: rec.name,
      company_domain: domain,
      signal_type: "leading_indicator" as const,
      source_confidence: rec.confidence_score ?? 50,
      intentBoost: website ? 16 : 10,
      demand_verified: true,
      match_reasons: [`${category.replace(/_/g, " ")} in ${where}`],
      why_match: rec.address_raw || `${rec.name} — ${category.replace(/_/g, " ")} in ${where}`,
      emails: rec.email ? [rec.email] : undefined,
      phones: rec.phone ? [rec.phone] : undefined,
      address: rec.address_raw || undefined,
      score,
    } as Lead;
  });
}

async function streamFilterFile(
  path: string,
  q: LocalFileQuery,
  seen: Set<string>,
  scored: ScoredBusinessFileRecord[],
  stopAt: number,
): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    let rec: BusinessFileRecord;
    try {
      rec = JSON.parse(s) as BusinessFileRecord;
    } catch {
      continue;
    }
    if (!rec?.registry_id || !rec?.name) continue;
    rec.name = rec.name.replace(/"+/g, "").trim();
    const score = scoreRecord(rec, q);
    if (score === null) continue;
    const key = `${rec.source}:${rec.registry_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ rec, score });
    if (scored.length >= stopAt) break;
  }
  rl.close();
  stream.close();
}

/** Lead-shaped rows for the Discover directory branch (OSM-source shape). */
export async function searchLocalBusinessFileLeads(q: LocalFileQuery): Promise<Lead[]> {
  const manifest = loadRegionsManifest();
  const { stems, cityTokens } = resolveRegionFiles(q.location, manifest);
  if (!stems.length) return [];

  const limit = q.limit ?? 80;
  const scored: ScoredBusinessFileRecord[] = [];
  const seen = new Set<string>();
  const qWithCity: LocalFileQuery = { ...q, cityTokens };
  for (const stem of stems) {
    if (isBigFile(stem)) {
      // Mega-country files (IN/BR/US ≈ 0.8 GB): stream line by line —
      // readFileSync exceeds the V8 string cap and the parsed form would
      // blow the heap.
      const path = findFile(stem);
      if (path) await streamFilterFile(path, qWithCity, seen, scored, limit * 3);
    } else {
      const records = loadRegionRecords(stem);
      for (const { rec, score } of filterBusinessFileRecords(records, qWithCity)) {
        const key = `${rec.source}:${rec.registry_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scored.push({ rec, score });
      }
    }
    if (scored.length >= limit * 3) break; // plenty to rank and slice
  }
  scored.sort((a, b) => b.score - a.score || a.rec.name.localeCompare(b.rec.name));
  return recordsToLeads(scored.slice(0, limit));
}
