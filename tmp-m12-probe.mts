import { extractSearchSpec, normalizeRole } from "./src/lib/search/search-spec-extract.ts";
for (const q of [
  "marketing directors at SaaS companies in Toronto",
  "principal engineers at fintech companies",
  "restaurant owners in Vancouver",
  "AI researchers in Montreal",
  "founders of AI startups in Toronto",
  "founders needing developers in SF",
  "dentists in Toronto",
]) {
  const s = extractSearchSpec(q);
  console.log(
    JSON.stringify({
      q,
      entity: s.entity,
      criteria: s.criteria.map((c) => `${c.field}:${c.value}`),
      signal: s.signal_types,
      missing: s.missing,
    }),
  );
}
console.log(
  "roles",
  [
    "Marketing Director",
    "principal engineer",
    "dentist",
    "restaurant manager",
    "AI researcher",
    "venture partner",
  ].map((r) => [r, normalizeRole(r)]),
);
