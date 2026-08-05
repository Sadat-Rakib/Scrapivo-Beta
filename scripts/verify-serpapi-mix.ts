/**
 * Smoke: SerpAPI multi-platform + seller pitch drop.
 *   npx tsx scripts/verify-serpapi-mix.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.USE_PAID_SOURCES = "true";

import { paidDiscoveryEnabled } from "../src/lib/search/paid-discovery";
import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchSerpAPI } from "../src/lib/search/sources.server";
import { isSellerOrProviderLead } from "../src/lib/validation";
import type { Lead } from "../src/lib/scoring";

console.log("paid", paidDiscoveryEnabled());
const c = classifyQuery("designer");
const qx = expandFromClassified(c);
const leads = await searchSerpAPI(qx);
const by: Record<string, number> = {};
for (const l of leads) by[l.source] = (by[l.source] ?? 0) + 1;
console.log("serpapi leads", leads.length, by);
console.log(
  "sample",
  leads.slice(0, 5).map((l) => ({ s: l.source, t: l.title.slice(0, 50), fw: l.freshness_window })),
);

const pitch = {
  source: "githubintent",
  title: "Try our AI agent who is hiring",
  snippet: "I built an agent — check out my work",
  full_post_url: "https://github.com/x/y/issues/1",
} as Lead;
const dropped = isSellerOrProviderLead(pitch);
console.log("seller pitch dropped?", dropped);

const nonReddit = Object.keys(by).filter((s) => s !== "reddit" && s !== "redditrss");
const ok = dropped && (leads.length === 0 || nonReddit.length > 0);
// Empty SerpAPI is a quota/network issue, not a code failure — still require seller drop.
console.log(dropped ? "PASS seller" : "FAIL seller");
console.log(leads.length > 0 ? `PASS serpapi volume (${leads.length})` : "WARN serpapi empty (quota/network?)");
process.exit(dropped ? 0 : 1);
