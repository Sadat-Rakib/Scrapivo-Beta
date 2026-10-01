// QA-only: compare a tsc --noEmit log with the frozen baseline (file|TS-code groups).
//   node reports/full-e2e-validation/tools/tsc-compare.mjs <log>
import { readFileSync } from "node:fs";

const read = (path) => {
  const bytes = readFileSync(path);
  return bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString("utf16le") : bytes.toString("utf8");
};
const parse = (text) => {
  const groups = {};
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+)/);
    if (!m) continue;
    total++;
    const key = `${m[1]}|${m[2]}`;
    groups[key] = (groups[key] ?? 0) + 1;
  }
  return { groups, total };
};
const current = parse(read(process.argv[2]));
const baseline = parse(read("reports/mvp-implementation/TYPECHECK_LOG.txt"));
const over = Object.entries(current.groups).filter(([key, count]) => count > (baseline.groups[key] ?? 0));
console.log(JSON.stringify({ errors: current.total, baseline: baseline.total, groupsAboveBaseline: over }));
