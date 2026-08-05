import "./_env.mts";
/**
 * Back-to-back searches must each get their own social allocation.
 * Before the per-request budget these shared one rolling minute, so the second
 * and third searches skipped social entirely.
 */
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import { expandQuery } from "../src/lib/search/query-expander.ts";
import { searchAllSources } from "../src/lib/search/sources.server.ts";

const SOCIAL = new Set(["linkedin", "twitter", "instagram", "facebook", "threads", "quora"]);
let fail = 0;
for (const q of ["writer", "marketing", "photographer"]) {
  const { leads } = await searchAllSources({
    classified: classifyQuery(q),
    expanded: expandQuery(q),
  } as never);
  const social = (leads as Array<{ source?: string }>).filter((l) => SOCIAL.has(l.source ?? ""));
  const by = new Map<string, number>();
  for (const l of social) by.set(l.source!, (by.get(l.source!) ?? 0) + 1);
  const ok = social.length > 0;
  if (!ok) fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${q.padEnd(14)} total=${String(leads.length).padStart(3)} ` +
      `social=${String(social.length).padStart(2)}  [${[...by].map(([s, n]) => `${s}:${n}`).join(" ")}]`,
  );
}
console.log(fail === 0 ? "\nevery back-to-back search got social\n" : `\n${fail} starved\n`);
process.exit(fail === 0 ? 0 : 1);
