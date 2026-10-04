/**
 * Canonical business reader — S3 Parquet by_country (full 16.3M corpus).
 * Country-stem pruning via location text; bounded fallback scan otherwise.
 */
import { listPartitionFilesBySize, readFiltered, type DbHitMeta, iniCredentialProvider } from "./read-parquet.server";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { countryHintForCity } from "@/lib/search/location-resolver";

const BUCKET = process.env.S3_BUCKET ?? "scrapivo-raw-data-2026-523220341033-us-east-2-an";
const REGION = process.env.AWS_REGION ?? "us-east-2";

export interface CanonicalBusiness {
  registry_id: string | null;
  name: string | null;
  category: string | null;
  category_raw: string | null;
  address: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  quality_score: number | null;
}

const PREFIX = "processed/local-businesses/by_country/";
const COLS = [
  "registry_id",
  "name",
  "category",
  "category_raw",
  "address",
  "locality",
  "region",
  "country",
  "phone",
  "email",
  "website",
  "quality_score",
  "junk_flag",
];

/**
 * Data-derived gazetteer (processed/gazetteer/gazetteer.json): every locality
 * and country present in the corpus → country-file stems. Replaces all
 * hand-typed city maps — any place in the data resolves, nothing else to
 * maintain. Cached in memory after first fetch (~4.6 MB).
 */
interface Gazetteer {
  business_locality: Record<string, string[]>;
  business_country: Record<string, string[]>;
}
let gazCache: Gazetteer | null = null;
async function gazetteer(): Promise<Gazetteer> {
  if (!gazCache) {
    const profile = process.env.AWS_PROFILE?.trim();
    const s3 = new S3Client({
      region: REGION,
      ...(profile ? { credentials: iniCredentialProvider(profile) } : {}),
    });
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: "processed/gazetteer/gazetteer.json" }),
    );
    const text = await res.Body!.transformToString();
    gazCache = JSON.parse(text) as Gazetteer;
  }
  return gazCache!;
}

/** Unicode-safe locality key. NFKD gives diacritic parity with the index
 * loader while \p{L}/\p{N} preserves non-Latin place names instead of
 * collapsing them to an empty key. */
export const normPlace = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/([\p{Script=Latin}])\p{M}+/gu, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();

/**
 * Country-query stem constraint (Bahrain fix): when the location IS a known
 * country (COUNTRY_ISO hit), keep only files whose stem is one of its ISOs.
 * Gazetteer token-fallback noise — e.g. "Bahrain" the town in Swat matching
 * pk.parquet for a Bahrain-country query — must never reach the scan:
 * downstream validation rejects every such row anyway, so scanning them is
 * pure waste that crowds real matches out of capped reads. City queries
 * (empty isoList) pass through untouched (dhaka → [in, bd] still works).
 * If no ISO file matches, returns [] so the caller can try the ISO stems
 * directly against the file listing (gazetteer may simply miss a country).
 */
export function constrainStemsToCountry(stems: string[], isoList: string[]): string[] {
  if (!isoList.length) return stems;
  const want = new Set(isoList.map((s) => s.toLowerCase()));
  return stems.filter((s) => want.has(s.toLowerCase()));
}

export function constrainFilesToCityCountry(
  keys: string[],
  hintIso: string | null,
  directCityFile?: string,
): string[] {
  if (!hintIso || !keys.length) return keys;
  const suffix = `/${hintIso.toLowerCase()}.parquet`;
  const routed = keys.filter(
    (k) => k.toLowerCase().endsWith(suffix) || (!!directCityFile && k === directCityFile),
  );
  return routed.length ? routed : keys;
}

/** Resolve user location text → country-file stems, data-derived. */
async function resolveStems(loc: string): Promise<string[] | null> {  const g = await gazetteer();
  const n = normPlace(loc);
  if (!n) return null;
  const direct = g.business_locality[n] ?? g.business_country[n];
  if (direct?.length) return [...direct];
  // Token-containment fallback over gazetteer keys (e.g. "new york" hits
  // "greater new york area" localities via stem files already covered...
  // here: any key containing all query tokens).
  const toks = n.split(" ").filter((t) => t.length > 2);
  if (!toks.length) return null;
  const hits = new Set<string>();
  for (const [key, stems] of Object.entries(g.business_locality)) {
    if (toks.every((t) => key.includes(t))) for (const s of stems) hits.add(s);
  }
  for (const [key, stems] of Object.entries(g.business_country)) {
    if (toks.every((t) => key.includes(t))) for (const s of stems) hits.add(s);
  }
  return hits.size ? [...hits] : null;
}

