import { loadEnvFile } from "node:process";
loadEnvFile(".env");
process.env.V1_TRACE_OSM = "true";
const { runSpecSearchCore } = await import("../src/lib/spec-search.functions");
const q = "Find 10 plumbers in Austin with no website. Include their public phone numbers and emails when available.";
const result = await runSpecSearchCore(q, { liveGapfill: { browser: async (_spec, options) => {
  const rows = options.initialCandidates ?? [];
  console.log(JSON.stringify({ boundary: "browser-input", total: rows.length, structured: rows.filter(r => r.no_website_verification?.structured_absence).length, source: rows.filter(r => !!r.no_website_verification?.structured_source_url).length, seeds: rows.filter(r => r.no_website_verification?.structured_absence && r.no_website_verification?.structured_source_url && !r.website_url).length, sample: rows.slice(0, 4).map(r => ({ title:r.title, category:r.category, location:r.location, source:r.source_url, url:r.url, verification:r.no_website_verification })) }));
  return [];
} } }, 10, { mode: "looking" });
console.log(JSON.stringify({ boundary: "final", providers: result.providerAttempts?.map(p => ({id:p.provider,found:p.artifactsFound,error:p.error})), raw:result.retrievalTrace?.rawCandidates }));
process.exit(0);
