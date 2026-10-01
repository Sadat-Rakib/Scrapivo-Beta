/**
 * World city gazetteer for query understanding (server only).
 *
 * Backed by the GeoNames city map already used for local-business routing
 * (data/city_country_map.json, one parse per process). Registered into the
 * pure location resolver, which consults it only when a caller opts in, so
 * candidate-row geography keeps its existing rules.
 *
 * - lookup: every city with a name (canonical names, then aliases of at least
 *   five letters), most populous first. The resolver only trusts it together
 *   with a region qualifier ("Tallinn, Estonia").
 * - fuzzy: exactly one edit (a transposition counts as one) from a city name,
 *   same first letter, at least six letters, never a plural of a city name
 *   ("sales" is not Salé) and never a word the lexicon names (a role, trade or
 *   category is not a misspelled town).
 */
import { registerCityGazetteer, cityGazetteerRegistered, type CityGazetteer, type GazetteerCity } from "./location-resolver";
import { classifyHead, editDistance } from "@/lib/understanding/lexicon";

export type CityMapEntries = Record<string, { iso2: string; name: string; aliases?: string[] }>;

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();

const MIN_ALIAS = 5;
const MIN_TYPO = 6;

export function buildCityGazetteer(cities: CityMapEntries): CityGazetteer {
  const byName = new Map<string, GazetteerCity[]>();
  const byAlias = new Map<string, GazetteerCity[]>();
  const byInitial = new Map<string, Array<{ key: string; city: GazetteerCity }>>();
  const seen = new Set<string>();
  const add = (index: Map<string, GazetteerCity[]>, key: string, city: GazetteerCity) => {
    const list = index.get(key) ?? [];
    if (!list.some((item) => item.name === city.name && item.iso2 === city.iso2)) list.push(city);
    index.set(key, list);
  };
  // The map is ordered most populous first; list order keeps that ranking.
  for (const [key, entry] of Object.entries(cities)) {
    if (!entry?.name || !entry.iso2) continue;
    const city: GazetteerCity = { name: entry.name, iso2: entry.iso2.toUpperCase() };
    const name = fold(entry.name);
    if (!name) continue;
    const id = `${name}|${city.iso2}`;
    if (!seen.has(id)) {
      seen.add(id);
      add(byName, name, city);
      if (name.length >= 4) {
        const bucket = byInitial.get(name[0]!) ?? [];
        bucket.push({ key: name, city });
        byInitial.set(name[0]!, bucket);
      }
      for (const alias of entry.aliases ?? []) {
        const folded = fold(alias);
        if (folded && folded !== name && folded.replace(/[^a-z]/g, "").length >= MIN_ALIAS) add(byAlias, folded, city);
      }
    }
    const folded = fold(key);
    if (folded && folded !== name && folded.replace(/[^a-z]/g, "").length >= MIN_ALIAS) add(byAlias, folded, city);
  }
  const lookup = (value: string): GazetteerCity[] => {
    const key = fold(value);
    if (!key) return [];
    return byName.get(key) ?? byAlias.get(key) ?? [];
  };
  return {
    lookup,
    fuzzy(value) {
      const key = fold(value);
      if (key.length < MIN_TYPO || !/^[a-z]/.test(key) || lookup(value).length) return null;
      // A span the lexicon names (a role, trade, category) is not a town.
      if (classifyHead(value, { guess: false }).kind !== "unknown") return null;
      for (const candidate of byInitial.get(key[0]!) ?? []) {
        if (Math.abs(candidate.key.length - key.length) > 1) continue;
        // An English plural of a city name is a word, not a typo.
        if (key === `${candidate.key}s` || key === `${candidate.key}es`) continue;
        if (editDistance(key, candidate.key, 1) === 1) return candidate.city; // most populous first
      }
      return null;
    },
  };
}

let loading: Promise<void> | null = null;

/**
 * Register the world gazetteer once per process. Skipped under Vitest (tests
 * register fixtures explicitly, so results never depend on a 20 MB data file)
 * and a no-op when the data file is absent.
 */
export function ensureCityGazetteer(): Promise<void> {
  if (cityGazetteerRegistered()) return Promise.resolve();
  if (process.env.VITEST && process.env.SCRAPIVO_GAZETTEER !== "force") return Promise.resolve();
  loading ??= (async () => {
    try {
      const { loadCityCountryMap } = await import("@/lib/local/businesses-file-source");
      const cities = loadCityCountryMap();
      if (Object.keys(cities).length) registerCityGazetteer(buildCityGazetteer(cities));
    } catch {
      /* understanding keeps the structural overlay */
    }
  })();
  return loading;
}