const like = (v: unknown, needle: string) =>
  typeof v === "string" && v.toLowerCase().includes(needle.toLowerCase());
export const localityMatches = (v: unknown, needle: string) =>
  typeof v === "string" && normPlace(v) === normPlace(needle);

/**
 * Query-side craft normalization (mirrors the ingest CRAFT map): user-facing
 * plurals ("plumbers") collapse to the canonical singular ("plumber") so
 * "plumbing_contractor" rows match. Data-derived categories need no mapping —
 * only user wording does.
 */
const CRAFT_QUERY: Record<string, string> = {
  plumbers: "plumber",
  plumbing: "plumber",
  dentists: "dentist",
  dental: "dentist",
  clinics: "dentist",
  clinic: "dentist",
  restaurants: "restaurant",
  cafes: "cafe",
  coffee: "cafe",
  gyms: "gym",
  salons: "salon",
  barbers: "barber",
  barber: "barber",
  lawyers: "lawyer",
  attorneys: "lawyer",
  electricians: "electrician",
  roofers: "roofer",
  roofing: "roofer",
  hotels: "hotel",
  bakeries: "bakery",
  bakery: "bakery",
  florists: "florist",
  spas: "spa",
  spa: "spa",
  mechanics: "automotive_repair",
  mechanic: "automotive_repair",
  locksmiths: "locksmith",
  hvac: "hvac",
  "real estate": "real_estate",
  realestate: "real_estate",
  realtor: "real_estate",
  realtors: "real_estate",
  realty: "real_estate",
};
export const canonCraft = (s: string) =>
  CRAFT_QUERY[s.toLowerCase().trim().replace(/-/g, " ")] ??
  s.toLowerCase().trim().replace(/-/g, " ").replace(/\s+/g, "_");

/**
 * Stored-category families per canonical craft, derived from actual DB
 * vocabulary (Step 2.2; counted, not guessed). The indexed query filters
 * category IN this list so `hvac` also finds `hvac_services` and
 * `real_estate` finds both agent + service rows. The S3 path needs no
 * change (craftMatches is already substring-based).
 */
const CATEGORY_FAMILIES: Record<string, string[]> = {
  real_estate: ["real_estate", "real_estate_service", "real_estate_agent"],
  hvac: ["hvac", "hvac_services", "hvac_supplier", "hvac_contractor"],
  dentist: ["dentist", "general_dentistry", "cosmetic_dentist"],
  restaurant: [
    "restaurant",
    "fast_food_restaurant",
    "pizza_restaurant",
    "japanese_restaurant",
    "mexican_restaurant",
    "burger_restaurant",
    "sushi_restaurant",
    "chinese_restaurant",
    "seafood_restaurant",
    "italian_restaurant",
    "barbecue_restaurant",
    "indian_restaurant",
    "chicken_restaurant",
    "korean_restaurant",
  ],
};
export const expandCategory = (canon: string): string[] => CATEGORY_FAMILIES[canon] ?? [canon];

/** CRAFT_QUERY words that broaden meaning: a person asking for "clinics" is
 *  routed to dentists, but an OBSERVED row category "clinic" (OSM
 *  amenity=clinic) is a general medical clinic and keeps its literal meaning. */
const BROADENING_QUERY_WORDS = new Set(["clinic", "clinics"]);
const plainCraft = (s: string) => s.toLowerCase().trim().replace(/-/g, " ").replace(/\s+/g, "_");
const singularCraft = (s: string) => s.replace(/(?:es|s)$/, "");

function looseCraftEqual(ca: string, cb: string): boolean {
  if (ca === cb) return true;
  const sa = ca.replace(/er$/, "");
  const sb = cb.replace(/er$/, "");
  return ca.includes(cb) || cb.includes(ca) || sa === sb || ca.includes(sb) || cb.includes(sa);
}

/** Plural/stem-insensitive craft equality for validation.
 *  `a` is the observed row category, `b` the requested craft. */
export function craftMatches(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  // Only the literal word ("clinics" → clinic rows), never its alias target.
  if (BROADENING_QUERY_WORDS.has(a.toLowerCase().trim())) return singularCraft(plainCraft(a)) === singularCraft(plainCraft(b));
  if (looseCraftEqual(canonCraft(a), canonCraft(b))) return true;
  // Trade families: "renewable energy" vs "solar panel installer" is not a
  // hard contradiction — it is researchable (the pre-research gate drops only
  // contradictions; the strict post-research gate judges on evidence). Two
  // crafts that name the same trade family pass this gate.
  const fa = tradeFamilyOf(a);
  return !!fa && fa === tradeFamilyOf(b);
}

