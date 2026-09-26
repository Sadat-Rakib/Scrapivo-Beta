/** The bell-foundry target fields, before and after. Temporary. */
import { readFileSync } from "node:fs";

for (const p of process.argv.slice(2)) {
  const text = readFileSync(p, "utf8");
  const re = /```json\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let f: any;
    try {
      f = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (!String(f.input?.raw ?? "").startsWith("bell foundries")) continue;
    console.log(`\n${p.slice(-24)}`);
    for (const k of ["entity_type", "category", "business_type", "industry", "niche", "descriptors"])
      console.log(`  ${k.padEnd(14)} ${JSON.stringify(f.target[k])}`);
    break;
  }
}
