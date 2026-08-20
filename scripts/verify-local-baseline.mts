/**
 * Local businesses opportunity intelligence — baseline notes + tag fixtures.
 * Run: npx tsx scripts/verify-local-baseline.mts
 */
import { deriveOpportunityTags, type LocalBusinessRow } from "../src/lib/search/lead-segments";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const fixtures: LocalBusinessRow[] = [
  {
    key: "a|",
    name: "No Site Dental",
    source: "osm",
    sample_url: "",
    score: 40,
    website_status: "verified_no_website",
  },
  {
    key: "b|",
    name: "HTTPS Cafe",
    website: "https://cafe.example",
    domain: "cafe.example",
    email: "hello@cafe.example",
    email_verified: true,
    phone: "+15551212",
    source: "geoapify",
    sample_url: "https://cafe.example",
    score: 70,
    website_status: "listed",
  },
  {
    key: "c|",
    name: "HTTP Plumber",
    website: "http://plumber.example",
    domain: "plumber.example",
    source: "foursquare",
    sample_url: "http://plumber.example",
    score: 55,
    website_status: "listed",
  },
];

for (const row of fixtures) {
  row.opportunity_tags = deriveOpportunityTags({
    ...row,
    https: row.website ? row.website.startsWith("https:") : undefined,
  });
}

check("fixture no-site tagged", fixtures[0].opportunity_tags!.includes("verified_no_website"));
check(
  "fixture sales_ready",
  fixtures[1].opportunity_tags!.includes("sales_ready") &&
    fixtures[1].opportunity_tags!.includes("has_email"),
);
check("fixture weak https", fixtures[2].opportunity_tags!.includes("weak_https"));

console.log(
  JSON.stringify(
    {
      note: "Tier A/B live probes use scripts/probe-local-places.mts + smoke-all-features.mts",
      fixtureTags: fixtures.map((f) => ({ name: f.name, tags: f.opportunity_tags })),
    },
    null,
    2,
  ),
);

console.log(failed ? `\n${failed} failed` : "\nLocal baseline fixtures passed.");
process.exit(failed ? 1 : 0);
