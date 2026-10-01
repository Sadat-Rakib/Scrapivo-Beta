// QA-only: decode a captured spec-search server response (seroval JSON) and print
// the delivered rows' identity, contact and evidence fields.
//   node reports/full-e2e-validation/tools/decode-rows.mjs <run.response.txt>
import { readFileSync } from "node:fs";

const refs = new Map();
function decode(node) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(decode);
  let value;
  switch (node.t) {
    case 0: value = Number(node.s); break;
    case 1: value = typeof node.s === "string" ? node.s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) : node.s; break;
    case 2: value = [undefined, null, true, false, undefined][node.s] ?? null; break;
    case 4: value = refs.get(node.i); break;
    case 9: value = (node.a ?? []).map(decode); break;
    case 10: case 11: {
      value = {};
      const keys = node.p?.k ?? [];
      const vals = node.p?.v ?? [];
      keys.forEach((k, i) => { value[k] = decode(vals[i]); });
      break;
    }
    default: value = node.s ?? (node.a ? node.a.map(decode) : node.p ? decode({ t: 10, p: node.p }) : null);
  }
  if (node.i !== undefined && node.t !== 4) refs.set(node.i, value);
  return value;
}
const root = decode(JSON.parse(readFileSync(process.argv[2], "utf8")));
const result = root?.result ?? root;
const rows = result?.rows ?? [];
console.log(JSON.stringify({ outcome: result?.outcome, rows: rows.length }));
for (const r of rows.slice(0, 12)) {
  console.log(JSON.stringify({
    title: r.title, kind: r.kind, role: r.role, company: r.company, industry: r.industry, category: r.category, location: r.location,
    email: r.email ?? null, phone: r.phone ?? null, contact_page_url: r.contact_page_url ?? null, website_url: r.website_url ?? null, profile_url: r.profile_url ?? null,
    why_match: (r.why_match ?? "").slice(0, 160), source_url: r.source_url ?? null,
    evidence: (r.evidence ?? []).map((e) => `${e.evidence_type}/${e.supports}:${(e.excerpt ?? "").slice(0, 70)}@${(e.source_url ?? "").replace(/^https?:\/\//, "").slice(0, 50)}${e.provenance ? ` prov=${e.provenance.acquisition}` : ""}`).slice(0, 5),
  }));
}
