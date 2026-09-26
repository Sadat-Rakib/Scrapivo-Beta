/** Compact grading sheet over a Gate 1 report's frames. Temporary. */
import { readFileSync } from "node:fs";

const path = process.argv[2]!;
const text = readFileSync(path, "utf8");

const v = (o: any) => (o == null ? null : typeof o === "object" ? (o.value ?? o.raw ?? null) : o);
const open = (o: any) => (o == null ? "-" : `${v(o)}`);

const blocks = text.split(/\n#### /).slice(1);

for (const b of blocks) {
  const id = /^`?([a-z]\d+)`?/.exec(b)?.[1] ?? /`([a-z]\d+)`/.exec(b)?.[1] ?? "?";
  const json = /```json\n([\s\S]*?)\n```/.exec(b);
  if (!json) continue;
  const f = JSON.parse(json[1]!);

  const t = f.target ?? {};
  const r = f.relation ?? {};
  const cl = f.clarification ?? {};

  console.log(`\n── ${id}  ${JSON.stringify(f.input?.raw ?? "")}`);
  console.log(`   task=${v(f.task_type)}  mode=${v(f.prospecting_mode)}  compound=${f.compound?.is_compound ?? false}`);
  console.log(
    `   target: type=${open(t.entity_type)} role=${open(t.role)} cat=${open(t.category)} ind=${open(t.industry)} stage=${open(t.company_stage)} amb=${t.entity_ambiguous ?? false}`,
  );
  console.log(
    `   relation: ${open(r.type)}${r.label ? ` "${r.label}"` : ""} obj=${open(r.object)} dir=${v(r.direction)} subj=${open(r.subject)}`,
  );
  const loc = f.location;
  console.log(
    `   loc: ${loc ? `${open(loc)} scope=${loc.scope ?? "-"} radius=${loc.radius ?? "-"}${loc.radius_unit ?? ""} raw="${loc.raw ?? ""}"` : "-"}`,
  );
  const q = f.quantity;
  const tm = f.temporal;
  console.log(
    `   qty: ${q ? `req=${q.requested ?? "-"} min=${q.minimum ?? "-"} max=${q.maximum ?? "-"} unl=${q.unlimited} approx=${q.approximate}` : "-"}  temporal: ${tm ? `${tm.relation ?? "-"} window=${tm.window ?? "-"} year=${tm.year ?? "-"} raw="${tm.raw ?? ""}"` : "-"}`,
  );
  if (f.constraints?.length)
    console.log(
      `   constraints: ${f.constraints.map((c: any) => `${c.field} ${c.operator}${c.negated ? "(neg)" : ""} ${c.value ?? ""}${c.unit ?? ""}`.trim()).join(" | ")}`,
    );
  const req = (f.output?.required_fields ?? f.required_fields ?? []).map((x: any) => v(x));
  const pref = (f.output?.preferred_fields ?? f.preferred_fields ?? []).map((x: any) => v(x));
  if (req.length || pref.length) console.log(`   fields: req=[${req}] pref=[${pref}]`);
  if (f.verification?.length)
    console.log(`   verify: ${f.verification.map((x: any) => `${x.kind}${x.label ? `(${x.label})` : ""} <- "${x.raw ?? ""}"`).join(" | ")}`);
  if (f.evidence?.length) console.log(`   evidence: ${f.evidence.map((e: any) => v(e.kind ?? e)).join(" | ")}`);
  if (f.contact_requirements?.length) console.log(`   contacts: ${JSON.stringify(f.contact_requirements)}`);
  if (f.user_context && Object.values(f.user_context).some((x) => x != null && (!Array.isArray(x) || x.length)))
    console.log(`   user_context: ${JSON.stringify(f.user_context)}`);
  const subs = f.compound?.subgoals ?? f.subgoals ?? [];
  if (subs.length)
    // A subgoal's `raw` is optional and often absent, so fall back to what it
    // actually asks for — an empty entry read as a lost goal once.
    console.log(
      `   subgoals(${subs.length}): ${subs
        .map((s: any) => {
          if (s.raw) return s.raw;
          const what = open(s.target?.category ?? s.target?.role ?? s.target?.industry ?? s.target?.entity_type);
          const rel = v(s.relation?.type);
          const where = s.location ? open(s.location) : null;
          return [what, rel && rel !== "none" ? `${rel}:${open(s.relation?.object)}` : null, where ? `@${where}` : null]
            .filter(Boolean)
            .join(" ");
        })
        .join(" || ")}`,
    );
  const out = f.output;
  if (Array.isArray(out) ? out.length : out && Object.keys(out).length)
    console.log(
      `   output: ${Array.isArray(out) ? out.map((o: any) => `${o.kind ?? v(o)}${o.label ? `(${o.label})` : ""}`).join(" | ") : JSON.stringify(out)}`,
    );
  console.log(
    `   clarify: ${cl.needed ? `NEEDED [${(cl.questions ?? []).map((x: any) => x.field ?? x.id ?? x).join(",")}]` : "no"}  repairs=${(f.trace?.repairs ?? []).map((x: any) => x.code ?? x).join(",") || "-"}`,
  );
}
