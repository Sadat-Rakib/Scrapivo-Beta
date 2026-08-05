// Local / SMB discovery via Geoapify Places (Google Places replacement).
// Categories are request params — one GEOAPIFY_API_KEY unlocks Places + Geocoding.
import type { ExpandedQueries } from "./query-expander";
import type { Lead } from "../scoring";
import {
  extractLocationFromQuery,
  isCountryLocation,
} from "./query-classifier";

export type SourceLead = Lead & { intentBoost?: number };

type GeoPoint = {
  lon: number;
  lat: number;
  city?: string;
  country_code?: string;
  state_code?: string;
  place_id?: string;
  result_type?: string;
};

const CITY_RADIUS_M = 35_000;
const PLACES_LIMIT_DEFAULT = 20;
const PLACES_LIMIT_DIRECTORY = 40;
const PLACES_LIMIT_PER_CITY = 12;

/** Major metros for country-scale directory fan-out (Geoapify place:country is too sparse/noisy). */
export const COUNTRY_MAJOR_CITIES: Record<string, string[]> = {
  india: [
    "Mumbai", "Bengaluru", "Delhi", "Hyderabad", "Chennai", "Pune", "Gurugram", "Kolkata",
  ],
  "united states": [
    "New York", "Los Angeles", "Chicago", "Austin", "Seattle", "San Francisco", "Denver", "Miami",
  ],
  "united kingdom": ["London", "Manchester", "Birmingham", "Edinburgh"],
  canada: ["Toronto", "Vancouver", "Montreal", "Calgary"],
  australia: ["Sydney", "Melbourne", "Brisbane"],
  germany: ["Berlin", "Munich", "Hamburg", "Frankfurt"],
  singapore: ["Singapore"],
  france: ["Paris", "Lyon"],
  "united arab emirates": ["Dubai", "Abu Dhabi"],
};

export function majorCitiesForCountry(location: string): string[] {
  return COUNTRY_MAJOR_CITIES[location.toLowerCase().trim()] ?? [];
}

/** Map ICP / skill keywords → Geoapify Places categories. */
export function categoriesForQuery(qx: ExpandedQueries): string[] {
  const blob = `${qx.skill} ${qx.role} ${qx.raw ?? ""}`.toLowerCase();
  if (/restaurant|cafe|food|catering|bakery/.test(blob)) return ["catering.restaurant", "catering.cafe"];
  if (/salon|spa|beauty|barber/.test(blob)) return ["service.beauty", "service.hairdresser"];
  if (/dentist|doctor|clinic|health|medical/.test(blob)) return ["healthcare"];
  if (/lawyer|legal|attorney/.test(blob)) return ["office.lawyer", "office"];
  if (/accountant|bookkeep|cpa/.test(blob)) return ["office.accountant", "office"];
  if (/real.?estate|realtor|property/.test(blob)) return ["office.estate_agent", "commercial"];
  if (/gym|fitness|yoga/.test(blob)) return ["sport.fitness", "sport"];
  if (/hotel|lodging|airbnb/.test(blob)) return ["accommodation"];
  if (/retail|shop|store/.test(blob)) return ["commercial"];
  if (/market|seo|advertis|agency|design|consult|brand|content|social media/.test(blob)) {
    return ["office", "service", "commercial"];
  }
  return ["office", "service", "commercial"];
}

/** @deprecated Use extractLocationFromQuery from query-classifier (case-insensitive). */
export function extractLocationHint(text: string): string | null {
  return extractLocationFromQuery(text);
}

