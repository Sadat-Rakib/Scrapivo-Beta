/** Failing cases with the frame fields that matter. Temporary. */
import { readFileSync } from "node:fs";

const V = (x: any) => (x && typeof x === "object" && "value" in x ? x.value : null);
const R = (x: any) => (x && typeof x === "object" ? (x.raw ?? null) : null);

const rows = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const list: any[] = Array.isArray(rows) ? rows : (rows.cases ?? rows.graded ?? []);

for (const c of list) {
  const checks: any[] = c.checks ?? [];
  const bad = checks.filter((k) => k.ok === false || k.pass === false);
  if (!bad.length) continue;
  const f = c.frame ?? {};
  console.log(`=== ${c.id ?? ""}  ${JSON.stringify(f.input?.raw ?? c.input)}`);
  for (const b of bad) console.log(`  FAIL ${b.axis ?? b.name}: ${b.detail ?? b.message ?? ""}`);
  const t = f.target ?? {};
  for (const k of Object.keys(t)) {
    if (k === "descriptors") continue;
    if (V(t[k]) != null) console.log(`  target.${k.padEnd(15)} ${JSON.stringify(V(t[k]))} raw=${JSON.stringify(R(t[k]))}`);
  }
  console.log(
    `  relation        ${V(f.relation?.type)} / ${V(f.relation?.direction)} / object=${JSON.stringify(V(f.relation?.object))} subject=${JSON.stringify(V(f.relation?.subject))}`,
  );
  console.log(`  mode            ${V(f.prospecting_mode)}   task=${V(f.task_type)}`);
  console.log(`  location        ${JSON.stringify(f.location?.value ?? null)} scope=${f.location?.scope ?? null} raw=${JSON.stringify(f.location?.raw ?? null)}`);
  console.log(`  temporal        ${JSON.stringify(f.temporal ?? null)}`);
  console.log(`  quantity        ${JSON.stringify(f.quantity ?? null)}`);
  console.log(`  constraints     ${JSON.stringify(f.constraints ?? [])}`);
  console.log(`  required        ${JSON.stringify((f.required_fields ?? []).map(V))}`);
  console.log(`  preferred       ${JSON.stringify((f.preferred_fields ?? []).map(V))}`);
  console.log(`  verification    ${JSON.stringify(f.verification ?? null)}`);
  console.log(`  subgoals        ${JSON.stringify((f.subgoals ?? []).map((s: any) => s.raw ?? s))}`);
  console.log(`  clarification   ${JSON.stringify(f.clarification ?? null)}`);
  for (const r of f.repairs ?? c.repairs ?? []) console.log(`  repair ${r.code}  ${r.message}`);
  console.log("");
}
