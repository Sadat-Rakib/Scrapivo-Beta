import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const { searchLocalBusinesses } = await import("../src/lib/search/foursquare-places.server.ts");
const { isJunkLocalListing, isRealBusinessWebsite, matchesLocalCraft } =
  await import("../src/lib/search/place-disambiguate.server.ts");

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

const leads = await searchLocalBusinesses(qx, "Toronto", { directoryMode: true, min: 8 });
const filtered = leads.filter((l) => {
  const name = (l.company || l.author || l.title || "").split(" — ")[0];
  if (isJunkLocalListing(name, "plumbers")) return false;
  if (!matchesLocalCraft(name, "plumbers")) return false;
  return true;
});

console.log("places raw", leads.length, "filtered", filtered.length);
console.log(
  filtered.slice(0, 8).map((l) => ({
    name: (l.company || l.author || l.title || "").split(" — ")[0],
    url: isRealBusinessWebsite(l.full_post_url) ? l.full_post_url : null,
    phone: (l as { phones?: string[] }).phones?.[0] || null,
    src: l.source,
  })),
);
