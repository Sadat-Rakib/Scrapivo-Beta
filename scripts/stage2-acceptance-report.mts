import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

type Report = {
  id: string;
  query: string;
  round: number;
  phase: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  durationMs: number;
  providers?: Array<{ provider?: string; attempted?: boolean; succeeded?: boolean }>;
  funnel?: {
    reason?: string;
    rawCandidates?: number;
    postSpecFilter?: number;
    complete?: number;
    qualified?: number;
    returned?: number;
    pendingEnrichment?: number;
    qualificationRejected?: number;
  };
  accounting?: { retrieved?: number; fated?: number; unaccounted?: number; ok?: boolean };
  rejects?: Record<string, number>;
  incomplete?: Record<string, number>;
  contacts?: Array<{ title: string; present?: string[]; verified: string[]; missing: string[] }>;
  evidence?: Array<{ title: string; urls: string[] }>;
  failure?: string;
};

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function flag(name: string) {
  return process.argv.includes(`--${name}`);
}

const clearedKeys = [
  "USE_PAID_SOURCES",
  "SERPER_API_KEY",
  "SERPAPI_KEY",
  "SCRAPINGDOG_API_KEY",
  "GEOAPIFY_API_KEY",
  "FOURSQUARE_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "FIRECRAWL_API_KEY",
  "APIFY_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "MY_SUPABASE_SERVICE_ROLE_KEY",
  "R2_SEARCH_INDEX_ACCESS_KEY_ID",
  "R2_SEARCH_INDEX_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

function safeRunEnv(reportDir: string) {
  const env = { ...process.env };
  for (const key of clearedKeys) env[key] = "";
  env.USE_PAID_SOURCES = "false";
  env.S2_REPORT_DIR = reportDir;
  env.E2E_BASE_URL = env.E2E_BASE_URL || "http://127.0.0.1:8080";
  env.SEARXNG_URL = env.SEARXNG_URL || "http://127.0.0.1:8888";
  return env;
}

function compactCounts(report: Report) {
  const funnel = report.funnel ?? {};
  return [
    `raw=${funnel.rawCandidates ?? "?"}`,
    `screened=${funnel.postSpecFilter ?? "?"}`,
    `complete=${funnel.complete ?? "?"}`,
    `qualified=${funnel.qualified ?? "?"}`,
    `delivered=${funnel.returned ?? "?"}`,
    `unaccounted=${report.accounting?.unaccounted ?? "?"}`,
  ].join(" ");
}

const reportDir = resolve(arg("report-dir", "reports/stage2-acceptance"));
const out = resolve(arg("out", join(reportDir, "summary.md")));
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

if (flag("run")) {
  const child = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["playwright", "test", "e2e/stage2-acceptance.spec.ts"],
    { stdio: "inherit", env: safeRunEnv(reportDir) },
  );
  if (child.status !== 0) process.exitCode = child.status ?? 1;
}

const reports = readdirSync(reportDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(reportDir, file), "utf8")) as Report)
  .sort((a, b) => `${a.id}-${a.round}-${a.phase}`.localeCompare(`${b.id}-${b.round}-${b.phase}`));

const totals = reports.reduce<Record<string, number>>((acc, report) => {
  acc[report.status] = (acc[report.status] ?? 0) + 1;
  return acc;
}, {});

const lines = [
  "# Stage 2 Acceptance Harness Report",
  "",
  `Report dir: ${reportDir}`,
  `Totals: PASS ${totals.PASS ?? 0}, FAIL ${totals.FAIL ?? 0}, BLOCKED ${totals.BLOCKED ?? 0}`,
  "",
  "| Case | Round | Phase | Status | Duration ms | Providers | Funnel | Failure |",
  "| --- | ---: | --- | --- | ---: | --- | --- | --- |",
  ...reports
    .map((report) =>
      [
        report.id,
        String(report.round),
        report.phase,
        report.status,
        String(report.durationMs),
        String(report.providers?.filter((provider) => provider.attempted).length ?? 0),
        compactCounts(report),
        (report.failure ?? "").replace(/\|/g, "/").slice(0, 180),
      ].join(" | "),
    )
    .map((line) => `| ${line} |`),
  "",
  "## Contact And Evidence",
  "",
  ...reports.flatMap((report) => [
    `### ${report.id} round ${report.round} ${report.phase}`,
    "",
    `Contacts: ${(report.contacts ?? [])
      .map(
        (row) =>
          `${row.title} present=[${row.present?.join(",") || "none"}] verified=[${row.verified.join(",") || "none"}] missing=[${row.missing.join(",") || "none"}]`,
      )
      .join("; ") || "none"}`,
    `Evidence URLs: ${(report.evidence ?? []).reduce((sum, row) => sum + row.urls.length, 0)}`,
    `Rejects: ${JSON.stringify(report.rejects ?? {})}`,
    `Incomplete: ${JSON.stringify(report.incomplete ?? {})}`,
    "",
  ]),
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ reports: reports.length, out, totals }));
