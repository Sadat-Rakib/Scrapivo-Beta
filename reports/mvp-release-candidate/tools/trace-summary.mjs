// Compact summary of one BROWSER_TRACE json (searches, pages, candidates, result).
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const cut = (v, n) => String(v ?? "").slice(0, n);
console.log(`QUERY ${j.query} | ${Math.round(j.durationMs / 1000)}s | error=${j.error}`);
for (const s of j.searches) console.log(`  S ${s.via} ${s.status} ${s.results} ${cut(JSON.stringify(s.query), 70)} ${cut(s.reason, 50)}`);
for (const p of j.pages) console.log(`  P ${p.origin} ${p.outcome} ${p.textChars} ${cut(p.url, 80)} | ${p.candidateProduced} ${cut(p.produced.join(","), 70)} | ${cut(p.why, 90)}`);
for (const c of j.candidates) console.log(`  C ${cut(c.name, 40)} ${c.status} ${c.rejectCode ?? "-"} needs=${c.needs.join("+")} visited=${c.visited} q=${c.queries} ${cut(c.label, 80)}`);
const r = j.result ?? {};
const t = r.retrievalTrace ?? {};
console.log(`RESULT outcome=${r.outcome} status=${r.status} rows=${r.rowsReturned} raw=${t.rawCandidates} post=${t.postSpecFilter} complete=${t.complete} qualified=${t.qualified} reason=${t.reason} streamed=${j.streamedRows.length} clarify=${(r.clarify ?? []).join(",")}`);
for (const row of r.rows ?? []) console.log(`  ROW ${cut(row.title, 40)} | ${row.kind} | ${cut(row.role, 20)} @ ${cut(row.company, 25)} | ${cut(row.location, 20)} | site=${cut(row.website_url, 40)} | src=${cut(row.source_url, 60)}`);
