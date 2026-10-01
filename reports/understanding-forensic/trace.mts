/** Read-only diagnostic. Run with: npx tsx reports/understanding-forensic/trace.mts */
import '../../scripts/_env.mts';
import { extractFrameDeterministic } from '../../src/lib/understanding/fallback';
import { validateFrame } from '../../src/lib/understanding/validate';
import { syncClarification, initState, nextQuestion, patchFrame } from '../../src/lib/understanding/clarify-state';
import { frameToSearchSpec, isActionableFrame } from '../../src/lib/understanding/to-search-spec';
import { extractSearchSpec } from '../../src/lib/search/search-spec-extract';
import { evaluateQueryReadiness } from '../../src/lib/search/query-readiness';
import { detectModeFromQuery, isDirectoryEntity } from '../../src/lib/search/mode-gate';
import { extractFrameLLM } from '../../src/lib/understanding/extract.server';
import { writeFileSync } from 'node:fs';
import { presentActivityEvent } from '../../src/lib/search/activity-presenter';

const cases = [
  'Find me D2C brands in Dhaka, Bangladesh that are doing marketing, have an online presence, are active, and give me their websites, phone numbers, emails and socials. Check when they last posted.',
  'find plumbers in Austin',
  'find plumbers in Austin that need website services',
  'find local businesses in Alberta without websites',
  'find investors',
  'remote react jobs paying this much',
  'find businesses that need websites',
  'Alberta',
];

function brief(query: string, input: ReturnType<typeof extractFrameDeterministic>, source: string) {
  const validated = validateFrame(input);
  const frame = syncClarification(validated.frame);
  const legacy = extractSearchSpec(query);
  const spec = frameToSearchSpec(frame);
  const readiness = evaluateQueryReadiness({ spec, query, force: false });
  const mode = detectModeFromQuery(query);
  const modeGate = !isActionableFrame(spec) && isDirectoryEntity(spec.entity) && spec.status === 'ready_to_search' && !mode && !spec.criteria.some(c => c.field === 'mode');
  return {
    query, source, extractor: frame.meta.extractor, provider: frame.meta.provider,
    fallback: frame.meta.fallback_used, validation_repairs: validated.repairs,
    frame: {
      task: frame.task_type.value, mode: frame.prospecting_mode.value,
      entity: frame.target.entity_type.value, category: frame.target.category?.value,
      industry: frame.target.industry?.value, business_type: frame.target.business_type?.value,
      role: frame.target.role?.value, location: frame.location?.value,
      country: frame.location?.country_code, relation: frame.relation.type.value,
      relation_object: frame.relation.object?.value, constraints: frame.constraints,
      evidence: frame.evidence, required_fields: frame.required_fields.map(f => f.value),
      contact_requirements: frame.contact_requirements.map(f => f.value),
      verification: frame.verification, enrichment: frame.enrichment_requirements.map(f => f.value),
      clarification: frame.clarification,
    },
    legacy: { entity: legacy.entity, criteria: legacy.criteria, signal_required: legacy.signal_required },
    spec: { entity: spec.entity, criteria: spec.criteria, missing: spec.missing, status: spec.status, signal_required: spec.signal_required, signal_types: spec.signal_types },
    readiness, mode, modeGate,
  };
}

const rows: unknown[] = [];
for (const query of cases) rows.push(brief(query, extractFrameDeterministic(query), 'deterministic'));
const first = extractFrameDeterministic('find businesses that need websites');
const state = initState(syncClarification(validateFrame(first).frame));
const question = nextQuestion(state);
if (question) {
  const answer = patchFrame(state, question.field, 'Alberta');
  rows.push({ followup: { first: state.frame.input.raw, question, answer: 'Alberta', patched_location: answer.state.frame.location?.value, patched_raw: answer.state.frame.input.raw, note: answer.note } });
}
if (process.argv.includes('--llm')) {
  const query = cases[0]!;
  const result = await extractFrameLLM(query, { bypassCache: true, waitForSlotMs: 250 });
  rows.push(brief(query, result.frame, 'llm-or-fallback'));
}
rows.push({ privacyProbes: [
  { action: 'Checking OSM', detail: 'OpenStreetMap' },
  { action: 'Checking Geoapify', detail: 'Foursquare' },
  { action: 'Scanning S3', detail: 'DuckDB' },
  { action: 'Stored search complete', source: 's3-parquet' },
].map(event => ({ input: event, output: presentActivityEvent(event) })) });
writeFileSync(new URL('./TRACE.jsonl', import.meta.url), rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${rows.length} trace rows; LLM=${process.argv.includes('--llm') ? 'attempted' : 'skipped'}`);
