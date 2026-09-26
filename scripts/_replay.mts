/**
 * Replay recorded LLM frames through the CURRENT validator.
 *
 * The frames in a report are already post-validation, so a re-run is a no-op
 * wherever the validator has not changed — which makes any difference the
 * footprint of the newest repair, without spending a model call to find it.
 * Temporary.
 */
import { readFileSync } from "node:fs";
import { UnderstandingFrameSchema } from "../src/lib/understanding/frame.js";
import { validateFrame } from "../src/lib/understanding/validate.js";
import { syncClarification } from "../src/lib/understanding/clarify-state.js";

const V = (x: any) => (x && typeof x === "object" && "value" in x ? x.value : (x ?? null));

for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, "utf8");
  const re = /```json\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  let n = 0;
  let moved = 0;
  while ((m = re.exec(text))) {
    let raw: any;
    try {
      raw = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (!raw?.input?.raw) continue;
    const parsed = UnderstandingFrameSchema.safeParse(raw);
    if (!parsed.success) {
      console.log(`  !! unparseable frame: ${raw.input.raw}`);
      continue;
    }
    n++;
    const before = parsed.data;
    const validated = validateFrame(before);
    const after = syncClarification(validated.frame);
    const repairs = validated.repairs;
    const fields = [
      "target.entity_type",
      "target.role",
      "target.category",
      "target.business_type",
      "relation.type",
      "relation.label",
      "relation.object",
      "relation.direction",
      "clarification.needed",
      "clarification.reason",
      "clarification.fields",
      "location.scope",
      "required_fields.*",
      "preferred_fields.*",
    ] as const;
    const read = (f: any, dotted: string) => {
      const [a, b] = dotted.split(".");
      if (b === "*") return JSON.stringify((f[a!] ?? []).map(V));
      return JSON.stringify(V(f[a!]?.[b!]));
    };
    const diffs = fields.filter((f) => read(before, f) !== read(after, f));
    if (!diffs.length) continue;
    moved++;
    const x = (raw.extraction ?? {}) as any;
    console.log(`\n  [${x.extractor ?? "?"} ${x.prompt_version ?? "-"}] ${JSON.stringify(before.input.raw)}`);
    for (const f of diffs) console.log(`    ${f}: ${read(before, f)} -> ${read(after, f)}`);
    for (const r of repairs.filter((x) =>
      /HEAD_NOUN|MOVED_WITH|CUSTOM_RELATION|RECOVERED_FROM_INPUT|SCOPE_FROM_RAW/.test(x.code),
    ))
      console.log(`    repair ${r.code}: ${r.message}`);
  }
  console.log(`\n${path}: ${moved} of ${n} frames changed`);
}
