/**
 * Data-asset acceptance runner — deterministic, OFFLINE.
 *
 * Runs the focused vitest suites for the data-asset pass via child_process
 * (vitest suites are offline — no network, no Supabase), reports pass/fail per
 * suite, prints the BENCHMARK TABLE for reports/research-asset/FINAL_STATUS.md,
 * and exits nonzero if any suite fails.
 *
 * Usage: npx tsx scripts/acceptance-data-asset.mts [WorkstreamFilter ...]
 * (filters are case-insensitive prefixes of the workstream names below)
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Suite = { workstream: string; paths: string[]; invariant: string };

const SUITES: Suite[] = [
  {
    workstream: "jobs",
    paths: ["src/lib/jobs/__tests__"],
    invariant: "lease pinning + atomic reclaim + unique upsert collapse + completion reasons (incl. frozen whole-sequence acceptance)",
  },
  {
    workstream: "watch",
    paths: ["src/lib/watch/__tests__"],
    invariant: "watch jobs ride the engine; idempotent schedule slots; signal-aware fingerprint diff",
  },
  {
    workstream: "notifications",
    paths: ["src/lib/notifications/__tests__"],
    invariant: "one intent per idempotency key; delivery_unknown never retried; failed retries capped",
  },
  {
    workstream: "signals",
    paths: ["src/lib/signals/__tests__"],
    invariant: "deterministic signal relevance + deep-pass",
  },
  {
    workstream: "projects",
    paths: ["src/lib/projects/__tests__"],
    invariant: "context layering + version bumps; list items dedupe on (list_id, entity_id)",
  },
  {
    workstream: "canonical",
    paths: ["src/lib/canonical/__tests__"],
    invariant: "fact projection + freshness TTLs + reuse/read budgets",
  },
  {
    workstream: "spec-search",
    paths: ["src/lib/__tests__/spec-search.test.ts", "src/lib/__tests__/spec-candidates.test.ts"],
    invariant: "intent routing / clarify classes / candidate shaping",
  },
  {
    workstream: "research-agent",
    paths: ["src/lib/research-agent/acquisition-policy.test.ts", "src/lib/research-agent/candidate-acquisition.test.ts"],
    invariant: "acquisition policy gates",
  },
  {
    workstream: "absence-verification",
    paths: ["src/lib/search/__tests__/absence-verification.test.ts"],
    invariant: "honest absence labeling",
  },
];

function countTestFiles(p: string): number {
  const abs = path.join(ROOT, p);
  let st: import("node:fs").Stats;
  try {
    st = statSync(abs);
  } catch {
    return 0;
  }
  if (st.isFile()) return 1;
  return readdirSync(abs).filter((f) => /\.(test|spec)\.(ts|tsx|mts|js|mjs)$/.test(f)).length;
}

type Result = Suite & { ok: boolean; tests: number; filesRun: number; seconds: number; tail: string };

function runSuite(suite: Suite): Result {
  const args = ["vitest", "--run", ...suite.paths];
  const started = Date.now();
  const res = spawnSync("npx", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "1" },
  });
  const seconds = (Date.now() - started) / 1000;
  // Strip ANSI color codes — vitest wraps the summary numbers in them.
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  // vitest summary lines: "Tests  12 passed (12)" / "Tests  3 failed | 9 passed (12)"
  const testsLine = out.split("\n").find((l) => /^\s*Tests\s/.test(l)) ?? "";
  const passed = /(\d+)\s+passed/.exec(testsLine)?.[1];
  const failed = /(\d+)\s+failed/.exec(testsLine)?.[1];
  const filesLine = out.split("\n").find((l) => /^\s*Test Files\s/.test(l)) ?? "";
  const filesRun = /(\d+)\s+passed/.exec(filesLine)?.[1];
  const noTests = /No test files found/i.test(out);
  const ok = res.status === 0 && !noTests && !failed;
  const tail = out
    .split("\n")
    .filter((l) => /FAIL|✗|×|Error:/.test(l))
    .slice(0, 6)
    .join("\n");
  return {
    ...suite,
    ok,
    tests: ok ? Number(passed ?? 0) : Number(passed ?? 0) + Number(failed ?? 0),
    filesRun: Number(filesRun ?? 0),
    seconds,
    tail,
  };
}

const filter = process.argv.slice(2).map((a) => a.toLowerCase());
const suites = SUITES.filter((s) => !filter.length || filter.some((f) => s.workstream.toLowerCase().startsWith(f)));

console.log(`data-asset acceptance — ${suites.length} focused suites (offline)\n`);
const results: Result[] = [];
for (const suite of suites) {
  process.stdout.write(`  running ${suite.workstream} ... `);
  const r = runSuite(suite);
  results.push(r);
  console.log(`${r.ok ? "PASS" : "FAIL"} (${r.tests} tests, ${r.seconds.toFixed(1)}s)`);
  if (!r.ok && r.tail) console.log(`    ${r.tail.split("\n").join("\n    ")}`);
}

const totalTests = results.reduce((n, r) => n + r.tests, 0);
const totalFiles = results.reduce((n, r) => n + (r.filesRun || countTestFilesFromPaths(r.paths)), 0);
const allOk = results.every((r) => r.ok);

console.log(`
BENCHMARK TABLE — data-asset pass (paste into reports/research-asset/FINAL_STATUS.md)
`);
const nameW = Math.max(...results.map((r) => r.workstream.length), "workstream".length);
const filesW = Math.max(...results.map((r) => String(r.filesRun || countTestFilesFromPaths(r.paths)).length), "files".length);
const testsW = Math.max(...results.map((r) => String(r.tests).length), "tests".length);
const sep = "-".repeat(nameW + 2) + "+" + "-".repeat(filesW + 2) + "+" + "-".repeat(testsW + 2) + "+" + "--------------------------------------------------------------";
console.log(`${"workstream".padEnd(nameW)} | ${"files".padStart(filesW)} | ${"tests".padStart(testsW)} | key invariant`);
console.log(sep);
for (const r of results) {
  const files = String(r.filesRun || countTestFilesFromPaths(r.paths)).padStart(filesW);
  console.log(`${r.workstream.padEnd(nameW)} | ${files} | ${String(r.tests).padStart(testsW)} | ${r.ok ? r.invariant : `FAIL — ${r.invariant}`}`);
}
console.log(sep);
console.log(`${"TOTAL".padEnd(nameW)} | ${String(totalFiles).padStart(filesW)} | ${String(totalTests).padStart(testsW)} | ${allOk ? "all green" : "FAILURES PRESENT"}`);

function countTestFilesFromPaths(paths: string[]): number {
  return paths.reduce((n, p) => n + countTestFiles(p), 0);
}

process.exit(allOk ? 0 : 1);
