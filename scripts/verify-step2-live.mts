/** Step 2 live verification: resolver + families + opportunity + mode flow.
 * Run: bunx tsx scripts/verify-step2-live.mts (needs .env Supabase keys).
 * Exit non-zero on any FAIL. Hosted DB holds the demo slice: Dhaka is
 * expected to return honestly EMPTY (out of slice, not hallucinated).
 */
import fs from "node:fs";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";

for (const line of fs.readFileSync(".env", "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
process.env.USE_INDEXED_SEARCH = "true";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

// 1. Real-estate family serves from the index (Mumbai in slice).
{
  const r = await runSpecSearchCore("real estate businesses in Mumbai", {}, 20);
  const cats = new Set(r.rows.map((x) => x.category));
  check(
    "real-estate Mumbai -> rows, real_estate_* only",
    r.rows.length > 0 && [...cats].every((c) => c?.includes("real_estate")),
    JSON.stringify({ rows: r.rows.length, cats: [...cats], engine: r.dbMeta[0]?.engine }),
  );
}

// 2. HVAC no-website: rows exist and none carries a URL.
{
  const r = await runSpecSearchCore("find hvac in Austin without a website", {}, 20);
  check(
    "hvac Austin no-website -> rows, all url-less",
    r.rows.length > 0 && r.rows.every((x) => !x.url),
    JSON.stringify({ rows: r.rows.length, engine: r.dbMeta[0]?.engine }),
  );
}

// 3. Daaka round trip: suggest, confirm Dhaka, search -> honest empty (out of slice).
{
  const s0 = extractSearchSpec("find me dentists in Daaka");
  check(
    "Daaka -> missing location + Dhaka suggestion",
    s0.missing.includes("location") &&
      s0.locationSuggestion?.suggestion === "Dhaka",
    JSON.stringify({ missing: s0.missing, sug: s0.locationSuggestion }),
  );
  const r = await runSpecSearchCore("find me dentists in Daaka", {}, 20, { location: "Dhaka" });
  const engines = r.dbMeta.map((m) => m.engine);
  const served = r.spec.status === "ready_to_search" && r.rows.length > 0;
  const honestEmpty =
    r.rows.length === 0 && r.liveDiscovery === "db_thin_gapfill_pending";
  check(
    "Dhaka confirmed -> ready, S3 rows OR honest empty",
    served || honestEmpty,
    JSON.stringify({ status: r.spec.status, rows: r.rows.length, engines }),
  );
  if (served) {
    const bad = r.rows.filter(
      (x) => !((x.detail ?? "").toLowerCase().includes("dhaka") || (x.location ?? "").toLowerCase().includes("dhaka")),
    );
    check("Dhaka rows are actually Dhaka", bad.length === 0, JSON.stringify(bad.slice(0, 2)));
  }
}

// 4. Mode/offer answers ride along without disturbing retrieval.
{
  const r = await runSpecSearchCore(
    "find me dentists in Pune", {}, 20, { mode: "selling", offer: "web design" },
  );
  const fields = r.spec.criteria.map((c) => c.field);
  check(
    "mode+offer criteria present, retrieval unaffected",
    fields.includes("mode") && fields.includes("offer") && r.rows.length > 0,
    JSON.stringify({ fields, rows: r.rows.length }),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
