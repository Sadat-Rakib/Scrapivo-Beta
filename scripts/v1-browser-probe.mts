import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";

loadEnvFile(".env");
const { buildSpec, stated } = await import("../src/lib/search/search-spec");
const { discoverWithBrowser, extractEntities } = await import("../src/lib/search/browser-live.server");
const spec = buildSpec({
  entity: "person",
  raw_query: "saas founders",
  criteria: [stated("role", "founder"), stated("industry", "SaaS")],
});
const started = Date.now();
try {
  const rows = await discoverWithBrowser(spec, {
    searchRunId: `v1-browser-probe-${started}`,
    visible: false,
    extractEntities: async (pages, searchSpec) => {
      const entities = await extractEntities(pages, searchSpec);
      await mkdir("reports/v1-runtime-fix", { recursive: true });
      await writeFile("reports/v1-runtime-fix/browser-observations.json", JSON.stringify({ pages, entities }, null, 2));
      return entities;
    },
  });
  await mkdir("reports/v1-runtime-fix", { recursive: true });
  await writeFile("reports/v1-runtime-fix/browser-probe.json", JSON.stringify({ spec, durationMs: Date.now() - started, rows }, null, 2));
  console.log(JSON.stringify({ scope: "browser-only diagnostic, not UI acceptance", count: rows.length, durationMs: Date.now() - started, names: rows.map((row) => row.title) }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Browser diagnostic failed");
  process.exitCode = 1;
}
