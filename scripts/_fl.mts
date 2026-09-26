/** Which cases failed, and on which check, per report. Temporary. */
import { readFileSync } from "node:fs";

for (const p of process.argv.slice(2)) {
  const t = readFileSync(p, "utf8");
  const ids = [...t.matchAll(/#### FAIL[^\n]*?`(\w+)`/g)].map((m) => m[1]!);
  const checks = [...t.matchAll(/Failed checks:\n+([^\n]+)/g)].map((m) => m[1]!.trim());
  console.log(`${p.split("-seed")[1]}  fails=[${[...new Set(ids)].join(",")}]`);
  for (const c of [...new Set(checks)]) console.log(`    ${c}`);
}
