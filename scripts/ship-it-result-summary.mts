import { readFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) throw new Error('Pass a real result.json path.');
const result = JSON.parse(readFileSync(path, 'utf8'));
console.log(JSON.stringify({ outcome: result.outcome, entity: result.spec?.entity, count: result.rows?.length, rows: result.rows?.slice(0, 10).map((r: any) => ({ name: r.title, role: r.role, company: r.company, location: r.location, email: r.email, phone: r.phone, url: r.url, why: r.why_match, evidence: r.evidence?.length })) }, null, 2));
