/** The two holdout failures, read deterministically. Temporary. */
import { extractFrameDeterministic } from "../src/lib/understanding/fallback.js";
import { validateFrame } from "../src/lib/understanding/validate.js";

const V = (x: any) => (x && typeof x === "object" && "value" in x ? x.value : null);

for (const input of ["wind turbine technicians in Ann Arbor hiring orthodontists", "waste haulage"]) {
  const { frame, repairs } = validateFrame(extractFrameDeterministic(input));
  const t = frame.target as any;
  console.log(`=== ${input}`);
  console.log(`  entity_type   ${V(t.entity_type)}  ambiguous=${t.entity_ambiguous ?? null}`);
  for (const k of ["role", "job_title", "category", "business_type", "industry", "niche"])
    if (V(t[k]) != null) console.log(`  ${k.padEnd(13)} ${JSON.stringify(V(t[k]))}`);
  console.log(`  relation      ${V(frame.relation.type)} object=${JSON.stringify(V(frame.relation.object))}`);
  console.log(`  clarification needed=${frame.clarification.needed} ${JSON.stringify(frame.clarification.questions?.map((q: any) => q.question ?? q) ?? [])}`);
  for (const r of repairs) console.log(`  repair ${r.code}`);
  console.log("");
}
