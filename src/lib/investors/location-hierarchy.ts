/**
 * Location hierarchy: city → country → region → continent.
 * Matching expands ONLY to ancestors (never peer countries).
 * Dhaka → Bangladesh + South Asia + Asia (not India).
 */

export interface LocationData {
  country: string;
  region: string;
  continent: string;
}

/** Canonical country/region tokens used in investment_locations. */
export const LOCATION_ALIASES: Record<string, string> = {
  usa: "USA",
  us: "USA",
  "u.s.": "USA",
  "u.s.a.": "USA",
  "united states": "USA",
  "united states of america": "USA",
  america: "USA",
  uk: "UK",
  "u.k.": "UK",
  "united kingdom": "UK",
  "great britain": "UK",
  britain: "UK",
  england: "UK",
  uae: "UAE",
  "united arab emirates": "UAE",
  "south korea": "South Korea",
  korea: "South Korea",
  "czech republic": "Czech Republic",
  czechia: "Czech Republic",
  "hong kong": "Hong Kong",
  "saudi arabia": "Saudi Arabia",
  "sri lanka": "Sri Lanka",
  "new zealand": "New Zealand",
  "south africa": "South Africa",
  "north america": "North America",
  "south america": "South America",
  "south asia": "South Asia",
  "southeast asia": "Southeast Asia",
  "south-east asia": "Southeast Asia",
  "east asia": "East Asia",
  "middle east": "Middle East",
  "western europe": "Western Europe",
  "eastern europe": "Eastern Europe",
  "northern europe": "Northern Europe",
  "southern europe": "Southern Europe",
  latam: "South America",
  "latin america": "South America",
  mena: "Middle East",
  bangladesh: "Bangladesh",
  india: "India",
  pakistan: "Pakistan",
  canada: "Canada",
  mexico: "Mexico",
  germany: "Germany",
  france: "France",
  singapore: "Singapore",
  australia: "Australia",
  china: "China",
  japan: "Japan",
  israel: "Israel",
  brazil: "Brazil",
  nigeria: "Nigeria",
  kenya: "Kenya",
  asia: "Asia",
  europe: "Europe",
  africa: "Africa",
  oceania: "Oceania",
};

