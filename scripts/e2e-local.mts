/**
 * End-to-end Local businesses smoke (no auth): geocode → places → filter → enrich top sites.
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const category = "plumbers";
const location = "Toronto";

const { geocodePlace } = await import("../src/lib/search/geoapify-places.server.ts");
const { searchOsmLocalBusinesses } = await import("../src/lib/search/osm-local-businesses.server.ts");
const { searchLocalBusinesses } = await import("../src/lib/search/foursquare-places.server.ts");
const {
  disambiguatePlaceQuery,
  isJunkLocalListing,
  isRealBusinessWebsite,
  matchesLocalCraft,
} = await import("../src/lib/search/place-disambiguate.server.ts");
const { extractEmailsWithCheerio } = await import("../src/lib/contact/cheerio-email.server.ts");

const qx = {
  raw: `${category} in ${location}`,
  skill: category,
  role: category,
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

console.log("── Local E2E:", category, "+", location, "──");
console.log("disambiguate →", disambiguatePlaceQuery(location));

const geo = await geocodePlace(location);
console.log("geocode →", { city: geo?.city, cc: geo?.country_code, state: geo?.state_code });
const geoOk = geo?.country_code === "ca";

const [osm, places] = await Promise.all([
  searchOsmLocalBusinesses(qx, location).catch(() => []),
  searchLocalBusinesses(qx, location, { directoryMode: true, min: 8 }).catch(() => []),
]);

type Row = {
  name: string;
  website?: string;
  phone?: string;
  email?: string;
  source: string;
};

const rows: Row[] = [];
const seen = new Set<string>();
for (const l of [...osm, ...places]) {
  const name = ((l as { company?: string }).company || l.author || (l.title || "").split(" — ")[0] || "").trim();
  if (!name || seen.has(name.toLowerCase())) continue;
  if (isJunkLocalListing(name, category) || !matchesLocalCraft(name, category)) continue;
  seen.add(name.toLowerCase());
  const website = isRealBusinessWebsite(l.full_post_url) ? l.full_post_url : undefined;
  const phones = (l as { phones?: string[] }).phones;
  const emails = (l as { emails?: string[] }).emails;
  rows.push({
    name,
    website,
    phone: phones?.[0],
    email: emails?.[0],
    source: l.source,
  });
}

const iowaish = rows.filter((r) => /\bIA\b|Iowa/i.test(r.name)).length;
const junkLeft = rows.filter((r) => isJunkLocalListing(r.name, category)).length;
const fakeWeb = rows.filter((r) => r.website && !isRealBusinessWebsite(r.website)).length;

console.log("listings", {
  osm: osm.length,
  places: places.length,
  filtered: rows.length,
  withWebsite: rows.filter((r) => r.website).length,
  withPhone: rows.filter((r) => r.phone).length,
  iowaish,
  junkLeft,
  fakeWeb,
});

const targets = rows.filter((r) => r.website).slice(0, 3);
console.log("enriching top", targets.length, "sites…");
for (const t of targets) {
  const { emails, phones, pagesFetched } = await extractEmailsWithCheerio(t.website!);
  if (!t.email && emails[0]) t.email = emails[0];
  if (!t.phone && phones[0]) t.phone = phones[0];
  console.log({
    name: t.name,
    site: t.website,
    pagesFetched,
    email: t.email || null,
    phone: t.phone || null,
  });
}

const sample = rows.slice(0, 5).map((r) => ({
  name: r.name,
  src: r.source,
  web: r.website ? new URL(r.website).hostname : null,
  phone: !!r.phone,
}));
console.log("sample", sample);

const pass =
  geoOk &&
  rows.length >= 3 &&
  iowaish === 0 &&
  junkLeft === 0 &&
  fakeWeb === 0 &&
  !rows.some((r) => /geoapify\.com\/place/i.test(r.website || ""));

console.log(pass ? "LOCAL E2E PASS" : "LOCAL E2E FAIL");
process.exit(pass ? 0 : 1);
