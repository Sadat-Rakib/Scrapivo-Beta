/**
 * Local geo gazetteer + OSM closed/address helpers.
 * Run: npx tsx scripts/verify-local-geo.mts
 */
import {
  fanOutCitiesForCountry,
  isGazetteerCountry,
  majorCitiesForCountry,
  normalizeLocalLocation,
} from "../src/lib/local/city-gazetteer";
import { isCountryLocation } from "../src/lib/search/query-classifier";
import { disambiguatePlaceQuery } from "../src/lib/search/place-disambiguate.server";
import { formatOsmAddress, isClosedOsmTags } from "../src/lib/search/osm-local-businesses.server";
import { deriveOpportunityTags } from "../src/lib/search/lead-segments";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check("USA normalizes to United States", normalizeLocalLocation("USA") === "United States");
check("us normalizes", normalizeLocalLocation("us") === "United States");
check("USA is a country", isCountryLocation("USA") && isCountryLocation("United States"));
check("Bangladesh is gazetteer country", isGazetteerCountry("Bangladesh"));
const bd = majorCitiesForCountry("Bangladesh");
check("Bangladesh includes Dhaka", bd.includes("Dhaka"));
check("Bangladesh includes Khulna", bd.includes("Khulna"));
check("USA fans out cities", fanOutCitiesForCountry("USA", 8).length >= 6);
check("दिल्ली → Delhi, India", normalizeLocalLocation("दिल्ली") === "Delhi, India");
check("ঢাকা → Dhaka", /Dhaka/i.test(normalizeLocalLocation("ঢাকা")));
check("Dhaka disambiguates to Bangladesh", /bangladesh/i.test(disambiguatePlaceQuery("Dhaka")));
check(
  "closed OSM tags dropped",
  isClosedOsmTags({ shop: "vacant", name: "Old Store" }) &&
    isClosedOsmTags({ opening_hours: "closed" }) &&
    isClosedOsmTags({ "disused:shop": "yes", name: "Gone" }),
);
check("open shop not closed", !isClosedOsmTags({ shop: "bakery", name: "Fresh Bread" }));
check(
  "OSM address formatted",
  formatOsmAddress({
    "addr:housenumber": "12",
    "addr:street": "Main St",
    "addr:city": "Khulna",
  }).includes("Main St"),
);
check(
  "no_website tag without inventing seo_poor",
  (() => {
    const tags = deriveOpportunityTags({ website_status: "verified_no_website" });
    return tags.includes("no_website") && !tags.includes("seo_poor");
  })(),
);
check(
  "seo_poor only with a page",
  deriveOpportunityTags({ website: "https://x.com", missingMeta: true }).includes("seo_poor") &&
    !deriveOpportunityTags({ website_status: "verified_no_website" }).includes("seo_poor"),
);
check(
  "poor_design from thin page",
  deriveOpportunityTags({ website: "https://x.com", thinPage: true }).includes("poor_design"),
);
check(
  "no_social only when observed false",
  deriveOpportunityTags({ website: "https://x.com", hasSocial: false }).includes("no_social") &&
    !deriveOpportunityTags({ website: "https://x.com" }).includes("no_social"),
);

console.log(failed ? `\n${failed} failed` : "\nAll local geo tests passed.");
process.exit(failed ? 1 : 0);