export const CITY_TO_LOCATION: Record<string, LocationData> = {
  Dhaka: { country: "Bangladesh", region: "South Asia", continent: "Asia" },
  Chittagong: { country: "Bangladesh", region: "South Asia", continent: "Asia" },
  Mumbai: { country: "India", region: "South Asia", continent: "Asia" },
  Delhi: { country: "India", region: "South Asia", continent: "Asia" },
  "New Delhi": { country: "India", region: "South Asia", continent: "Asia" },
  Bangalore: { country: "India", region: "South Asia", continent: "Asia" },
  Bengaluru: { country: "India", region: "South Asia", continent: "Asia" },
  Hyderabad: { country: "India", region: "South Asia", continent: "Asia" },
  Chennai: { country: "India", region: "South Asia", continent: "Asia" },
  Kolkata: { country: "India", region: "South Asia", continent: "Asia" },
  Pune: { country: "India", region: "South Asia", continent: "Asia" },
  Karachi: { country: "Pakistan", region: "South Asia", continent: "Asia" },
  Lahore: { country: "Pakistan", region: "South Asia", continent: "Asia" },
  Islamabad: { country: "Pakistan", region: "South Asia", continent: "Asia" },
  Singapore: { country: "Singapore", region: "Southeast Asia", continent: "Asia" },
  Bangkok: { country: "Thailand", region: "Southeast Asia", continent: "Asia" },
  Jakarta: { country: "Indonesia", region: "Southeast Asia", continent: "Asia" },
  Manila: { country: "Philippines", region: "Southeast Asia", continent: "Asia" },
  "Kuala Lumpur": { country: "Malaysia", region: "Southeast Asia", continent: "Asia" },
  "Ho Chi Minh": { country: "Vietnam", region: "Southeast Asia", continent: "Asia" },
  Hanoi: { country: "Vietnam", region: "Southeast Asia", continent: "Asia" },
  Beijing: { country: "China", region: "East Asia", continent: "Asia" },
  Shanghai: { country: "China", region: "East Asia", continent: "Asia" },
  Shenzhen: { country: "China", region: "East Asia", continent: "Asia" },
  "Hong Kong": { country: "Hong Kong", region: "East Asia", continent: "Asia" },
  Tokyo: { country: "Japan", region: "East Asia", continent: "Asia" },
  Seoul: { country: "South Korea", region: "East Asia", continent: "Asia" },
  Taipei: { country: "Taiwan", region: "East Asia", continent: "Asia" },
  Dubai: { country: "UAE", region: "Middle East", continent: "Asia" },
  "Abu Dhabi": { country: "UAE", region: "Middle East", continent: "Asia" },
  Riyadh: { country: "Saudi Arabia", region: "Middle East", continent: "Asia" },
  Doha: { country: "Qatar", region: "Middle East", continent: "Asia" },
  Istanbul: { country: "Turkey", region: "Middle East", continent: "Asia" },
  "San Francisco": { country: "USA", region: "North America", continent: "North America" },
  "San Francisco Bay Area": { country: "USA", region: "North America", continent: "North America" },
  "New York": { country: "USA", region: "North America", continent: "North America" },
  "New York City": { country: "USA", region: "North America", continent: "North America" },
  NYC: { country: "USA", region: "North America", continent: "North America" },
  Brooklyn: { country: "USA", region: "North America", continent: "North America" },
  Manhattan: { country: "USA", region: "North America", continent: "North America" },
  "Los Angeles": { country: "USA", region: "North America", continent: "North America" },
  Boston: { country: "USA", region: "North America", continent: "North America" },
  Austin: { country: "USA", region: "North America", continent: "North America" },
  Seattle: { country: "USA", region: "North America", continent: "North America" },
  Chicago: { country: "USA", region: "North America", continent: "North America" },
  Miami: { country: "USA", region: "North America", continent: "North America" },
  Atlanta: { country: "USA", region: "North America", continent: "North America" },
  Denver: { country: "USA", region: "North America", continent: "North America" },
  Portland: { country: "USA", region: "North America", continent: "North America" },
  "San Diego": { country: "USA", region: "North America", continent: "North America" },
  Philadelphia: { country: "USA", region: "North America", continent: "North America" },
  Washington: { country: "USA", region: "North America", continent: "North America" },
  "Washington DC": { country: "USA", region: "North America", continent: "North America" },
  Dallas: { country: "USA", region: "North America", continent: "North America" },
  Houston: { country: "USA", region: "North America", continent: "North America" },
  "Palo Alto": { country: "USA", region: "North America", continent: "North America" },
  "Menlo Park": { country: "USA", region: "North America", continent: "North America" },
  Toronto: { country: "Canada", region: "North America", continent: "North America" },
  Vancouver: { country: "Canada", region: "North America", continent: "North America" },
  Montreal: { country: "Canada", region: "North America", continent: "North America" },
  Calgary: { country: "Canada", region: "North America", continent: "North America" },
  London: { country: "UK", region: "Western Europe", continent: "Europe" },
  Paris: { country: "France", region: "Western Europe", continent: "Europe" },
  Berlin: { country: "Germany", region: "Western Europe", continent: "Europe" },
  Munich: { country: "Germany", region: "Western Europe", continent: "Europe" },
  Frankfurt: { country: "Germany", region: "Western Europe", continent: "Europe" },
  Amsterdam: { country: "Netherlands", region: "Western Europe", continent: "Europe" },
  Brussels: { country: "Belgium", region: "Western Europe", continent: "Europe" },
  Zurich: { country: "Switzerland", region: "Western Europe", continent: "Europe" },
  Geneva: { country: "Switzerland", region: "Western Europe", continent: "Europe" },
  Vienna: { country: "Austria", region: "Western Europe", continent: "Europe" },
  Luxembourg: { country: "Luxembourg", region: "Western Europe", continent: "Europe" },
  Madrid: { country: "Spain", region: "Southern Europe", continent: "Europe" },
  Barcelona: { country: "Spain", region: "Southern Europe", continent: "Europe" },
  Lisbon: { country: "Portugal", region: "Southern Europe", continent: "Europe" },
  Rome: { country: "Italy", region: "Southern Europe", continent: "Europe" },
  Milan: { country: "Italy", region: "Southern Europe", continent: "Europe" },
  Athens: { country: "Greece", region: "Southern Europe", continent: "Europe" },
  Stockholm: { country: "Sweden", region: "Northern Europe", continent: "Europe" },
  Copenhagen: { country: "Denmark", region: "Northern Europe", continent: "Europe" },
  Oslo: { country: "Norway", region: "Northern Europe", continent: "Europe" },
  Helsinki: { country: "Finland", region: "Northern Europe", continent: "Europe" },
  Warsaw: { country: "Poland", region: "Eastern Europe", continent: "Europe" },
  Prague: { country: "Czech Republic", region: "Eastern Europe", continent: "Europe" },
  Budapest: { country: "Hungary", region: "Eastern Europe", continent: "Europe" },
  Bucharest: { country: "Romania", region: "Eastern Europe", continent: "Europe" },
  Kiev: { country: "Ukraine", region: "Eastern Europe", continent: "Europe" },
  Kyiv: { country: "Ukraine", region: "Eastern Europe", continent: "Europe" },
  "São Paulo": { country: "Brazil", region: "South America", continent: "South America" },
  "Sao Paulo": { country: "Brazil", region: "South America", continent: "South America" },
  "Rio de Janeiro": { country: "Brazil", region: "South America", continent: "South America" },
  "Buenos Aires": { country: "Argentina", region: "South America", continent: "South America" },
  Santiago: { country: "Chile", region: "South America", continent: "South America" },
  Lima: { country: "Peru", region: "South America", continent: "South America" },
  Bogotá: { country: "Colombia", region: "South America", continent: "South America" },
  Bogota: { country: "Colombia", region: "South America", continent: "South America" },
  Nairobi: { country: "Kenya", region: "East Africa", continent: "Africa" },
  Lagos: { country: "Nigeria", region: "West Africa", continent: "Africa" },
  Cairo: { country: "Egypt", region: "North Africa", continent: "Africa" },
  "Cape Town": { country: "South Africa", region: "Southern Africa", continent: "Africa" },
  Johannesburg: { country: "South Africa", region: "Southern Africa", continent: "Africa" },
  Sydney: { country: "Australia", region: "Oceania", continent: "Oceania" },
  Melbourne: { country: "Australia", region: "Oceania", continent: "Oceania" },
  Auckland: { country: "New Zealand", region: "Oceania", continent: "Oceania" },
  "Tel Aviv": { country: "Israel", region: "Middle East", continent: "Asia" },
};

