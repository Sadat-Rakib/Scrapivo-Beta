/**
 * Generate Phase A–C audit artifacts under reports/universal-audit/.
 * Run: npx tsx scripts/gen-universal-audit.mts
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "reports", "universal-audit");
mkdirSync(OUT, { recursive: true });

function listTs(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

const searchMods = listTs("src/lib/search");
const localMods = listTs("src/lib/local");
const jobMods = listTs("src/lib/jobs");
const contactMods = listTs("src/lib/contact");
const intelMods = listTs("src/lib/intelligence");

const coverage = JSON.parse(readFileSync(join(ROOT, "data/coverage-matrix.json"), "utf8"));
const geoRows: Array<Record<string, unknown>> = [];
for (const [ent, body] of Object.entries(coverage.entities as Record<string, any>)) {
  const byGeo = body.byGeo || {};
  const declared = body.declaredProviders || [];
  for (const [iso, g] of Object.entries(byGeo as Record<string, any>)) {
    geoRows.push({
      entity: ent,
      iso,
      s3Rows: g.s3Rows ?? null,
      s3Files: g.s3Files ?? null,
      s3Bytes: g.s3Bytes ?? null,
      footerMeasured: !!g.footerMeasured,
      declaredProviders: declared,
      liveDeclared: declared.length > 0,
      status:
        g.s3Rows > 0
          ? "PARTIAL_DATA"
          : g.s3Files > 0
            ? "FILE_PRESENT_UNMEASURED_OR_EMPTY"
            : "NO_S3",
      testedLive: "UNKNOWN",
    });
  }
}
writeFileSync(join(OUT, "geo-matrix-raw.json"), JSON.stringify({ builtAt: coverage.builtAt, rows: geoRows }, null, 2));

const geoSummary: Record<string, { geos: number; withRows: number; noRows: number }> = {};
for (const r of geoRows) {
  const e = String(r.entity);
  geoSummary[e] ??= { geos: 0, withRows: 0, noRows: 0 };
  geoSummary[e].geos++;
  if (typeof r.s3Rows === "number" && r.s3Rows > 0) geoSummary[e].withRows++;
  else geoSummary[e].noRows++;
}

const bizFiles = existsSync(join(ROOT, "data"))
  ? readdirSync(join(ROOT, "data")).filter((f) => f.startsWith("local_businesses_") && f.endsWith(".jsonl"))
  : [];

writeFileSync(
  join(OUT, "inventory-index.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      searchModules: searchMods,
      localModules: localMods,
      jobModules: jobMods,
      contactModules: contactMods,
      intelligenceModules: intelMods,
      localBusinessJsonlCount: bizFiles.length,
      coverageSummary: geoSummary,
      workers: existsSync(join(ROOT, "workers")) ? readdirSync(join(ROOT, "workers")) : [],
      freehireCmds: existsSync(join(ROOT, "freehire/cmd"))
        ? readdirSync(join(ROOT, "freehire/cmd")).slice(0, 80)
        : [],
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      out: OUT,
      searchMods: searchMods.length,
      geoRows: geoRows.length,
      geoSummary,
      bizFiles: bizFiles.length,
    },
    null,
    2,
  ),
);
