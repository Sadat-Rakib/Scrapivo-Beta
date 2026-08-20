/**
 * Profile discovery fixtures.
 * Run: npx tsx scripts/verify-profile-discovery.mts
 */
import {
  extractProfilesFromText,
  discoverProfiles,
  profileUrlsForHarvest,
} from "../src/lib/profile/discover-profiles.server";
import { claimsFromWebsiteSignals, mergeClaims } from "../src/lib/intelligence/evidence";
import {
  resolveEntity,
  dedupeByEntity,
  canonicalEntityId,
} from "../src/lib/intelligence/entity-resolve.server";
import {
  clearProviderBuckets,
  tryConsumeProvider,
  getProviderBudget,
} from "../src/lib/intelligence/provider-rate-limit.server";

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
  const bio =
    "Founder @ Acme. Links: https://linktr.ee/acmehq https://github.com/octocat https://twitter.com/acme";
  const allowed = new Set(["linktree", "github", "twitter", "x", "website"] as const);
  const fromBio = extractProfilesFromText(bio, "acme", allowed as any);
  check(
    "bio extracts linktree",
    fromBio.some((p) => p.platform === "linktree"),
  );
  check(
    "bio extracts github",
    fromBio.some((p) => p.platform === "github"),
  );
  check(
    "bio extracts twitter/x",
    fromBio.some((p) => p.platform === "twitter" || p.platform === "x"),
  );

  const profiles = await discoverProfiles(
    {
      id: "demo",
      name: "Demo Co",
      website: "https://example.com",
      bio: "https://beacons.ai/demo",
    },
    { playbook: "CUSTOMER_DISCOVERY" },
  );
  check("discover returns profiles", profiles.length > 0, `n=${profiles.length}`);
  check("harvest urls include bio/site", profileUrlsForHarvest(profiles).length > 0);

  const claims = claimsFromWebsiteSignals({
    website_status: "verified_no_website",
    email: "a@b.com",
  });
  check(
    "no website claim",
    claims.some((c) => /no first-party website/i.test(c.claim)),
  );
  check(
    "email claim",
    claims.some((c) => /email/i.test(c.claim)),
  );
  check("merge claims dedupes", mergeClaims(claims, claims).length === claims.length);

  const id1 = canonicalEntityId({ domain: "Acme.com" });
  const id2 = canonicalEntityId({ domain: "https://www.acme.com/about" });
  check("entity id stable on domain", id1 === id2);

  const r = resolveEntity({ name: "Acme Inc", domain: "acme.com" }, [
    { name: "Other", domain: "acme.com" },
  ]);
  check("resolve by domain", r.match === "domain" && r.confidence >= 0.9);

  const deduped = dedupeByEntity([
    { name: "Acme", domain: "acme.com", phone: "555" },
    { name: "ACME Inc", domain: "www.acme.com", phone: "555" },
  ]);
  check("dedupeByEntity collapses domain dupes", deduped.length === 1);

  clearProviderBuckets();
  const budget = getProviderBudget("serper");
  let allowedN = 0;
  for (let i = 0; i < budget.max + 5; i++) {
    if (tryConsumeProvider("serper")) allowedN += 1;
  }
  check(
    "provider rate limit caps",
    allowedN === budget.max,
    `allowed=${allowedN} max=${budget.max}`,
  );

  console.log(failed ? `\n${failed} failed` : "\nProfile/evidence/entity/rate tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
