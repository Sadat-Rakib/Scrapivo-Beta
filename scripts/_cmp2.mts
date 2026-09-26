/**
 * Same-seed frame diff between two grader reports. Temporary — used to check
 * that a prompt change moved only what it was meant to move.
 *
 *   npx tsx scripts/_cmp2.mts <before.md> <after.md>
 */
import { readFileSync } from "node:fs";

type Frame = Record<string, any>;

/** Keyed on the frame's own `input.raw`, so the two runs pair by the sentence. */
function framesOf(path: string): Map<string, Frame> {
  const text = readFileSync(path, "utf8");
  const out = new Map<string, Frame>();
  const re = /```json\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let f: Frame;
    try {
      f = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const key = f.input?.raw;
    if (typeof key === "string") out.set(key, f);
  }
  return out;
}

const v = (x: any) => (x && typeof x === "object" && "value" in x ? (x.value ?? null) : (x ?? null));

/** The semantic core: what the user meant, minus confidence and provenance. */
function core(f: Frame) {
  const t = f.target ?? {};
  const r = f.relation ?? {};
  return {
    task: v(f.task_type),
    mode: v(f.prospecting_mode),
    entity: v(t.entity_type),
    ambiguous: t.entity_ambiguous ?? null,
    role: v(t.role),
    job_title: v(t.job_title),
    category: v(t.category),
    industry: v(t.industry),
    business_type: v(t.business_type),
    niche: v(t.niche),
    stage: v(t.company_stage),
    relation: v(r.type),
    direction: v(r.direction),
    object: v(r.object),
    label: r.label ?? null,
    location: f.location ? `${f.location.value}/${f.location.scope}/${f.location.radius ?? "-"}` : null,
    temporal: f.temporal
      ? `${f.temporal.relation}/${f.temporal.window ?? "-"}/${f.temporal.year ?? "-"}`
      : null,
    quantity: f.quantity
      ? `req=${f.quantity.requested ?? "-"} min=${f.quantity.minimum ?? "-"} max=${f.quantity.maximum ?? "-"} unl=${f.quantity.unlimited ?? "-"}`
      : null,
    constraints: (f.constraints ?? [])
      .map((c: any) => `${c.field}${c.negated ? "!" : ""}${c.operator}${JSON.stringify(c.value)}`)
      .sort(),
    required: (f.required_fields ?? []).map(v).sort(),
    preferred: (f.preferred_fields ?? []).map(v).sort(),
    contact: (f.contact_requirements ?? []).map(v).sort(),
    verification: (f.verification ?? []).map((x: any) => x.kind).sort(),
    output: (f.output ?? []).map((x: any) => x.kind).sort(),
    subgoals: f.compound?.is_compound ? (f.compound.subgoals ?? []).length : 0,
    clarify: f.clarification?.needed ? (f.clarification.reason ?? "yes") : false,
    selling: v(f.user_context?.selling?.service) ?? v(f.user_context?.selling?.product),
  };
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("need <before.md> <after.md>");

const before = framesOf(beforePath);
const after = framesOf(afterPath);
console.log(`before ${before.size} frames · after ${after.size} frames\n`);

let changed = 0;
for (const [prompt, b] of before) {
  const a = after.get(prompt);
  if (!a) {
    console.log(`MISSING IN AFTER: ${prompt}`);
    continue;
  }
  const cb = core(b) as Record<string, any>;
  const ca = core(a) as Record<string, any>;
  const diffs = Object.keys(cb).filter(
    (k) => JSON.stringify(cb[k]) !== JSON.stringify(ca[k]),
  );
  if (!diffs.length) continue;
  changed++;
  console.log(`~ ${prompt}`);
  for (const k of diffs) {
    console.log(`    ${k}: ${JSON.stringify(cb[k])}  ->  ${JSON.stringify(ca[k])}`);
    // An added descriptor is only safe if the sentence contains it. Printed so
    // the reader can see a hallucination rather than infer one.
    const added = ca[k];
    if (typeof added === "string" && !cb[k]) {
      const inInput = prompt.toLowerCase().includes(added.toLowerCase().split(/\s+/)[0]!);
      console.log(`      ${inInput ? "IN INPUT" : "NOT IN INPUT — check"}`);
    }
  }
  console.log("");
}
console.log(changed === 0 ? "IDENTICAL semantic cores." : `${changed}/${before.size} frames differ.`);
