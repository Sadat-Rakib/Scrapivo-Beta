/** Live read-path check: parser spec -> queryIndexForSpec -> Supabase idx_*.
 * Run: bunx tsx scripts/verify-index-live.mts "find me dentists in Pune"
 * Reads .env for MY_SUPABASE_* (never prints secrets). Exit non-zero on fail.
 */
import fs from "node:fs";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { queryIndexForSpec } from "@/lib/indexed/search-index.server";

for (const line of fs.readFileSync(".env", "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const query = process.argv.slice(2).join(" ") || "find me dentists in Pune";
const spec = extractSearchSpec(query);
console.log(JSON.stringify({ query, entity: spec.entity, criteria: spec.criteria }));
const res = await queryIndexForSpec(spec, 5);
if (!res) {
  console.log("no index table for entity (S3 path would serve)");
  process.exit(0);
}
console.log(JSON.stringify(res.meta));
for (const r of res.rows) console.log("-", r.title, "|", r.detail);
if (!res.rows.length) process.exit(2);
