/**
 * Print Discover source health (booleans + counts only — no secrets).
 *   npx tsx scripts/probe-discover-sources.mts [query]
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

const present = (k: string) => !!(process.env[k] || "").trim();
const paid = process.env.USE_PAID_SOURCES === "true";
const searx = (process.env.SEARXNG_URL || "").trim();
const searxLocal = /:\/\/(127\.0\.0\.1|localhost)\b/i.test(searx);

console.log("\n── Gates (no secret values) ─────────────────────────────");
console.log("USE_PAID_SOURCES", paid ? "true" : "false/unset");
console.log(
  "SEARXNG_URL",
  searx ? (searxLocal ? "localhost (skipped on Vercel)" : "set") : "empty",
);
console.log("SERPER_API_KEY", present("SERPER_API_KEY"));
console.log("SCRAPINGDOG_API_KEY", present("SCRAPINGDOG_API_KEY"));
console.log("SERPAPI_KEY", present("SERPAPI_KEY"));
console.log("TAVILY_API_KEY", present("TAVILY_API_KEY"));
console.log("MILLIONVERIFIER_API_KEY", present("MILLIONVERIFIER_API_KEY"));
console.log("ZEROBOUNCE_KEY", present("ZEROBOUNCE_KEY"));
console.log("GEOAPIFY_API_KEY", present("GEOAPIFY_API_KEY"));
console.log("FOURSQUARE_API_KEY", present("FOURSQUARE_API_KEY"));

if (!paid) {
  console.log("\nWARN: USE_PAID_SOURCES is not true — Serper social/decisionmakers stay off.");
}
if (searxLocal) {
  console.log("WARN: SEARXNG is localhost — on Vercel socialdorks need Serper.");
}

const q = process.argv[2] || "companies and people looking for lead generation services";
console.log("\n── Live fan-out:", q, "─────────────────────────────");

const { classifyQuery } = await import("../src/lib/search/query-classifier.ts");
const { expandFromClassified } = await import("../src/lib/search/query-expander.ts");
const { searchAllSources } = await import("../src/lib/search/sources.server.ts");
const { paidDiscoveryEnabled } = await import("../src/lib/search/paid-discovery.ts");
const { hasGoogleSerpProvider } = await import("../src/lib/search/serp-providers.server.ts");

console.log("paidDiscoveryEnabled()", paidDiscoveryEnabled());
console.log("hasGoogleSerpProvider()", hasGoogleSerpProvider());

const classified = classifyQuery(q);
classified.goal = "clients";
if (classified.type !== "product" && classified.signalMode !== "buying_signal") {
  classified.signalMode = "buying_signal";
}
const expanded = expandFromClassified(classified);
const t0 = Date.now();
const { leads, debug } = await searchAllSources({ classified, expanded });
const by: Record<string, number> = {};
for (const l of leads) by[l.source] = (by[l.source] ?? 0) + 1;

console.log("raw leads", leads.length, "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log(
  "by source",
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20),
);
console.log("sourceCounts", debug?.sourceCounts ?? {});
const socialish = [
  "socialdorks",
  "linkedin",
  "facebook",
  "twitter",
  "instagram",
  "serpapi",
  "decisionmakers",
];
for (const k of socialish) {
  const n = debug?.sourceCounts?.[k] ?? by[k] ?? 0;
  console.log(`  ${k}: ${n}`);
}
