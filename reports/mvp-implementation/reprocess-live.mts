import "../../scripts/_env.mts";
import { readFile, writeFile } from "node:fs/promises";
import { frameToSearchSpec } from "../../src/lib/understanding/to-search-spec";
import { decideSpecClarification } from "../../src/lib/search/spec-clarification";
import type { UnderstandingFrame } from "../../src/lib/understanding/frame";

const rows = JSON.parse(await readFile("reports/mvp-implementation/LIVE_PROVIDER_RESULTS.json", "utf8")) as Array<{
  query: string;
  provider: string;
  model: string;
  fallback: boolean;
  frame: UnderstandingFrame;
}>;
const repaired = rows.map(({ query, provider, model, fallback, frame }) => {
  const spec = frameToSearchSpec(frame);
  const question = decideSpecClarification(spec);
  return { query, provider, model, fallback, notes: spec.understanding?.meta.notes,
    spec, decision: question ? { type: "clarify", question } : { type: "act" } };
});
await writeFile("reports/mvp-implementation/LIVE_PROVIDER_REPROCESSED.json", JSON.stringify(repaired, null, 2));
console.log(JSON.stringify({ total: repaired.length, fallback: repaired.filter((row) => row.fallback).length,
  repaired: repaired.filter((row) => row.notes?.some((note) => note.startsWith("recovered") || note.startsWith("repaired"))).length }));
