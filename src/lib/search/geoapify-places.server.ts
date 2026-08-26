// Local / SMB discovery via Geoapify Places (Google Places replacement).
// Categories are request params — one GEOAPIFY_API_KEY unlocks Places + Geocoding.
import type { ExpandedQueries } from "./query-expander";
import type { Lead } from "../scoring";
import { extractLocationFromQuery, isCountryLocation } from "./query-classifier";
import {
  fanOutCitiesForCountry,
  majorCitiesForCountry as gazetteerCities,
  normalizeLocalLocation,
} from "@/lib/local/city-gazetteer";

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
const PLACES_LIMIT_DEFAULT = 40;
const PLACES_LIMIT_DIRECTORY = 80;
const PLACES_LIMIT_PER_CITY = 20;

export function majorCitiesForCountry(location: string): string[] {
  return gazetteerCities(normalizeLocalLocation(location));
}

/** Map ICP / skill keywords → Geoapify Places categories.
 *  NOTE: Geoapify 400s the ENTIRE request on any unknown category token, and
 *  its taxonomy has no plumbing/HVAC/roofing/"craft" section — those used to
 *  return silent zeros for every trade ask. Only verified-valid keys below
 *  (probed against the live API): trades resolve through trade-adjacent
 *  service categories + the OSM/Overpass source, not invented craft tokens. */
export function categoriesForQuery(qx: ExpandedQueries): string[] {
  const blob = `${qx.skill} ${qx.role} ${qx.raw ?? ""}`.toLowerCase();
  if (/restaurant|cafe|food|catering|bakery/.test(blob))
    return ["catering.restaurant", "catering.cafe"];
  if (/salon|spa|beauty|barber|med.?spa/.test(blob))
    return ["service.beauty", "service.beauty.hairdresser"];
  if (/dentist|doctor|clinic|health|medical/.test(blob)) return ["healthcare"];
  if (/lawyer|legal|attorney/.test(blob)) return ["office.lawyer", "office.company"];
  if (/accountant|bookkeep|cpa/.test(blob)) return ["office.accountant", "office.company"];
  if (/real.?estate|realtor|property/.test(blob)) return ["office.estate_agent", "commercial"];
  if (/gym|fitness|yoga/.test(blob)) return ["sport.fitness", "sport"];
  if (/hotel|lodging|airbnb/.test(blob)) return ["accommodation"];
  if (/retail|shop|store/.test(blob)) return ["commercial"];
  // Trades — Geoapify has no plumber/roofer/HVAC categories; these are the
  // closest valid trade-adjacent buckets. OSM (craft=*) covers the rest.
  const tradesFill = [
    "office.company",
    "commercial",
    "service.electrician",
    "service.carpenter",
    "service.metal_construction",
  ];
  if (/\bplumb/.test(blob)) return [...tradesFill, "service.locksmith", "service.cleaning"];
  if (/\broof/.test(blob)) return [...tradesFill, "service.chimney_sweeper"];
  if (/\belectric/.test(blob)) return ["service.electrician", ...tradesFill];
  if (/\bhvac|heating|cooling|furnace/.test(blob)) return tradesFill;
  if (/\b(contractor|handyman|remodel)/.test(blob)) return tradesFill;
  if (/market|seo|advertis|agency|design|consult|brand|content|social media/.test(blob)) {
    return ["office.advertising_agency", "office.consulting", "office.company", "commercial"];
  }
  return ["office.company", "commercial"];
}

/** Name filter for Places API when searching a specific trade/category.
 *  The Geoapify `name` param is exact-ish and rarely matches trade businesses
 *  ("ABC Plumbing" ≠ name=plumber), so trades rely on categories + OSM; the
 *  name filter only stays where it demonstrably helps. */
export function nameFilterForQuery(qx: ExpandedQueries): string | undefined {
  const blob = `${qx.skill} ${qx.role}`.toLowerCase().trim();
  if (/\bplumb/.test(blob)) return "plumbing";
  if (/\broof/.test(blob)) return "roofing";
  if (/\belectric/.test(blob)) return "electric";
  if (/\bhvac|heating/.test(blob)) return undefined;
  if (/\bdentist|dental/.test(blob)) return "dentist";
  if (/\blaw|attorney/.test(blob)) return "lawyer";
  if (/\bgym|fitness/.test(blob)) return "gym";
  if (/\bmed.?spa|spa\b/.test(blob)) return "spa";
  if (/salon|barber/.test(blob)) return "salon";
  return undefined;
}

/** @deprecated Use extractLocationFromQuery from query-classifier (case-insensitive). */
export function extractLocationHint(text: string): string | null {
  return extractLocationFromQuery(text);
}

// Geocoding moved to the free-first neutral chain (Nominatim → Photon →
// Geoapify-if-key). Re-exported here so existing importers keep working
// without any module needing GEOAPIFY_API_KEY to resolve places.
import { geocodePlace } from "./geocode.server";
export { geocodePlace };

function wantsAgencyIcp(qx: ExpandedQueries): boolean {
  return /agenc|advertis|marketing|seo|brand|pr\b|media/i.test(`${qx.role} ${qx.skill} ${qx.raw}`);
}