export const REGIONAL_GROUPS: Record<string, string[]> = {
  Asia: [
    "India",
    "Bangladesh",
    "Pakistan",
    "Sri Lanka",
    "Nepal",
    "China",
    "Japan",
    "South Korea",
    "Taiwan",
    "Hong Kong",
    "Singapore",
    "Thailand",
    "Indonesia",
    "Malaysia",
    "Philippines",
    "Vietnam",
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Turkey",
    "Jordan",
    "Lebanon",
    "Israel",
  ],
  "South Asia": ["India", "Bangladesh", "Pakistan", "Sri Lanka", "Nepal"],
  "Southeast Asia": [
    "Singapore",
    "Thailand",
    "Indonesia",
    "Malaysia",
    "Philippines",
    "Vietnam",
    "Myanmar",
  ],
  "East Asia": ["China", "Japan", "South Korea", "Taiwan", "Hong Kong", "Mongolia"],
  "Middle East": [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Turkey",
    "Jordan",
    "Lebanon",
    "Kuwait",
    "Bahrain",
    "Oman",
    "Israel",
  ],
  Europe: [
    "UK",
    "France",
    "Germany",
    "Netherlands",
    "Belgium",
    "Switzerland",
    "Austria",
    "Luxembourg",
    "Spain",
    "Portugal",
    "Italy",
    "Greece",
    "Sweden",
    "Denmark",
    "Norway",
    "Finland",
    "Iceland",
    "Poland",
    "Czech Republic",
    "Hungary",
    "Romania",
    "Ukraine",
    "Bulgaria",
    "Croatia",
    "Serbia",
    "Slovakia",
    "Slovenia",
  ],
  "Western Europe": [
    "UK",
    "France",
    "Germany",
    "Netherlands",
    "Belgium",
    "Switzerland",
    "Austria",
    "Luxembourg",
  ],
  "Southern Europe": ["Spain", "Portugal", "Italy", "Greece", "Malta", "Cyprus"],
  "Northern Europe": [
    "Sweden",
    "Denmark",
    "Norway",
    "Finland",
    "Iceland",
    "Estonia",
    "Latvia",
    "Lithuania",
  ],
  "Eastern Europe": [
    "Poland",
    "Czech Republic",
    "Hungary",
    "Romania",
    "Ukraine",
    "Bulgaria",
    "Croatia",
    "Serbia",
    "Slovakia",
    "Slovenia",
  ],
  "North America": ["USA", "Canada", "Mexico"],
  "South America": [
    "Brazil",
    "Argentina",
    "Chile",
    "Peru",
    "Colombia",
    "Venezuela",
    "Ecuador",
    "Bolivia",
    "Uruguay",
  ],
  Africa: ["Nigeria", "Kenya", "South Africa", "Egypt", "Ghana", "Morocco", "Ethiopia", "Tanzania"],
  "East Africa": ["Kenya", "Ethiopia", "Tanzania"],
  "West Africa": ["Nigeria", "Ghana"],
  "North Africa": ["Egypt", "Morocco"],
  "Southern Africa": ["South Africa"],
  Oceania: ["Australia", "New Zealand"],
};

