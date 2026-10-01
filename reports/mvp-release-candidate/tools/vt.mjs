// Targeted vitest runner for the MVP sprint.
// usage: node reports/mvp-release-candidate/tools/vt.mjs [vitest filters/files...]
// Prints totals and only failures that are NOT in the frozen KNOWN_RED set.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Outside OneDrive: sync locks on fresh files made cleanup fail with EPERM.
const dir = `${tmpdir()}/scrapivo-vt`;
mkdirSync(dir, { recursive: true });
const out = `${dir}/vt-${process.pid}.json`;
const args = [
  "node_modules/vitest/vitest.mjs", "--run", "--exclude", ".kilo/**",
  "--reporter=json", `--outputFile=${out}`, ...process.argv.slice(2),
];
const run = spawnSync(process.execPath, args, {
  encoding: "utf8",
  stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=3072" },
});
if (!existsSync(out)) {
  console.log("VITEST_NO_OUTPUT exit=" + run.status);
  console.log((run.stderr ?? "").split("\n").filter((l) => /error|Error/.test(l)).slice(0, 15).join("\n"));
  process.exit(2);
}
const j = JSON.parse(readFileSync(out, "utf8"));
try { rmSync(out, { force: true }); } catch { /* best effort */ }
const red = JSON.parse(readFileSync("reports/mvp-release-candidate/KNOWN_RED.json", "utf8"));
const known = new Set(red.failures.map((f) => `${f.file}::${f.test}`));
const root = process.cwd().replace(/\\/g, "/") + "/";
const fails = [];
for (const f of j.testResults) {
  const file = f.name.replace(/\\/g, "/").replace(root, "");
  const failed = (f.assertionResults ?? []).filter((a) => a.status === "failed");
  if (f.status === "failed" && failed.length === 0) {
    // First non-empty lines (a suite error can start with a newline).
    fails.push({ file, test: "<suite-level failure>", msg: String(f.message ?? "").split("\n").filter((line) => line.trim()).slice(0, 3).join(" | ").slice(0, 400) });
  }
  for (const a of failed) {
    fails.push({ file, test: a.fullName, msg: (a.failureMessages ?? []).join(" ").split("\n")[0].slice(0, 260) });
  }
}
const fresh = fails.filter((f) => !known.has(`${f.file}::${f.test}`));
console.log(
  `total=${j.numTotalTests} passed=${j.numPassedTests} failed=${j.numFailedTests} skipped=${j.numPendingTests} ` +
    `files=${j.testResults.length} knownRedHit=${fails.length - fresh.length} NEW_FAILURES=${fresh.length}`,
);
for (const f of fresh) console.log(`NEW ${f.file} :: ${f.test}\n    ${f.msg}`);
if (process.env.VT_SHOW_KNOWN) {
  for (const f of fails.filter((x) => known.has(`${x.file}::${x.test}`))) console.log(`KNOWN ${f.file} :: ${f.test}`);
}
process.exit(fresh.length ? 1 : 0);
