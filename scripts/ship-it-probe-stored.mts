import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync('reports/v1-runtime-fix/browser-probe.json', 'utf8'));
for (const row of report.rows ?? []) console.log(JSON.stringify({ name: row.title, kind: row.kind, role: row.role, industry: row.industry, company: row.company, location: row.location, url: row.url, evidence: row.evidence?.map((e: any) => ({ type: e.evidence_type, parameters: e.claim_parameters })) }));
const observations = JSON.parse(readFileSync('reports/v1-runtime-fix/browser-observations.json', 'utf8'));
for (const page of observations.pages ?? []) console.log(JSON.stringify({ page: page.url, title: page.title, lead: page.text?.slice(0, 180) }));
for (const page of observations.pages ?? []) { const i = page.text?.indexOf('Andrew Breen') ?? -1; if (i >= 0) console.log(JSON.stringify({ aroundAndrew: page.text.slice(Math.max(0,i-80),i+210) })); }
for (const entity of observations.entities ?? []) console.log(JSON.stringify({ name: entity.name, quote: entity.identityQuote, fields: entity.fields }));
const { browserEntitiesToRows } = await import('../src/lib/search/browser-live.server');
const { buildSpec, stated } = await import('../src/lib/search/search-spec');
const { qualifyLead } = await import('../src/lib/search/qualify');
const { rowSatisfiesSpec } = await import('../src/lib/spec-search.functions');
const spec = buildSpec({ entity: 'person', raw_query: 'SaaS founders', criteria: [stated('role','founder'), stated('industry','SaaS')] });
for (const row of browserEntitiesToRows(observations.entities, observations.pages)) console.log(JSON.stringify({ converted: row.title, role: row.role, industry: row.industry, company: row.company, matches: rowSatisfiesSpec(spec,row), decision: qualifyLead(row,spec,row.evidence) }));
