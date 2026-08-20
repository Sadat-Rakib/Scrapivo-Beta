/**
 * Investor geo + filter regression tests.
 * Run: npx tsx scripts/verify-investor-geo.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

for (const f of [".env", ".env.local"]) {
  const p = resolve(f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

import {
  matchLocation,
  expandSearchAncestors,
  effectiveInvestLocations,
  canonicalizeLocationToken,
} from "../src/lib/investors/location-hierarchy";
import { searchInvestors, getAllInvestors } from "../src/lib/investors/search";

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
  // Unit: ancestors
  const dhaka = expandSearchAncestors("Dhaka");
  check(
    "Dhaka ancestors include BD + South Asia + Asia",
    dhaka.tokens.has("Bangladesh") && dhaka.tokens.has("South Asia") && dhaka.tokens.has("Asia"),
  );
  check("Dhaka ancestors exclude India", !dhaka.tokens.has("India"));

  const bd = expandSearchAncestors("Bangladesh");
  check(
    "Bangladesh ancestors include South Asia + Asia",
    bd.tokens.has("Bangladesh") && bd.tokens.has("South Asia") && bd.tokens.has("Asia"),
  );
  check("Bangladesh ancestors exclude India", !bd.tokens.has("India"));

  const ny = expandSearchAncestors("New York");
  check("New York → USA + North America", ny.tokens.has("USA") && ny.tokens.has("North America"));

  check("United States alias → USA", canonicalizeLocationToken("United States") === "USA");
  check("UK alias", canonicalizeLocationToken("United Kingdom") === "UK");

  // Unit: matchLocation — no substring US→Australia
  check(
    "us search does not match Australia via substring",
    !matchLocation("us", ["Australia"]).matches,
  );
  check(
    "USA matches United States invest loc via alias",
    matchLocation("United States", ["USA"]).matches,
  );
  check(
    "Bangladesh matches Asia parent invest",
    matchLocation("Bangladesh", ["Asia"]).matches &&
      matchLocation("Bangladesh", ["Asia"]).matchedRegion === "Asia",
  );
  check("Bangladesh does not match India-only", !matchLocation("Bangladesh", ["India"]).matches);
  check("Dhaka matches South Asia", matchLocation("Dhaka", ["South Asia"]).matches);
  check("HQ fallback Boston USA", effectiveInvestLocations([], "Boston, USA").includes("USA"));

  // Integration against seed
  const all = getAllInvestors();
  check("seed loaded", all.length > 1000, `n=${all.length}`);

  const empty = await searchInvestors({ limit: 10000 });
  check(
    "empty filters returns many",
    empty.length === all.length || empty.length >= 1000,
    `n=${empty.length}`,
  );

  const preseed = await searchInvestors({ stage: "Pre-seed", limit: 5000 });
  const seed = await searchInvestors({ stage: "Seed", limit: 5000 });
  check("pre-seed results", preseed.length > 0, `n=${preseed.length}`);
  // Ensure no pre-seed-only false positive: seed filter should not be identical set blindly
  const preOnly = preseed.filter((r) => {
    const cats =
      "investment_categories" in r ? r.investment_categories : "stages" in r ? r.stages : [];
    const stages = cats.map((c: string) => {
      const m = String(c).match(/^([^(]+)/);
      return (m ? m[1] : c).toLowerCase().trim();
    });
    return (
      stages.some((s) => s.replace(/\s+/g, "-") === "pre-seed") &&
      !stages.some((s) => s.replace(/\s+/g, "-") === "seed")
    );
  });
  const leaked = preOnly.filter((r) => seed.some((s) => s.id === r.id));
  // pre-only can still appear in seed search if they ALSO have Seed — check seed-only filter doesn't include pure pre via substring
  const seedHasPurePre = seed.filter((r) => {
    const cats =
      "investment_categories" in r
        ? r.investment_categories.map((c) => {
            const m = c.match(/^([^(]+)/);
            return (m ? m[1] : c).toLowerCase().replace(/\s+/g, "-").trim();
          })
        : [];
    return cats.includes("pre-seed") && !cats.includes("seed");
  });
  check(
    "Seed filter excludes pure Pre-seed-only rows",
    seedHasPurePre.length === 0,
    `leaked=${seedHasPurePre.length}`,
  );

  const bdHits = await searchInvestors({ location: "Bangladesh", limit: 5000 });
  check("Bangladesh location hits", bdHits.length > 0, `n=${bdHits.length}`);
  const badPeers = bdHits.filter((r) => {
    const invest =
      "investment_locations" in r ? r.investment_locations : "locations" in r ? r.locations : [];
    const hq = "location" in r ? String(r.location) : "";
    const eff = effectiveInvestLocations(invest as string[], hq);
    const allowed = new Set(["Bangladesh", "South Asia", "Asia"]);
    return !eff.some((t) => allowed.has(t));
  });
  check(
    "Bangladesh hits all have BD/South Asia/Asia token",
    badPeers.length === 0,
    `bad=${badPeers.length}`,
  );

  const nyHits = await searchInvestors({ location: "New York", limit: 5000 });
  check("New York location hits", nyHits.length > 0, `n=${nyHits.length}`);

  console.log(failed ? `\n${failed} failed` : "\nAll investor geo tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
