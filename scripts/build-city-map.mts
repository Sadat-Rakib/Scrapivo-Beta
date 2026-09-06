/**
 * Build the global city→country routing map from the vendored GeoNames
 * cities15000 file (33,940 cities ≥15k population, CC-BY 4.0 — shipped with
 * the vendored freehire repo). Output: data/city_country_map.json
 *
 *   { "shanghai": { iso2: "CN", name: "Shanghai", aliases: [...] }, ... }
 *
 * Keys are lowercase city names AND aliases (deduped — first city wins on
 * collision, larger cities sort first by nothing-in-particular but GeoNames
 * order is stable). The TS local-business file source consumes this to route
 * ANY typed city to its country extract + to prefer that city's rows.
 *
 * Re-run to refresh (monitor the upstream file over time):
 *   npx tsx scripts/build-city-map.mts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(process.cwd(), "freehire/internal/location/cities15000.tsv");
const OUT = resolve(process.cwd(), "data/city_country_map.json");
const MAX_ALIASES = 8;

type CityEntry = { iso2: string; name: string; aliases: string[] };

function main() {
  if (!existsSync(SRC)) {
    console.error(`[city-map] missing ${SRC}`);
    process.exit(1);
  }
  const map: Record<string, CityEntry> = {};
  let count = 0;

  for (const line of readFileSync(SRC, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [canonical, countryRaw, aliasBlob] = line.split("\t");
    const name = (canonical || "").trim();
    const iso2 = (countryRaw || "").trim().toUpperCase();
    if (!name || iso2.length !== 2) continue;
    count++;

    const entry: CityEntry = {
      iso2,
      name,
      aliases: (aliasBlob || "")
        .split("|")
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.length >= 3 && a.length <= 32)
        .slice(0, MAX_ALIASES),
    };

    const keys = new Set<string>([name.toLowerCase(), ...entry.aliases]);
    for (const key of keys) {
      if (!map[key]) map[key] = entry;
    }
  }

  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), cities: map }));
  console.log(`[city-map] ${count} cities → ${Object.keys(map).length} routing keys → ${OUT}`);
}

main();