export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key || !query?.trim()) return null;
  const url =
    `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}` +
    `&limit=1&format=json&apiKey=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const r = data?.results?.[0];
    if (!r || r.lon == null || r.lat == null) return null;
    return {
      lon: r.lon,
      lat: r.lat,
      city: r.city,
      country_code: (r.country_code || "").toLowerCase(),
      state_code: (r.state_code || "").toLowerCase(),
      place_id: r.place_id,
      result_type: r.result_type || r.type,
    };
  } catch {
    return null;
  }
}

function jurisdictionFromPoint(p: GeoPoint): string | undefined {
  const cc = p.country_code;
  if (!cc) return undefined;
  if (cc === "us" && p.state_code) return `us_${p.state_code}`;
  if (cc === "ca" && p.state_code) return `ca_${p.state_code}`;
  return cc;
}

function wantsAgencyIcp(qx: ExpandedQueries): boolean {
  return /agenc|advertis|marketing|seo|brand|pr\b|media/i.test(
    `${qx.role} ${qx.skill} ${qx.raw}`,
  );
}

/** Score how well a place name matches marketing/agency ICP (not gas/cycle “agency”). */
export function agencyRelevanceRank(name: string, categories?: string[]): number {
  const n = (name || "").toLowerCase();
  const catsStr = (categories || []).join(" ").toLowerCase();
  let rank = 0;
  // Non-marketing “agency” businesses common in India OSM
  if (
    /\b(gas|lpg|petrol|diesel|cycle|bicycle|news|travel|insurance|recruit|estate|real\s*estate|property|milk|oil|ply|trading|sales|tour|ticket|railway)\b/.test(n) &&
    !/\b(marketing|digital|advertis|seo|media|brand|creative)\b/.test(n)
  ) {
    return -20;
  }
  if (/\b(digital|marketing|advertis|creative|media|brand|seo)\b/.test(n)) rank += 40;
  if (/\bagenc/.test(n) && /\b(digital|marketing|advertis|seo|media|brand|creative|pr)\b/.test(n)) {
    rank += 30;
  } else if (/\bagenc/.test(n)) {
    rank += 5; // weak alone
  }
  if (/marketing|advertis|media|digital|seo|brand/.test(catsStr)) rank += 15;
  if (/\bagenc/.test(catsStr) && /market|advert|media|digital/.test(catsStr)) rank += 10;
  return rank;
}

type PlacesFetchOpts = {
  filter: string;
  bias?: string;
  limit: number;
  cats: string;
  key: string;
  nameFilter?: string;
};

async function fetchPlacesFeatures(opts: PlacesFetchOpts): Promise<any[]> {
  let url =
    `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(opts.cats)}` +
    `&filter=${encodeURIComponent(opts.filter)}` +
    `&limit=${opts.limit}&apiKey=${opts.key}`;
  if (opts.bias) url += `&bias=proximity:${opts.bias}`;
  if (opts.nameFilter) url += `&name=${encodeURIComponent(opts.nameFilter)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return data?.features ?? [];
  } catch {
    return [];
  }
}

function featuresToLeads(
  features: any[],
  locText: string,
  point: GeoPoint,
  opts?: { directoryMode?: boolean; preferAgency?: boolean },
): SourceLead[] {
  const juris = jurisdictionFromPoint(point);
  const allowCountry = (point.country_code || "").toLowerCase();
  const preferAgency = !!opts?.preferAgency;

  const scored = features.map((f: any) => {
    const p = f?.properties ?? {};
    const name = p.name || p.address_line1 || "";
    const rank = preferAgency
      ? agencyRelevanceRank(name, p.categories || [])
      : 0;
    return { f, rank, name };
  });
  scored.sort((a, b) => b.rank - a.rank);

  let ordered = scored;
  if (preferAgency) {
    const good = scored.filter((s) => s.rank >= 20);
    // Drop gas/news/estate agencies and generic offices when we have real marketing hits
    ordered = good.length >= 3 ? good : scored.filter((s) => s.rank >= 20);
  }

  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const { f, rank } of ordered) {
    const p = f?.properties ?? {};
    const name = p.name || p.address_line1;
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (allowCountry && p.country_code && String(p.country_code).toLowerCase() !== allowCountry) {
      continue;
    }
    const website = p.website || p.contact?.website || undefined;
    const phone = p.phone || p.contact?.phone || undefined;
    const city = p.city || point.city || locText;
    const placeId = p.place_id || f.id;
    const urlOut = website
      || (placeId ? `https://www.geoapify.com/place?id=${placeId}` : `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}`);

    const agencyHit = rank > 0;

    const snippet = [
      `Local business: ${name}`,
      city ? `City: ${city}` : "",
      locText ? `Location: ${locText}` : "",
      p.formatted ? `Address: ${p.formatted}` : "",
      phone ? `Phone: ${phone}` : "",
      website ? `Website: ${website}` : "",
      (p.categories || []).slice?.(0, 4)?.join?.(", ") || "",
      juris ? `Jurisdiction hint: ${juris}` : "",
    ].filter(Boolean).join("\n");

    out.push({
      source: "geoapify",
      platform: "Local business (Geoapify)",
      title: `${name}${city ? ` — ${city}` : ""}`,
      snippet,
      full_post_url: urlOut,
      author: name,
      posted_at: undefined,
      engagement: agencyHit ? 55 : 30,
      is_decision_maker: true,
      intentBoost: opts?.directoryMode ? (agencyHit ? 26 : 12) : 10,
      signal_type: "direct_intent",
      match_reasons: [
        `Directory match in ${city || locText}`,
        ...(website ? ["Has website"] : []),
        ...(agencyHit ? ["Agency/marketing name signal"] : []),
      ],
    });
  }
  return out;
}

