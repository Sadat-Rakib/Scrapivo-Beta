import { readFileSync } from "node:fs";

const [path, needle] = process.argv.slice(2);
const text = readFileSync(path!, "utf8");
const re = /```json\n([\s\S]*?)\n```/g;
let m: RegExpExecArray | null;
while ((m = re.exec(text))) {
  let j: any;
  try {
    j = JSON.parse(m[1]!);
  } catch {
    continue;
  }
  if (j?.input?.raw !== needle) continue;
  console.log(
    JSON.stringify(
      { clarification: j.clarification, extraction: j.extraction, target: j.target, relation: j.relation },
      null,
      2,
    ),
  );
  break;
}
