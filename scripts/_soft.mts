/** Required vs preferred on soft wording. Temporary. */
import { readFileSync } from "node:fs";
import { extractFrameDeterministic } from "../src/lib/understanding/fallback.js";
import { validateFrame } from "../src/lib/understanding/validate.js";

const NEEDLE = "would b great";

for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, "utf8");
  const re = /```json\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let f: any;
    try {
      f = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (!(f.input?.raw ?? "").includes(NEEDLE)) continue;
    console.log(`--- ${path}  (${f.extraction?.prompt_version})`);
    console.log(`  required : ${JSON.stringify(f.required_fields)}`);
    console.log(`  preferred: ${JSON.stringify(f.preferred_fields)}`);
  }
}

const input =
  "ok so i do penetration testing n im tryna find like saunas around leipzig that dont got a site, phone would b great, thx";
const { frame } = validateFrame(extractFrameDeterministic(input));
console.log(`--- deterministic`);
console.log(`  required : ${JSON.stringify(frame.required_fields)}`);
console.log(`  preferred: ${JSON.stringify(frame.preferred_fields)}`);
