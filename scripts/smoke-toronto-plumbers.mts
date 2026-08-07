import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const { geocodePlace } = await import("../src/lib/search/geoapify-places.server.ts");
const { searchOsmLocalBusinesses } = await import("../src/lib/search/osm-local-businesses.server.ts");
const { disambiguatePlaceQuery } = await import("../src/lib/search/place-disambiguate.server.ts");

console.log("disambiguate", disambiguatePlaceQuery("Toronto"));
const p = await geocodePlace("Toronto");
console.log("geocode", JSON.stringify({ city: p?.city, cc: p?.country_code, state: p?.state_code, type: p?.result_type }));

const qx = {
  raw: "plumbers in Toronto",
  skill: "plumbers",
  role: "plumbers",
  queryType: "skill" as const,
  relatedSkills: [],
  buyerIntentQueries: [],
  buyerPhrases: [],
  jobBoardQueries: [],
  jobBoardTerms: [],
  socialQueries: [],
  redditBuyerQueries: [],
  booleanWebQueries: [],
  customerPhrases: [],
  subreddits: [],
  negativePhrases: [],
  negativeSignals: [],
};
const osm = await searchOsmLocalBusinesses(qx, "Toronto");
console.log(
  "osm sample",
  osm.slice(0, 5).map((l) => ({
    name: l.company || l.author,
    url: l.full_post_url || null,
    phone: (l as { phones?: string[] }).phones?.[0] || null,
  })),
);
console.log("osm count", osm.length);