async function searchCityCircle(
  qx: ExpandedQueries,
  city: string,
  country: string,
  opts?: { directoryMode?: boolean },
): Promise<SourceLead[]> {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return [];
  const point = await geocodePlace(`${city}, ${country}`);
  if (!point) return [];
  const preferAgency = wantsAgencyIcp(qx);
  const cats = categoriesForQuery(qx).join(",");
  const filter = `circle:${point.lon},${point.lat},${CITY_RADIUS_M}`;

  // Try agency-biased name first, then broad category fill
  let features = preferAgency
    ? await fetchPlacesFeatures({
      filter,
      bias: `${point.lon},${point.lat}`,
      limit: PLACES_LIMIT_PER_CITY,
      cats,
      key,
      nameFilter: "agency",
    })
    : [];
  if (features.length < 4) {
    const broad = await fetchPlacesFeatures({
      filter,
      bias: `${point.lon},${point.lat}`,
      limit: PLACES_LIMIT_PER_CITY,
      cats,
      key,
    });
    const seen = new Set(features.map((f) => f?.properties?.place_id || f?.id));
    for (const f of broad) {
      const id = f?.properties?.place_id || f?.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      features.push(f);
    }
  }

  return featuresToLeads(features, country, { ...point, city }, {
    directoryMode: opts?.directoryMode,
    preferAgency,
  });
}

/**
 * Search Places. When locationHint is provided and geocode fails → [].
 * Never falls back to Denver (or any default city) — that caused cross-country hallucinations.
 */
export async function searchGeoapifyPlaces(
  qx: ExpandedQueries,
  locationHint?: string | null,
  opts?: { directoryMode?: boolean },
): Promise<SourceLead[]> {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return [];

  const locText =
    (locationHint && locationHint.trim()) ||
    extractLocationFromQuery(qx.raw) ||
    extractLocationFromQuery(`${qx.skill} ${qx.role}`);

  // Directory / location searches must not silently search a random default city.
  if (!locText) return [];

  const preferAgency = wantsAgencyIcp(qx);

  // Country-scale directory: fan out major metros (place:country returns random offices).
  if (opts?.directoryMode && isCountryLocation(locText)) {
    const cities = majorCitiesForCountry(locText);
    if (cities.length) {
      const batches = await Promise.all(
        cities.map((city) => searchCityCircle(qx, city, locText, opts)),
      );
      const merged: SourceLead[] = [];
      const seen = new Set<string>();
      for (const batch of batches) {
        for (const lead of batch) {
          const k = (lead.author || lead.title).toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(lead);
        }
      }
      merged.sort((a, b) => (b.intentBoost ?? 0) - (a.intentBoost ?? 0) || (b.engagement ?? 0) - (a.engagement ?? 0));
      if (preferAgency) {
        const good = merged.filter((l) => (l.intentBoost ?? 0) >= 20);
        if (good.length >= 5) return good.slice(0, PLACES_LIMIT_DIRECTORY);
      }
      return merged.slice(0, PLACES_LIMIT_DIRECTORY);
    }
  }

  const point = await geocodePlace(locText);
  if (!point) return [];

  const limit = opts?.directoryMode ? PLACES_LIMIT_DIRECTORY : PLACES_LIMIT_DEFAULT;
  const cats = categoriesForQuery(qx).join(",");

  let filter: string;
  if (isCountryLocation(locText) && point.place_id) {
    filter = `place:${point.place_id}`;
  } else if (point.place_id && /country|state|county/i.test(point.result_type || "")) {
    filter = `place:${point.place_id}`;
  } else {
    filter = `circle:${point.lon},${point.lat},${CITY_RADIUS_M}`;
  }

  let features = preferAgency && !filter.startsWith("place:")
    ? await fetchPlacesFeatures({
      filter,
      bias: filter.startsWith("circle:") ? `${point.lon},${point.lat}` : undefined,
      limit,
      cats,
      key,
      nameFilter: "agency",
    })
    : [];

  if (features.length < 6) {
    const broad = await fetchPlacesFeatures({
      filter,
      bias: filter.startsWith("circle:") ? `${point.lon},${point.lat}` : undefined,
      limit,
      cats,
      key,
    });
    const seen = new Set(features.map((f) => f?.properties?.place_id || f?.id));
    for (const f of broad) {
      const id = f?.properties?.place_id || f?.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      features.push(f);
    }
  }

  return featuresToLeads(features, locText, point, {
    directoryMode: opts?.directoryMode,
    preferAgency,
  });
}
