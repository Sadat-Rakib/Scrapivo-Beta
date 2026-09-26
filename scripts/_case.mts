/** Print the frame sections that matter for a failing case id. Temporary. */
import { readFileSync } from "node:fs";

const [path, ...ids] = process.argv.slice(2);
const text = readFileSync(path!, "utf8");

for (const id of ids) {
  const at = text.indexOf("`" + id + "`");
  if (at < 0) {
    console.log(`${id}: not in report`);
    continue;
  }
  const block = text.slice(at, at + 9000);
  const json = /```json\n([\s\S]*?)\n```/.exec(block);
  const checks = /Failed checks:\n+([\s\S]*?)\n\n/.exec(block);
  if (!json) {
    console.log(`${id}: no frame`);
    continue;
  }
  const f = JSON.parse(json[1]!);
  console.log(`\n=== ${id}: ${JSON.stringify(f.input.raw)}`);
  if (checks) console.log(checks[1]!.trim());
  console.log(`task=${f.task?.value ?? f.task}  mode=${f.prospecting_mode?.value ?? f.prospecting_mode}`);
  console.log("target " + JSON.stringify(f.target));
  console.log("relation " + JSON.stringify(f.relation));
  console.log("location " + JSON.stringify(f.location));
  console.log("quantity " + JSON.stringify(f.quantity));
  console.log("constraints " + JSON.stringify(f.constraints));
  console.log("clarification " + JSON.stringify(f.clarification));
  console.log("compound " + JSON.stringify(f.compound));
  console.log("output " + JSON.stringify(f.output));
  console.log("fields req=" + JSON.stringify(f.required_fields) + " pref=" + JSON.stringify(f.preferred_fields));
  console.log("temporal " + JSON.stringify(f.temporal));
  console.log("user_context " + JSON.stringify(f.user_context));
}