/** Score how well a place name matches marketing/agency ICP (not gas/cycle “agency”). */
export function agencyRelevanceRank(name: string, categories?: string[]): number {
  const n = (name || "").toLowerCase();
  const catsStr = (categories || []).join(" ").toLowerCase();
  let rank = 0;
  // Non-marketing “agency” businesses common in India OSM
  if (
    /\b(gas|lpg|petrol|diesel|cycle|bicycle|news|travel|insurance|recruit|estate|real\s*estate|property|milk|oil|ply|trading|sales|tour|ticket|railway)\b/.test(
      n,
    ) &&
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
  opts?: { directoryMode?: boolean; preferAgency?: boolean; craftAsk?: string },
): SourceLead[] {
  const allowCountry = (point.country_code || "").toLowerCase();
  const preferAgency = !!opts?.preferAgency;
  const craftAsk = opts?.craftAsk || "";

  const scored = features.map((f: any) => {
    const p = f?.properties ?? {};
    const name = p.name || p.address_line1 || "";
    const rank = preferAgency ? agencyRelevanceRank(name, p.categories || []) : 0;
    return { f, rank, name };
  });
  scored.sort((a, b) => b.rank - a.rank);

  let ordered = scored;
  if (preferAgency) {
    const good = scored.filter((s) => s.rank >= 20);
    ordered = good.length >= 3 ? good : scored.filter((s) => s.rank >= 20);
  }

  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const { f, rank } of ordered) {
    const p = f?.properties ?? {};
    const name = p.name || p.address_line1;
    if (!name) continue;
    if (p.closed === true || p.permanently_closed === true) continue;
    if (/\b(permanently closed|closed down|disused)\b/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (allowCountry && p.country_code && String(p.country_code).toLowerCase() !== allowCountry) {
      continue;
    }
    // Real business website only — never geoapify place pages.
    const websiteRaw = p.website || p.contact?.website || undefined;
    const website =
      websiteRaw && /^https?:\/\//i.test(websiteRaw) && !/geoapify\.com\/place/i.test(websiteRaw)
        ? websiteRaw
        : undefined;
    const phone = p.phone || p.contact?.phone || undefined;
    const city = p.city || point.city || locText;
    const address = p.formatted || p.address_line1 || "";

    const agencyHit = rank > 0;
    const snippet = [address || city, phone ? `Phone: ${phone}` : ""].filter(Boolean).join(" · ");

    out.push({
      source: "geoapify",
      platform: "Local business",
      title: `${name}${city ? ` — ${city}` : ""}`,
      snippet: snippet || `${name} in ${city || locText}`,
      full_post_url: website,
      author: name,
      company: name,
      phones: phone ? [phone] : undefined,
      emails: p.email || p.contact?.email ? [p.email || p.contact.email] : undefined,
      posted_at: undefined,
      engagement: agencyHit ? 55 : 30,
      is_decision_maker: true,
      intentBoost: opts?.directoryMode ? (agencyHit ? 26 : 12) : 10,
      signal_type: "direct_intent",
      why_match: address || `${name} in ${city || locText}`,
      match_reasons: [
        `Match in ${city || locText}`,
        ...(website ? ["Has website"] : []),
        ...(agencyHit ? ["Agency/marketing name signal"] : []),
      ],
      address: address || undefined,
    } as SourceLead);
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

  // Try agency-biased or trade name filter first, then broad category fill
  const tradeName = nameFilterForQuery(qx);
  const features =
    preferAgency || tradeName
      ? await fetchPlacesFeatures({
          filter,
          bias: `${point.lon},${point.lat}`,
          limit: PLACES_LIMIT_PER_CITY,
          cats,
          key,
          nameFilter: preferAgency ? "agency" : tradeName,
        })
      : [];
  if (features.length < 10) {
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

  return featuresToLeads(
    features,
    country,
    { ...point, city },
    {
      directoryMode: opts?.directoryMode,
      preferAgency,
      craftAsk: qx.skill || qx.role,
    },
  );
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

  const locText = normalizeLocalLocation(
    (locationHint && locationHint.trim()) ||
      extractLocationFromQuery(qx.raw) ||
      extractLocationFromQuery(`${qx.skill} ${qx.role}`) ||
      "",
  );

  // Directory / location searches must not silently search a random default city.
  if (!locText) return [];

  const preferAgency = wantsAgencyIcp(qx);

  // Country-scale: fan out gazetteer cities (place:country is sparse/noisy and USA bbox times out).
  if (isCountryLocation(locText)) {
    const cities = fanOutCitiesForCountry(locText, opts?.directoryMode ? 8 : 6);
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
      merged.sort(
        (a, b) =>
          (b.intentBoost ?? 0) - (a.intentBoost ?? 0) || (b.engagement ?? 0) - (a.engagement ?? 0),
      );
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
  const filter = `circle:${point.lon},${point.lat},${CITY_RADIUS_M}`;

  const features =
    preferAgency || nameFilterForQuery(qx)
      ? await fetchPlacesFeatures({
          filter,
          bias: `${point.lon},${point.lat}`,
          limit,
          cats,
          key,
          nameFilter: preferAgency ? "agency" : nameFilterForQuery(qx),
        })
      : [];

  if (features.length < 10) {
    const broad = await fetchPlacesFeatures({
      filter,
      bias: `${point.lon},${point.lat}`,
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
    craftAsk: qx.skill || qx.role,
  });
}