/** Trade keywords → family. A category string mentioning a family keyword
 *  (solar, freight, photograph, …) belongs to that trade for gate matching. */
const TRADE_FAMILIES: Array<[RegExp, string]> = [
  [/solar|photovoltaic|\bpv\b|renewable/i, "solar"],
  [/construct|builder|building|contract|civil|renovat/i, "construction"],
  [/photograph|photograf|\bphoto\b|studio/i, "photography"],
  [/freight|forward|logistic|shipping|sped/i, "freight"],
  [/\bplumb/i, "plumbing"],
  [/\broof/i, "roofing"],
  [/electric/i, "electrical"],
  [/hvac|heating|cooling|air conditioning/i, "hvac"],
  [/dentist|dental/i, "dental"],
];

export function tradeFamiliesOf(craft: unknown): string[] {
  if (typeof craft !== "string") return [];
  const lower = craft.toLowerCase();
  return TRADE_FAMILIES.filter(([pattern]) => pattern.test(lower)).map(([, family]) => family);
}

function tradeFamilyOf(craft: unknown): string | null {
  if (typeof craft !== "string") return null;
  const s = craft.toLowerCase();
  for (const [pattern, family] of TRADE_FAMILIES) if (pattern.test(s)) return family;
  return null;
}

export async function searchBusinessesDB(q: {
  category?: string;
  location?: string;
  limit?: number;
}): Promise<{ rows: CanonicalBusiness[]; meta: DbHitMeta }> {
  const limit = Math.min(q.limit ?? 50, 200);
  const loc = (q.location ?? "").trim();
  // Sequence lock: NEVER world-scan. No location → no DB read at all.
  // The old fallback read the 4 largest shards (IN/US/BR) and returned
  // Jamnagar dentists for a blank query — pure hallucination.
  if (!loc) {
    return {
      rows: [],
      meta: {
        dbHit: false,
        engine: "s3-parquet",
        partitionsRead: [`${PREFIX}(no location given; world scan refused)`],
        rowsScanned: 0,
        rowsReturned: 0,
      },
    };
  }
  const sized = await listPartitionFilesBySize(PREFIX);
  const all = sized.map((f) => f.key);
  const bySize = new Map(sized.map((f) => [f.key, f.size] as [string, number]));
  let keys: string[] = [];
  const read: string[] = [];
  // Resolved ISO stems double as country matchers: Overture `country` holds
  // codes ("CA"), never names ("Canada"), so text matching alone misses.
  let isoStems: string[] = [];
  // Gazetteer routing: exact place match first, token fallback second.
  const stems = (await resolveStems(loc)) ?? [];
  // Direct stem spellings ("ca", "austin") also resolve.
  const stemHit = all.find((k) => k.endsWith(`/${loc.toLowerCase()}.parquet`));
  // Country-name fallback without gazetteer (e.g. "Canada" → ca.parquet,
  // "USA" → us.parquet) — gazetteer.json may be stale/missing.
  const { COUNTRY_ISO } = await import("@/lib/search/search-spec-extract");
  const isoList = COUNTRY_ISO[loc.toLowerCase().trim()] ?? [];
  const hintIso = q.location ? countryHintForCity(q.location) : null;
  const constrained = constrainStemsToCountry(stems, isoList);
  let resolved = constrained.length
    ? all.filter((k) => constrained.some((s) => k.endsWith(`/${s}.parquet`)))
    : isoList.length
      ? // Gazetteer missed the country (or matched only noise): the files
        // are stem-named, so try the ISO stems directly.
        all.filter((k) => isoList.some((s) => k.endsWith(`/${s}.parquet`)))
      : stemHit
        ? [stemHit]
        : [];
  resolved = constrainFilesToCityCountry(resolved, hintIso, stemHit);
  if (resolved.length) {
    // Size-ordered within resolved files (largest first).
    keys = resolved.sort((a, b) => (bySize.get(b) ?? 0) - (bySize.get(a) ?? 0));
    isoStems = resolved.map((k) => k.split("/").pop()!.replace(".parquet", ""));
    read.push(`${PREFIX}(gazetteer: ${resolved.length} file(s) for "${loc}": ${isoStems.join(",")})`);
  }
  if (!read.length) {
    // Unknown place: refuse instead of returning random-world rows.
    return {
      rows: [],
      meta: {
        dbHit: false,
        engine: "s3-parquet",
        partitionsRead: [`${PREFIX}(no gazetteer hit for "${loc}"; world scan refused)`],
        rowsScanned: 0,
        rowsReturned: 0,
      },
    };
  }
  const wantCat = q.category ? canonCraft(q.category) : null;
  const wantLoc = q.location ? q.location.toLowerCase().trim() : null;
  const isoLower = new Set(isoStems.map((s) => s.toLowerCase()));
  const catOk = (r: CanonicalBusiness) =>
    !wantCat ||
    like(r.category, wantCat) ||
    like(r.category_raw, wantCat) ||
    like(r.category_raw, wantCat.replace(/er$/, "")) ||
    like(r.category, wantCat.replace(/er$/, ""));
  // Strict country gate (T3 fix): when the city maps to a known country,
  // ONLY that country's rows pass the scan. Previously Jamnagar (IN) rows
  // passed a Dhaka query because multi-stem resolution read in.parquet
  // first and the lenient gates let them through downstream.
  // Home-file-first (acceptance-proven): the gazetteer legitimately resolves
  // some cities to multiple country files (dhaka → [in, bd]), and size-order
  // reads the 2M-row giant first. readFiltered stops at its limit, so the
  // home-country file goes first — exact matches usually fill the page
  // before the giant is ever touched. Recall is unchanged (order only).
  if (hintIso) {
    const home = hintIso.toLowerCase();
    const isHome = (k: string) => k.toLowerCase().endsWith(`/${home}.parquet`);
    keys = [
      ...keys.filter((k) => k === stemHit),
      ...keys.filter((k) => k !== stemHit && isHome(k)),
      ...keys.filter((k) => k !== stemHit && !isHome(k)),
    ];
  }
  const countryOk = (r: CanonicalBusiness) => {
    if (!wantLoc) return true;
    if (hintIso) {
      return typeof r.country === "string" && r.country.toLowerCase() === hintIso.toLowerCase();
    }
    return (
      like(r.country, wantLoc) ||
      (typeof r.country === "string" && isoLower.has(r.country.toLowerCase()))
    );
  };
  const exactCityOk = (r: CanonicalBusiness) =>
    // City routing is locality-exact. Region/address containment confuses a
    // city with its namesake state (São Paulo) and admits other cities.
    !wantLoc || localityMatches(r.locality, wantLoc);
  // Is this a country-level query ("Canada") vs city query ("Pune")?
  // Country queries: every same-country row is exact. City queries: exact
  // city first, same-country rest as nearby-fill.
  const { COUNTRY_ISO: ISO_MAP } = await import("@/lib/search/search-spec-extract");
  const isCountryQuery = !!wantLoc && !!ISO_MAP[wantLoc];
  // Exact-city pass. A city query must never be filled with arbitrary rows
  // elsewhere in the same country; that was high recall but false geography.
  const byQuality = (a: CanonicalBusiness, b: CanonicalBusiness) =>
    (Number(b.quality_score ?? 0) || 0) - (Number(a.quality_score ?? 0) || 0);
  const baseWhere = (r: Record<string, unknown>) =>
    Number(r.junk_flag ?? 0) === 0 &&
    catOk(r as unknown as CanonicalBusiness) &&
    countryOk(r as unknown as CanonicalBusiness);
  let rows: CanonicalBusiness[] = [];
  let exactCount = 0;
  // Pass 1 filters by city immediately for city queries (scans until the
  // limit is filled or the file ends — exact matches are never truncated
  // by file order). Country queries take everything, quality-sorted below.
  const pass1City = !isCountryQuery && !!wantLoc;
  const res = await readFiltered<CanonicalBusiness>({
    keys,
    columns: COLS,
    limit,
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: read },
    where: (r) => baseWhere(r) && (!pass1City || exactCityOk(r as unknown as CanonicalBusiness)),
  });
  if (!isCountryQuery && wantLoc) {
    rows = res.rows.filter(exactCityOk).sort(byQuality).slice(0, limit);
    exactCount = rows.length;
  } else {
    rows = [...res.rows].sort(byQuality).slice(0, limit);
    exactCount = rows.length;
  }
  return {
    rows,
    meta: {
      ...res.meta,
      partitionsRead: [
        ...res.meta.partitionsRead,
        `(exact=${exactCount} nearby=0 for "${q.location}")`,
      ],
      rowsReturned: rows.length,
      dbHit: rows.length > 0,
    },
  };
}
