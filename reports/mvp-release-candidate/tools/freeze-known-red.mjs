// Build KNOWN_RED.json from a raw vitest JSON report (UTF-8 safe).
// usage: node reports/mvp-release-candidate/tools/freeze-known-red.mjs <suite.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [src, dst] = process.argv.slice(2);
const j = JSON.parse(readFileSync(src, "utf8"));
const root = process.cwd().replace(/\\/g, "/") + "/";
const failures = [];
for (const f of j.testResults) {
  const file = f.name.replace(/\\/g, "/").replace(root, "");
  const failed = (f.assertionResults ?? []).filter((a) => a.status === "failed");
  if (f.status === "failed" && failed.length === 0) {
    failures.push({ file, test: "<suite-level failure>", message: String(f.message ?? "").split("\n")[0].slice(0, 200) });
  }
  for (const a of failed) {
    failures.push({ file, test: a.fullName, message: (a.failureMessages ?? []).join(" ").split("\n")[0].slice(0, 200) });
  }
}
writeFileSync(dst, JSON.stringify({
  frozen_at: new Date().toISOString(),
  head: "7805e75e452d925a6d88e3db880622fdb2f35207",
  basis: "active worktree at pass start (baseline B)",
  command: "vitest --run --exclude .kilo/** --maxWorkers=3",
  totals: { total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests, skipped: j.numPendingTests },
  failures,
}, null, 2) + "\n", "utf8");
console.log(`entries=${failures.length}`);
