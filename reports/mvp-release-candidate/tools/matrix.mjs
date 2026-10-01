// Task 16: cross-category matrix. Runs each query through the product core
// (browser-trace.mts custom product headed, worker runtime, local no-persist),
// one at a time, then writes MATRIX.json + MATRIX.md.
// usage: node reports/mvp-release-candidate/tools/matrix.mjs [--summarize-only]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Per-query raw logs (scratch; safe to delete between passes).
mkdirSync("reports/mvp-release-candidate/tmp", { recursive: true });

const QUERIES = [
  ["people", "m01", "B2B SaaS founders with public contact details"],
  ["people", "m02", "Founders of fintech startups in Berlin"],
  ["people", "m03", "CTOs at logistics companies in Toronto"],
  ["people", "m04", "Heads of marketing at DTC brands in London"],
  ["company", "m05", "SaaS companies in Toronto with public contact details"],
  ["company", "m06", "Cybersecurity companies in Austin hiring engineers"],
  ["company", "m07", "Marketing agencies in Bristol with websites"],
  ["company", "m08", "AI startups in Paris that raised funding this year"],
  ["local", "m09", "Restaurants in Calgary, Alberta with official websites"],
  ["local", "m10", "Plumbers in Camrose, Alberta without a website, with phone numbers"],
  ["local", "m11", "Dentists in Portland, Oregon with phone numbers"],
  ["local", "m12", "Coffee roasters in Copenhagen with email addresses"],
  ["job", "m13", "Remote senior frontend developer jobs"],
  ["job", "m14", "Data engineer jobs in Berlin"],
  ["investor", "m15", "Seed investors in fintech in London"],
  ["investor", "m16", "Angel investors in Toronto"],
  ["signal", "m17", "SaaS founders talking about churn on LinkedIn"],
  ["signal", "m18", "Companies looking for a Shopify developer"],
  ["chat", "m19", "hi cobblers arequippa pls"],
  ["chat", "m20", "need some founders round vinlius tryna bring on localistaion manager ppl rn"],
  ["edge", "m21", "Find 10 SaaS founders globally who may need help with AI automation"],
  ["edge", "m22", "Law firms in Ontario"],
  ["edge", "m23", "Yoga studios near Brooklyn with Instagram"],
  ["founder", "m24", "Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact"],
];

const traceFile = (tag) => `reports/mvp-release-candidate/BROWSER_TRACE_CUSTOM_PRODUCT_HEADED_matrix_${tag}.json`;

if (!process.argv.includes("--summarize-only")) {
  for (const [, tag, query] of QUERIES) {
    if (existsSync(traceFile(tag)) && process.argv.includes("--resume")) continue;
    const started = Date.now();
    const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "reports/mvp-release-candidate/browser-trace.mts", "custom", "product", "headed"], {
      env: { ...process.env, SCRAPIVO_BROWSER_ADAPTER: "worker", TRACE_QUERY: query, TRACE_TAG: `matrix_${tag}`, NODE_OPTIONS: "--max-old-space-size=2048" },
      encoding: "utf8", timeout: 420_000, maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(`reports/mvp-release-candidate/tmp/matrix_${tag}.log`, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
    console.log(JSON.stringify({ tag, exit: run.status, signal: run.signal, secs: Math.round((Date.now() - started) / 1000), trace: existsSync(traceFile(tag)) }));
  }
}

const rows = QUERIES.map(([category, tag, query]) => {
  if (!existsSync(traceFile(tag))) return { category, tag, query, verdict: "FAIL", why: "no trace (run crashed or timed out)" };
  const j = JSON.parse(readFileSync(traceFile(tag), "utf8"));
  const r = j.result ?? {};
  const ledger = r.candidateLedger ?? null;
  const mismatches = (j.audit ?? []).flatMap((a) => a.checks.filter((c) => c.status === "MISMATCH").map((c) => `${a.title}:${c.method}`));
  const unaccounted = ledger?.counts?.unaccounted ?? 0;
  const rowsOut = r.rowsReturned ?? 0;
  const evidenceless = (r.rows ?? []).filter((row) => !(row.evidence ?? []).length).map((row) => row.title);
  const problems = [
    j.error && `error ${j.error}`,
    r.outcome === "SEARCH_FAILED" && "SEARCH_FAILED",
    mismatches.length && `evidence mismatch ${mismatches.join(",")}`,
    unaccounted && `${unaccounted} streamed lead(s) unaccounted`,
    evidenceless.length && `rows without evidence ${evidenceless.join(",")}`,
  ].filter(Boolean);
  const clarified = r.clarify?.length ? `clarify:${r.clarify.join("|")}` : null;
  return {
    category, tag, query,
    outcome: r.outcome ?? null, rows: rowsOut, secs: Math.round((j.durationMs ?? 0) / 1000),
    runtime: (j.runtime ?? []).map((e) => e.used).join(",") || "none",
    pagesRead: (j.pages ?? []).filter((p) => /read/.test(p.outcome)).length,
    streamed: (j.streamedRows ?? []).length,
    ledger: ledger ? Object.entries(ledger.counts).filter(([, n]) => n).map(([k, n]) => `${k}=${n}`).join(" ") : null,
    rejectReasons: ledger?.rejectReasons ?? {},
    sourceHealth: r.retrievalTrace?.sourceHealth?.summary ?? null,
    reason: r.retrievalTrace?.reason ?? null,
    criteria: (r.criteria ?? []).filter((c) => !/^location_(id|kind|parents)=/.test(c)).join(", "),
    sample: (r.rows ?? []).slice(0, 3).map((row) => `${row.title}${row.company ? ` (${row.company})` : ""}`).join("; "),
    clarified,
    verdict: problems.length ? "FAIL" : rowsOut > 0 ? "PASS" : "HONEST_ZERO",
    why: problems.join("; ") || null,
  };
});
writeFileSync("reports/mvp-release-candidate/MATRIX.json", JSON.stringify(rows, null, 2));
const count = (v) => rows.filter((row) => row.verdict === v).length;
const md = [
  "# Cross-category matrix (Task 16)",
  "",
  "Each query ran through the product core (`runSpecSearchCore`, as after \"Search with defaults\"), worker runtime, headed Chromium, local no-persist. Verdicts: PASS = qualified rows with a clean evidence audit; HONEST_ZERO = no qualified rows, every candidate accounted for, no error; FAIL = crash, evidence mismatch, row without evidence, or an unaccounted streamed lead.",
  "",
  `PASS ${count("PASS")} · HONEST_ZERO ${count("HONEST_ZERO")} · FAIL ${count("FAIL")} (of ${rows.length})`,
  "",
  "| # | Category | Query | Verdict | Rows | Secs | Streamed | Ledger | Reason / note |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.tag} | ${row.category} | ${row.query} | ${row.verdict} | ${row.rows ?? ""} | ${row.secs ?? ""} | ${row.streamed ?? ""} | ${row.ledger ?? ""} | ${[row.why, row.reason, row.sourceHealth, Object.keys(row.rejectReasons ?? {}).length ? `rejects ${JSON.stringify(row.rejectReasons)}` : null].filter(Boolean).join("; ").replace(/\|/g, "/")} |`),
  "",
  "## Samples and understood criteria",
  "",
  ...rows.map((row) => `- ${row.tag}: ${row.criteria ?? ""}${row.sample ? ` → ${row.sample}` : ""}`),
  "",
].join("\n");
writeFileSync("reports/mvp-release-candidate/MATRIX.md", md);
console.log(`PASS ${count("PASS")} HONEST_ZERO ${count("HONEST_ZERO")} FAIL ${count("FAIL")}`);
