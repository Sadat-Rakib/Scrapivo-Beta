/**
 * Shared contact + local opportunity tag unit checks.
 * Run: npx tsx scripts/verify-contact-local.mts
 */
import { deriveOpportunityTags } from "../src/lib/search/lead-segments";
import {
  clearContactDomainCache,
  discoverContactsForDomain,
} from "../src/lib/contact/shared-contact-intelligence.server";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const noSite = deriveOpportunityTags({
    website: undefined,
    website_status: "verified_no_website",
  });
  check(
    "verified_no_website tag",
    noSite.includes("verified_no_website") && noSite.includes("no_website"),
  );

  const unreachable = deriveOpportunityTags({
    website: undefined,
    website_status: "unreachable",
  });
  check("website_unreachable tag", unreachable.includes("website_unreachable"));

  const weak = deriveOpportunityTags({
    website: "http://example.com",
    https: false,
  });
  check("weak_https tag", weak.includes("weak_https") && weak.includes("seo_poor"));

  clearContactDomainCache();
  // example.com is safe; may or may not have emails — exercise the API + cache.
  const a = await discoverContactsForDomain("example.com", {
    company: "Example",
    maxPages: 2,
    freeOnly: true,
    skipRegistries: true,
  });
  check("shared discover returns domain", a.domain === "example.com");
  const b = await discoverContactsForDomain("example.com", {
    company: "Example",
    maxPages: 2,
  });
  check("second call hits cache", b.fromCache === true);

  console.log(failed ? `\n${failed} failed` : "\nContact/local unit tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
