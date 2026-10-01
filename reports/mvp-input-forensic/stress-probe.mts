// Local, read-only deterministic diagnostic. Seeded case order: 20260928.
import { extractFrameDeterministic } from '../../src/lib/understanding/fallback';
import { validateFrame } from '../../src/lib/understanding/validate';
import { syncClarification } from '../../src/lib/understanding/clarify-state';
import { writeFileSync } from 'node:fs';

const cases = [
  'Find me D2C brands in Dhaka, Bangladesh that are doing marketing, have an online presence, are active, and give me their websites, emails, phones and social accounts. Check when they last posted.',
  'Find local businesses in Camrose Alberta with no website but an active online presence. I need contact information.',
  'Find startup founders in Gdansk that recently raised, are hiring, and have at least $1 million revenue.',
  'Find investors in Southeast Asia actively writing checks into pre-seed AI companies.',
  'Find remote startup jobs using React and TypeScript, hiring globally, paying at least $100,000 per year.',
  'Find startup founders in Gdansk that recently raised, are hiring, and have at least this much revenue.',
  '$100,000 per year',
  'Research D2C brands in Dhaka with an online presence. I am not selling anything; give me their websites and recent posts.',
  'uh yeah find me d two c brands around Dhaka Bangladesh doing marketing and, like, active on insta; need email phone socials and last post',
  'Find local businesses in Camrose Alberta with no website but active Instagram. Give me a phone number.',
  'Find startup founders in Ljubljana who raised this year, are hiring, and have over $2 million revenue.',
  'Find remote React and TypeScript jobs open worldwide paying at least $150,000 a year.',
];

let seed = 20260928;
const order = cases.map((_, i) => i);
for (let i = order.length - 1; i > 0; i--) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const j = seed % (i + 1);
  [order[i], order[j]] = [order[j], order[i]];
}

const rows = [];
for (const i of order) {
  const raw = cases[i];
  try {
  const extracted = extractFrameDeterministic(raw);
  const { frame, violations, repairs } = validateFrame(extracted);
  const final = syncClarification(frame);
  rows.push({
    id: i + 1, raw,
    extracted: { entity: extracted.target.entity_type.value, relation: extracted.relation.type.value,
      location: extracted.location?.value ?? null, constraints: extracted.constraints,
      required: extracted.required_fields.map(x => x.value), preferred: extracted.preferred_fields.map(x => x.value),
      temporal: extracted.temporal, clarification: extracted.clarification },
    final: { entity: final.target.entity_type.value, target: final.target,
      relation: final.relation, location: final.location?.value ?? null,
      constraints: final.constraints, required: final.required_fields.map(x => x.value),
      preferred: final.preferred_fields.map(x => x.value), temporal: final.temporal,
      clarification: final.clarification },
    violations: violations.map(x => x.code), repairs: repairs.map(x => x.code),
  });
  } catch (error) {
    rows.push({ id: i + 1, raw, error: error instanceof Error ? error.message : String(error) });
  }
}
writeFileSync('reports/mvp-input-forensic/stress-results.jsonl', rows.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ seed: 20260928, cases: rows.length, crashes: rows.filter(x => 'error' in x).map(x => x.id), output: 'reports/mvp-input-forensic/stress-results.jsonl' }));
