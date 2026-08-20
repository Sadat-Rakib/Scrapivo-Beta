import "./_env.mts";
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import { expandQuery } from "../src/lib/search/query-expander.ts";
import { searchAllSources } from "../src/lib/search/sources.server.ts";

const q = process.argv.slice(2).join(" ") || "design";
const classified = classifyQuery(q);
const expanded = expandQuery(q);
const t0 = Date.now();
const { leads, sources } = await searchAllSources({ classified, expanded } as never);
console.log(`"${q}" -> ${leads.length} leads / ${sources.length} sources in ${Date.now() - t0}ms`);
const by = new Map<string, number>();
for (const l of leads as any[]) by.set(l.source, (by.get(l.source) ?? 0) + 1);
console.log("attempted:", sources.join(" "));
console.log(
  [...by]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}:${n}`)
    .join("  "),
);
const ages = (leads as any[])
  .filter((l) => l.posted_at)
  .map((l) => (Date.now() - new Date(l.posted_at).getTime()) / 3600000);
const b = { "<1h": 0, "<6h": 0, "<24h": 0, "<72h": 0, older: 0 };
for (const a of ages)
  a < 1 ? b["<1h"]++ : a < 6 ? b["<6h"]++ : a < 24 ? b["<24h"]++ : a < 72 ? b["<72h"]++ : b.older++;
console.log(`dated ${ages.length}/${leads.length} —`, JSON.stringify(b));