const CONTINENTS = new Set([
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Africa",
  "Oceania",
]);

/** Country → parent region + continent (derived from REGIONAL_GROUPS + cities). */
const COUNTRY_TO_PARENTS: Record<string, { region: string; continent: string }> = (() => {
  const out: Record<string, { region: string; continent: string }> = {};
  for (const [city, data] of Object.entries(CITY_TO_LOCATION)) {
    if (!out[data.country]) {
      out[data.country] = { region: data.region, continent: data.continent };
    }
  }
  // Fill from regional groups when city map missed a country
  for (const [group, countries] of Object.entries(REGIONAL_GROUPS)) {
    if (CONTINENTS.has(group)) continue;
    const continent =
      Object.entries(REGIONAL_GROUPS).find(
        ([g, list]) => CONTINENTS.has(g) && countries.every((c) => list.includes(c)),
      )?.[0] || group;
    for (const c of countries) {
      if (!out[c]) out[c] = { region: group, continent };
      else if (!CONTINENTS.has(out[c].region) && CONTINENTS.has(continent)) {
        out[c] = { region: group, continent };
      }
    }
  }
  return out;
})();

export interface LocationMatchResult {
  matches: boolean;
  matchType: "direct" | "region" | "continent" | null;
  matchedRegion?: string;
}

export function normalizeLocation(location: string): string {
  return location
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/investors in /gi, "")
    .replace(/invest(ing|ment)? in /gi, "");
}

/** Map any free-text location token to a canonical label (USA, UK, Asia, …). */
export function canonicalizeLocationToken(raw: string): string | null {
  const n = normalizeLocation(raw);
  if (!n || n === "unknown" || n === "—" || n === "-") return null;
  if (LOCATION_ALIASES[n]) return LOCATION_ALIASES[n];
  // Title-case match against known region keys / countries
  for (const key of Object.keys(REGIONAL_GROUPS)) {
    if (key.toLowerCase() === n) return key;
  }
  for (const country of Object.keys(COUNTRY_TO_PARENTS)) {
    if (country.toLowerCase() === n) return country;
  }
  for (const [city, data] of Object.entries(CITY_TO_LOCATION)) {
    if (city.toLowerCase() === n) return data.country;
  }
  // Pass through cleaned Title Case for unknown but keep as-is for display
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Expand a user search term into the set of allowed ancestor tokens.
 * Never includes peer countries (Bangladesh does not expand to India).
 */
export function expandSearchAncestors(searchTerm: string): {
  tokens: Set<string>;
  kind: "city" | "country" | "region" | "continent" | "unknown";
  display: string;
} {
  const n = normalizeLocation(searchTerm);
  const tokens = new Set<string>();

  // City
  const cityKey = Object.keys(CITY_TO_LOCATION).find((c) => c.toLowerCase() === n);
  if (cityKey) {
    const d = CITY_TO_LOCATION[cityKey];
    tokens.add(d.country);
    tokens.add(d.region);
    tokens.add(d.continent);
    return { tokens, kind: "city", display: cityKey };
  }

  // Alias → country/region
  const aliased = LOCATION_ALIASES[n];
  if (aliased) {
    if (CONTINENTS.has(aliased) || REGIONAL_GROUPS[aliased]) {
      tokens.add(aliased);
      if (REGIONAL_GROUPS[aliased]) {
        for (const c of REGIONAL_GROUPS[aliased]) tokens.add(c);
      }
      const kind = CONTINENTS.has(aliased) ? "continent" : "region";
      return { tokens, kind, display: aliased };
    }
    // Country
    tokens.add(aliased);
    const parents = COUNTRY_TO_PARENTS[aliased];
    if (parents) {
      tokens.add(parents.region);
      tokens.add(parents.continent);
    }
    return { tokens, kind: "country", display: aliased };
  }

  // Region / continent by name
  const regionKey = Object.keys(REGIONAL_GROUPS).find((r) => r.toLowerCase() === n);
  if (regionKey) {
    tokens.add(regionKey);
    for (const c of REGIONAL_GROUPS[regionKey]) tokens.add(c);
    const kind = CONTINENTS.has(regionKey) ? "continent" : "region";
    return { tokens, kind, display: regionKey };
  }

  // Country by name
  const countryKey = Object.keys(COUNTRY_TO_PARENTS).find((c) => c.toLowerCase() === n);
  if (countryKey) {
    tokens.add(countryKey);
    const parents = COUNTRY_TO_PARENTS[countryKey];
    tokens.add(parents.region);
    tokens.add(parents.continent);
    return { tokens, kind: "country", display: countryKey };
  }

  // Unknown — only exact canonicalized token
  const fallback = canonicalizeLocationToken(searchTerm);
  if (fallback) tokens.add(fallback);
  return { tokens, kind: "unknown", display: searchTerm.trim() };
}

/** Normalize investor investment_locations (and optional HQ) to canonical tokens. */
export function normalizeInvestorLocationList(locs: string[]): string[] {
  const out = new Set<string>();
  for (const loc of locs || []) {
    const c = canonicalizeLocationToken(loc);
    if (c) out.add(c);
  }
  return [...out];
}

/**
 * Parse HQ / physical location string into invest tokens (country + parents).
 * "Boston, USA" → ["USA","North America"]; "Dhaka, Bangladesh" → ["Bangladesh","South Asia","Asia"]
 */
export function parseHqToInvestTokens(hq: string | undefined | null): string[] {
  if (!hq) return [];
  const raw = hq.trim();
  if (!raw || /^unknown$/i.test(raw)) return [];
  const tokens = new Set<string>();

  const addCountryTree = (country: string) => {
    tokens.add(country);
    const parents = COUNTRY_TO_PARENTS[country];
    if (parents) {
      tokens.add(parents.region);
      tokens.add(parents.continent);
    }
  };

  // Try city match on any comma segment or full string
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of [raw, ...parts]) {
    const cityKey = Object.keys(CITY_TO_LOCATION).find(
      (c) => c.toLowerCase() === part.toLowerCase(),
    );
    if (cityKey) {
      const loc = CITY_TO_LOCATION[cityKey];
      tokens.add(loc.country);
      tokens.add(loc.region);
      tokens.add(loc.continent);
      continue;
    }
    const c = canonicalizeLocationToken(part);
    if (!c) continue;
    if (CONTINENTS.has(c) || REGIONAL_GROUPS[c]) {
      tokens.add(c);
    } else if (COUNTRY_TO_PARENTS[c]) {
      addCountryTree(c);
    }
  }
  return [...tokens];
}

