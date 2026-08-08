import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { searchGeoapifyPlaces } = await import("../src/lib/search/geoapify-places.server");
const { searchFoursquarePlaces } = await import("../src/lib/search/foursquare-places.server");

const qx = {
  raw: "dentists in Austin Texas",
  skill: "dentist",
  role: "dentist",
  queryType: "skill" as const,
  relatedSkills: [] as string[],
  buyerIntentQueries: [] as string[],
  buyerPhrases: [] as string[],
  jobBoardQueries: [] as string[],
  jobBoardTerms: [] as string[],
  socialQueries: [] as string[],
  redditBuyerQueries: [] as string[],
  booleanWebQueries: [] as string[],
  customerPhrases: [] as string[],
  subreddits: [] as string[],
  negativePhrases: [] as string[],
  negativeSignals: [] as string[],
};

const [geo, fs] = await Promise.all([
  searchGeoapifyPlaces(qx, "Austin, Texas", { directoryMode: true }).catch((e: Error) => {
    console.error("geoapify err", e.message);
    return [];
  }),
  searchFoursquarePlaces(qx, "Austin, Texas", { directoryMode: true }).catch((e: Error) => {
    console.error("foursquare err", e.message);
    return [];
  }),
]);

console.log(
  "Geoapify local leads=",
  geo.length,
  geo.slice(0, 3).map((l) => l.company || l.title),
);
console.log(
  "Foursquare local leads=",
  fs.length,
  fs.slice(0, 3).map((l) => l.company || l.title),
);
const ok = geo.length + fs.length > 0;
console.log(ok ? "PASS local business sources" : "FAIL local business sources");
process.exit(ok ? 0 : 1);
