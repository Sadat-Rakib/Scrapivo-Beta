import { extractFrameDeterministic } from "../src/lib/understanding/fallback";
import { validateFrame } from "../src/lib/understanding/validate";
for (const q of ["seed investors for AI startups in Canada", "angel investors in fintech in London", "series A VCs investing in climate tech in Germany"]) {
  const f = validateFrame(extractFrameDeterministic(q)).frame;
  const pick = (v: any) => v ? { value: v.value, raw: v.raw } : null;
  console.log(JSON.stringify({ q, entity: f.target.entity_type?.value, category: pick(f.target.category), industry: pick(f.target.industry), business_type: pick(f.target.business_type), company_stage: pick(f.target.company_stage), role: pick(f.target.role), relation: { type: f.relation.type?.value, object: pick(f.relation.object) }, constraints: f.constraints.map((c: any) => `${c.field}=${c.value}`), notes: f.meta.notes.slice(0, 4) }));
}
