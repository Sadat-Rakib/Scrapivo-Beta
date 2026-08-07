/**
 * Disambiguate place queries so "Toronto" → Toronto, Canada (not Toronto, IA).
 * Also helpers for real websites and junk local listings.
 */

/** City name (lowercase) → preferred country/region for geocoding. */
const MAJOR_CITY_COUNTRY: Record<string, string> = {
  // Canada
  toronto: "Canada",
  vancouver: "Canada",
  montreal: "Canada",
  calgary: "Canada",
  ottawa: "Canada",
  edmonton: "Canada",
  winnipeg: "Canada",
  // US metros
  "new york": "New York, USA",
  "los angeles": "California, USA",
  chicago: "Illinois, USA",
  austin: "Texas, USA",
  seattle: "Washington, USA",
  "san francisco": "California, USA",
  denver: "Colorado, USA",
  miami: "Florida, USA",
  boston: "Massachusetts, USA",
  dallas: "Texas, USA",
  houston: "Texas, USA",
  phoenix: "Arizona, USA",
  atlanta: "Georgia, USA",
  // UK / EU / AU / etc.
  london: "UK",
  manchester: "UK",
  birmingham: "UK",
  edinburgh: "UK",
  paris: "France",
  lyon: "France",
  berlin: "Germany",
  munich: "Germany",
  hamburg: "Germany",
  frankfurt: "Germany",
  sydney: "Australia",
  melbourne: "Australia",
  brisbane: "Australia",
  dubai: "UAE",
  "abu dhabi": "UAE",
  singapore: "Singapore",
  mumbai: "India",
  bengaluru: "India",
  delhi: "India",
  hyderabad: "India",
  chennai: "India",
  pune: "India",
  gurugram: "India",
  kolkata: "India",
  dublin: "Ireland",
};

/**
 * Expand a bare city into a geocode-friendly query when we know the major metro.
 * "Toronto" → "Toronto, Canada". Already-qualified strings pass through.
 */
export function disambiguatePlaceQuery(place: string): string {
  const raw = (place || "").trim();
  if (!raw) return raw;
  if (/,/.test(raw) || /\b(canada|usa|us\b|uk|australia|ontario|texas|california|india)\b/i.test(raw)) {
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
    if (
      /^(geoapify\.com|foursquare\.com|openstreetmap\.org|osm\.org)$/i.test(host)
    ) {
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
 * For trades, reject clear category mismatches; trust provider filters otherwise.
 */
export function matchesLocalCraft(name: string, categoryAsk: string): boolean {
  const ask = (categoryAsk || "").toLowerCase().trim();
  const n = (name || "").toLowerCase();
  if (!ask) return true;
  // Anti-matches for trades (government / infra already covered by junk filter)
  if (/\b(plumb|roof|electric|hvac|dentist|law|gym|spa|salon)/.test(ask)) {
    if (/\b(post office|fire department|police|volunteer fire|corvette|food\s*&\s*gas)\b/.test(n)) {
      return false;
    }
  }
  return true;
}
