/**
 * Probe candidate Workday CXS tenants and persist only live ones.
 * POSTs a minimal 1-result jobs query per tenant/site pair.
 *   npx tsx scripts/probe-workday-tenants.mts
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve("data/workday_tenants.json");
const UA = "Scrapivo/1.0 (jobs source verification; contact: support@scrapivo.app)";

type Cand = { tenant: string; host: string; sites: string[] };

async function probe(tenant: string, host: string, site: string): Promise<number> {
  const url = `https://${tenant}.${host}/wday/cxs/${tenant}/${site}/jobs`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return -1;
    const j = (await res.json()) as { total?: number };
    return typeof j.total === "number" ? j.total : -1;
  } catch {
    return -1;
  }
}

const raw = JSON.parse(readFileSync(FILE, "utf8")) as {
  verified: Array<{ tenant: string; host: string; site: string; total: number }>;
  candidates: Cand[];
};
copyFileSync(FILE, FILE + ".bak");

const verified: Array<{ tenant: string; host: string; site: string; total: number }> = [];
for (const c of raw.candidates) {
  for (const site of c.sites) {
    const total = await probe(c.tenant, c.host, site);
    if (total >= 0) {
      console.log(`OK   ${c.tenant}.${c.host}/${site} total=${total}`);
      verified.push({ tenant: c.tenant, host: c.host, site, total });
    } else {
      console.log(`dead ${c.tenant}.${c.host}/${site}`);
    }
  }
}

writeFileSync(
  FILE,
  JSON.stringify(
    { note: raw.note, verified, candidates: [] },
    null,
    2,
  ) + "\n",
);
console.log(`[probe] ${verified.length} live endpoints → ${FILE}`);
