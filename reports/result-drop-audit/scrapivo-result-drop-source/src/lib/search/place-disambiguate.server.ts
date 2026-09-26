/**
 * Disambiguate place queries so "Toronto" → Toronto, Canada (not Toronto, IA).
 * Also helpers for real websites and junk local listings.
 */

import { CITY_COUNTRY_HINTS, normalizeLocalLocation } from "@/lib/local/city-gazetteer";

/** City name (lowercase) → preferred country/region for geocoding. */
const MAJOR_CITY_COUNTRY: Record<string, string> = { ...CITY_COUNTRY_HINTS };

/**
 * Expand a bare city into a geocode-friendly query when we know the major metro.
 * "Toronto" → "Toronto, Canada". Already-qualified strings pass through.
 */
export function disambiguatePlaceQuery(place: string): string {
  const normalized = normalizeLocalLocation(place);
  const raw = (normalized || "").trim();
  if (!raw) return raw;
  if (
    /,/.test(raw) ||
    /\b(canada|usa|us\b|uk|australia|ontario|texas|california|india|bangladesh|pakistan|uae)\b/i.test(
      raw,
    )
  ) {
    return raw;
  }
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  const country = MAJOR_CITY_COUNTRY[key];
  if (country) return `${raw}, ${country}`;
  return raw;
}

/** True if URL is a real business website (not a places directory page). */
export function isRealBusinessWebsite(url: string | undefined | null): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (/^(geoapify\.com|foursquare\.com|openstreetmap\.org|osm\.org|yelp\.com|facebook\.com|instagram\.com|linkedin\.com)$/i.test(host)) {
      return false;
    }
    if (/geoapify\.com\/place/i.test(url)) return false;
    if (/foursquare\.com\/v\//i.test(url)) return false;
    if (/tools\.usps\.com/i.test(url)) return false;
    return true;
  } catch {
    return false;
  }
}

const GOV_JUNK_RE =
  /\b(post\s*office|fire\s*(department|station)|police|sheriff|city\s*hall|town\s*hall|municipal|county\s*(office|building)|usps|library|school\s*district|volunteer\s*fire|corvette|food\s*&\s*gas|gas\s*station)\b/i;

const STREET_ONLY_RE =
  /^(main|broadway|clinton|high|church|market|king|queen|front|bay|yonge)\s+(street|st\.?|ave\.?|avenue|rd\.?|road)$/i;

/** Drop government / infra POIs unless the user asked for them. */
export function isJunkLocalListing(name: string, categoryAsk: string): boolean {
  const n = (name || "").trim();
  if (!n || n.length < 2) return true;
  if (STREET_ONLY_RE.test(n)) return true;
  const ask = (categoryAsk || "").toLowerCase();
  const wantsGov = /\b(post\s*office|fire|police|government|library|school)\b/.test(ask);
  if (!wantsGov && GOV_JUNK_RE.test(n)) return true;
  return false;
}

/**
 * Profession signatures: [name pattern, tokens that identify the SAME
 * profession in a category ask]. Used for a generic cross-category guard —
 * e.g. "Lawyer Referral Service" must never survive an HVAC ask.
 */
const PROFESSION_SIGNATURES: RegExp[] = [
  /\b(lawyer|attorney|legal|law firm|advocate)\b/,
  /\b(dentist|dental|orthodontis)\b/,
  /\b(veterinar|animal hospital|vet clinic)\b/,
  /\b(optometr|optical|eye care|vision center)\b/,
  /\b(chiropract)\b/,
  /\b(salon|barber|hairstyl)\b/,
  /\b(plumb)\b/,
  /\b(roof)\b/,
  /\b(hvac|heating|air conditioning|cooling|furnace)\b/,
  /\b(electrician|electrical)\b/,
  /\b(landscap|lawn|garden)\b/,
  /\b(tattoo|piercing)\b/,
];

/**
 * For trades and local categories, enforce strict category matching and reject clear category mismatches.
 */
export function matchesLocalCraft(name: string, categoryAsk: string): boolean {
  const ask = (categoryAsk || "").toLowerCase().trim();
  const n = (name || "").toLowerCase();
  if (!ask) return true;

  // Generic cross-category guard: the name names a specific profession the
  // user never asked for, and carries no trace of the requested craft.
  for (const sig of PROFESSION_SIGNATURES) {
    if (sig.test(n) && !sig.test(ask) && !n.includes(ask)) return false;
  }

  // Anti-matches for trades & medical categories
  if (/\b(dentist|dentists|dental)\b/.test(ask)) {
    if (
      /\b(eye|vision|optical|optometry|ophthalmology|dermatology|skin|chiropractic|foot|podiatry|vet|veterinary|animal|pet|hospital|emergency|pharmacy)\b/.test(
        n,
      ) &&
      !/\b(dentist|dental|teeth|tooth|orthodontic|smile)\b/.test(n)
    ) {
      return false;
    }
  }

  if (/\b(plumber|plumbers|plumbing)\b/.test(ask)) {
    if (
      /\b(electric|roof|hvac|solar|painter|cleaner|lawyer|attorney|salon|barber)\b/.test(n) &&
      !/\b(plumb|pipe|drain|sewer)\b/.test(n)
    ) {
      return false;
    }
  }

  if (/\b(roofer|roofers|roofing)\b/.test(ask)) {
    if (
      /\b(plumb|electric|hvac|solar|painter|lawyer|gym|spa)\b/.test(n) &&
      !/\b(roof|shingle|gutters)\b/.test(n)
    ) {
      return false;
    }
  }

  if (/\b(hvac|heating|air conditioning|cooling|furnace|ac repair)\b/.test(ask)) {
    if (
      /\b(lawyer|attorney|salon|barber|dental|vet|restaurant|cafe|gym|spa)\b/.test(n) &&
      !/\b(hvac|heat|air cond|cooling|furnace|vent|plumb|electric|climate|mechanical)\b/.test(n)
    ) {
      return false;
    }
  }

  if (/\b(gym|gyms|fitness)\b/.test(ask)) {
    if (
      /\b(restaurant|cafe|barber|salon|lawyer|accounting|plumber)\b/.test(n) &&
      !/\b(gym|fitness|crossfit|workout|training|studio|boxing|pilates|yoga)\b/.test(n)
    ) {
      return false;
    }
  }

  if (/\b(post office|fire department|police|volunteer fire|corvette|food\s*&\s*gas)\b/.test(n)) {
    return false;
  }

  return true;
}
