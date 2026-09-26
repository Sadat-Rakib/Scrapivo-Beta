/** What a bare vertical word produces, LLM and deterministic. Temporary. */
import { readFileSync } from "node:fs";
import { extractFrameDeterministic } from "../src/lib/understanding/fallback.js";
import { validateFrame } from "../src/lib/understanding/validate.js";

const WANTED = new Set(["circular economy", "proptech", "waste haulage", "pharmacovigilance"]);

const report = process.argv[2];
if (report) {
  const text = readFileSync(report, "utf8");
  const re = /```json\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text))) {
    let f: any;
    try {
      f = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const raw = f.input?.raw;
    if (!raw || seen.has(raw) || !WANTED.has(raw)) continue;
    seen.add(raw);
    console.log(`LLM  ${JSON.stringify(raw)}`);
    console.log(`  entity_type  ${JSON.stringify(f.target.entity_type)}`);
    console.log(`  industry     ${JSON.stringify(f.target.industry?.value ?? null)}`);
    console.log(`  category     ${JSON.stringify(f.target.category?.value ?? null)}`);
    console.log(`  location     ${JSON.stringify(f.location?.value ?? null)}`);
    console.log(`  clarification ${JSON.stringify(f.clarification)}`);
  }
}

for (const q of ["circular economy", "proptech", "waste haulage", "cafes in Porto", "biochar startups"]) {
  const { frame } = validateFrame(extractFrameDeterministic(q));
  const t = frame.target as any;
  console.log(`\nDET  ${JSON.stringify(q)}`);
  console.log(`  entity_type  ${JSON.stringify(t.entity_type)}`);
  console.log(`  industry     ${JSON.stringify(t.industry?.value ?? null)} category ${JSON.stringify(t.category?.value ?? null)}`);
  console.log(`  clarification ${JSON.stringify(frame.clarification)}`);
}
