/** Batch 1 verification battery: full runSpecSearchCore path, no browser needed.
 * Run: bunx tsx scripts/verify-batch1.mts
 * Asserts the 8 acceptance cases; exit non-zero on any FAIL.
 */
import fs from "node:fs";
import { runSpecSearchCore } from "@/lib/spec-search.functions";

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

const idx = (r: { dbMeta: { engine: string }[] }) => r.dbMeta[0]?.engine;

// 1-5: location proofs via pg-index
const proofs: Array<[string, string]> = [
  ["dentists in Pune", "business"],
  ["find me plumbers in Austin", "business"],
  ["find me companies in London", "company"],
  ["find me founders in Mumbai", "person"],
  ["find me companies in United States", "company"],
];
for (const [q, entity] of proofs) {
  const t0 = Date.now();
  const r = await runSpecSearchCore(q, {}, 20);
  check(
    `${q} -> ${entity}, pg-index, rows>0`,
    r.spec.entity === entity &&
      r.spec.status === "ready_to_search" &&
      r.rows.length > 0 &&
      idx(r) === "pg-index",
    JSON.stringify({ entity: r.spec.entity, rows: r.rows.length, meta: r.dbMeta }),
  );
  console.log(`  elapsed ${Date.now() - t0}ms`);
}

// 6: vague -> clarify, zero DB touch
{
  const r = await runSpecSearchCore("businesses", {}, 20);
  check(
    "vague -> clarify, no rows",
    r.spec.status === "needs_clarification" && r.rows.length === 0,
    JSON.stringify({ status: r.spec.status, missing: r.spec.missing }),
  );
}

// 7: forced no-location -> S3 refuse path, no timeout
{
  const t0 = Date.now();
  const r = await runSpecSearchCore(
    "yo find me businesses rn", {}, 25, { category: "restaurants" }, { force: true },
  );
  const ms = Date.now() - t0;
  check(
    "forced no-location -> S3 refuse, fast, empty",
    r.rows.length === 0 && idx(r) === "s3-parquet" && ms < 30000,
    JSON.stringify({ rows: r.rows.length, meta: r.dbMeta, ms }),
  );
}

// 8: out-of-slice country -> S3 full-corpus fallthrough (T3 coverage).
// With AWS creds: real S3 rows, both engines logged. Without: honest empty.
{
  const r = await runSpecSearchCore("find me dentists in Canada", {}, 20);
  const engines = r.dbMeta.map((m) => m.engine);
  const s3Served = engines.includes("s3-parquet") && r.rows.length > 0;
  const honestEmpty =
    r.rows.length === 0 && r.liveDiscovery === "db_thin_gapfill_pending";
  check(
    "Canada -> S3 fallthrough rows OR honest empty (no creds)",
    s3Served || honestEmpty,
    JSON.stringify({ rows: r.rows.length, live: r.liveDiscovery, engines }),
  );
  if (s3Served) {
    const bad = r.rows.filter(
      (x) => !(x.country === "CA" || (x.detail ?? "").includes("Canada") || (x.location ?? "").includes("Canada")),
    );
    check("Canada rows are actually Canadian", bad.length === 0, JSON.stringify(bad.slice(0, 2)));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