/**
 * Match search term against investor locations using ancestor expansion only.
 */
export function matchLocation(
  searchTerm: string,
  investorLocations: string[],
): LocationMatchResult {
  const { tokens: allowed, kind, display } = expandSearchAncestors(searchTerm);
  if (!allowed.size) {
    return { matches: false, matchType: null };
  }

  const inv = new Set(normalizeInvestorLocationList(investorLocations).map((t) => t.toLowerCase()));
  if (!inv.size) {
    return { matches: false, matchType: null };
  }

  // Prefer most specific match for metadata
  const ordered = [...allowed];
  for (const token of ordered) {
    if (inv.has(token.toLowerCase())) {
      let matchType: LocationMatchResult["matchType"] = "direct";
      if (CONTINENTS.has(token)) matchType = "continent";
      else if (REGIONAL_GROUPS[token] && !COUNTRY_TO_PARENTS[token]) matchType = "region";
      else if (kind === "city" && token !== display) {
        // Matched parent of city
        matchType = CONTINENTS.has(token)
          ? "continent"
          : REGIONAL_GROUPS[token]
            ? "region"
            : "direct";
      }
      return { matches: true, matchType, matchedRegion: token };
    }
  }

  return { matches: false, matchType: null };
}

/** Effective invest locations: investment_locations or derived from HQ. */
export function effectiveInvestLocations(
  investmentLocations: string[] | undefined,
  hqLocation?: string | null,
): string[] {
  const primary = normalizeInvestorLocationList(investmentLocations || []);
  if (primary.length) return primary;
  return parseHqToInvestTokens(hqLocation);
}

/** Add region/continent parents for any country tokens present. */
export function expandInvestLocationsWithParents(locs: string[]): string[] {
  const out = new Set<string>();
  for (const loc of normalizeInvestorLocationList(locs)) {
    out.add(loc);
    const parents = COUNTRY_TO_PARENTS[loc];
    if (parents) {
      out.add(parents.region);
      out.add(parents.continent);
    }
  }
  return [...out];
}
