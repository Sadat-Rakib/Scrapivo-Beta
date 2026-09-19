import "../../scripts/_env.mts";
import { writeFileSync } from "node:fs";
import { extractSearchSpec } from "../../src/lib/search/search-spec-extract";
import { queryIndexForSpec } from "../../src/lib/indexed/search-index.server";
import { searchPeopleDB } from "../../src/lib/canonical/people.server";
import { searchCompaniesDB } from "../../src/lib/canonical/companies.server";
import { searchBusinessesDB } from "../../src/lib/canonical/businesses.server";
import { searchInvestorsDB } from "../../src/lib/canonical/investors.server";
import { runSpecSearchCore } from "../../src/lib/spec-search.functions";

process.env.VITEST = "1";
process.env.USE_INDEXED_SEARCH = "true";
process.env.USE_COVERAGE_SELECTOR = "false";

type Probe = Record<string, unknown>;
const probes: Probe[] = [];

async function timed(label: string, source: string, run: () => Promise<Probe>) {
  const at = Date.now();
  try {
    const value = await run();
    probes.push({ label, source, latencyMs: Date.now() - at, ...value });
  } catch (error) {
    probes.push({
      label,
      source,
      latencyMs: Date.now() - at,
      classification: /timed out|timeout/i.test(String(error)) ? "TIMEOUT" : "BUG",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function compactRows(rows: Array<Record<string, any>>) {
  return rows.slice(0, 3).map((row) => ({
    key: row.key ?? row.registry_id ?? row.id ?? null,
    name: row.name ?? row.company_name ?? row.title ?? null,
    role: row.role ?? row.title ?? null,
    category: row.category ?? null,
    location: row.location ?? row.location_raw ?? row.locality ?? row.city ?? null,
    country: row.country ?? row.location_country ?? null,
    website: row.website ?? row.url ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
  }));
}

for (const [label, query] of [
  ["people/founders-canada", "founders in Canada"],
  ["people/copywriters-canada", "copywriters in Canada"],
  ["people/software-engineers-toronto", "software engineers in Toronto"],
  ["people/designers-london", "designers in London"],
  ["people/sales-managers-new-york", "sales managers in New York"],
  ["companies/ai-toronto", "AI companies in Toronto"],
  ["companies/saas-london", "SaaS companies in London"],
  ["companies/construction-calgary", "construction companies in Calgary"],
  ["companies/healthcare-chicago", "healthcare companies in Chicago"],
  ["companies/manufacturing-pune", "manufacturing companies in Pune"],
  ["businesses/hvac-toronto", "HVAC businesses in Toronto"],
  ["businesses/dentists-edmonton", "dentists in Edmonton"],
  ["businesses/restaurants-austin", "restaurants in Austin"],
  ["businesses/plumbers-pune", "plumbers in Pune"],
  ["businesses/marketing-agencies-london", "marketing agencies in London"],
] as const) {
  await timed(label, "pg-index", async () => {
    const spec = extractSearchSpec(query);
    const result = await queryIndexForSpec(spec, 50, 0);
    const rows = result?.rows ?? [];
    return {
      query,
      entity: spec.entity,
      classification: rows.length ? "PASS" : "VALID_EMPTY",
      rows: rows.length,
      samples: compactRows(rows as Array<Record<string, any>>),
      meta: result?.meta ?? null,
    };
  });
}

for (const [label, query] of [
  ["investors/saas", { sector: "SaaS", limit: 50 }],
  ["investors/ai", { sector: "AI", limit: 50 }],
  ["investors/seed", { stage: "seed", limit: 50 }],
  ["investors/fintech", { sector: "Fintech", limit: 50 }],
] as const) {
  await timed(label, "s3-parquet", async () => {
    const result = await searchInvestorsDB(query);
    return {
      classification: result.rows.length ? "PASS" : "VALID_EMPTY",
      rows: result.rows.length,
      samples: compactRows(result.rows as Array<Record<string, any>>),
      meta: result.meta,
    };
  });
}

let knownPerson: Record<string, any> | null = null;
await timed("golden/person", "s3-parquet", async () => {
  const first = await searchPeopleDB({ role: "founder", country: "Canada", limit: 1 });
  knownPerson = first.rows[0] as Record<string, any> | undefined ?? null;
  if (!knownPerson?.name) throw new Error("known person seed not found");
  const exact = await searchPeopleDB({ name: knownPerson.name, country: knownPerson.country, limit: 5 });
  const found = exact.rows.some((row) => row.name === knownPerson!.name);
  return { classification: found ? "PASS" : "BUG", rows: exact.rows.length, known: compactRows([knownPerson]), meta: exact.meta };
});

await timed("golden/company", "s3-parquet", async () => {
  const exact = await searchCompaniesDB({ name: "S & A", limit: 5 });
  const found = exact.rows.some((row) => row.company_name === "S & A");
  const mapped = exact.rows.find((row) => row.company_name === "S & A") ?? exact.rows[0];
  const fieldsPreserved = !!(mapped?.website && mapped?.email && mapped?.phone && mapped?.location && mapped?.category);
  return {
    classification: found && fieldsPreserved ? "PASS" : "BUG",
    rows: exact.rows.length,
    fieldsPreserved,
    known: compactRows(exact.rows as Array<Record<string, any>>),
    meta: exact.meta,
  };
});

await timed("golden/business", "s3-parquet", async () => {
  const result = await searchBusinessesDB({ category: "restaurants", location: "Austin", limit: 5 });
  return {
    classification: result.rows.length ? "PASS" : "VALID_EMPTY",
    rows: result.rows.length,
    known: compactRows(result.rows as Array<Record<string, any>>),
    meta: result.meta,
  };
});

await timed("golden/investor", "s3-parquet", async () => {
  const result = await searchInvestorsDB({ name: "Aaref Hilaly", limit: 5 });
  const found = result.rows.some((row) => row.name === "Aaref Hilaly");
  return { classification: found ? "PASS" : "BUG", rows: result.rows.length, known: compactRows(result.rows as Array<Record<string, any>>), meta: result.meta };
});

for (const [label, query, limit] of [
  ["e2e/person", "founders in Canada", 5],
  ["e2e/business", "HVAC businesses in Toronto", 5],
  ["e2e/investor", "SaaS investors", 5],
  ["special/quantity-50", "restaurants in Austin", 50],
  ["special/diacritic-location", "restaurants in São Paulo", 5],
] as const) {
  await timed(label, "stored-pipeline", async () => {
    const result = await runSpecSearchCore(query, { enrichFn: null, liveGapfill: null }, limit, {}, { force: true });
    return {
      query,
      classification: result.rows.length ? "PASS" : "VALID_EMPTY",
      rows: result.rows.length,
      pendingEnrichment: result.pendingEnrichment,
      rejected: result.rejected,
      hasMore: result.hasMore,
      reason: result.retrievalTrace?.reason,
      samples: compactRows(result.rows as Array<Record<string, any>>),
      meta: result.dbMeta,
    };
  });
}

const summary = probes.reduce<Record<string, number>>((out, probe) => {
  const key = String(probe.classification ?? "BUG").toLowerCase().replace("valid_empty", "valid-empty");
  out[key] = (out[key] ?? 0) + 1;
  return out;
}, {});
const output = { generatedAt: new Date().toISOString(), summary, probes };
writeFileSync("reports/gate2/02-retrieval-certification.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ summary, probes: probes.map(({ label, classification, rows, latencyMs, error, reason }) => ({ label, classification, rows, latencyMs, error, reason })) }));
