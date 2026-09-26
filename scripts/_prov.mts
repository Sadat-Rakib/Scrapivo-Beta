/** Extraction provenance for every frame in a report. Temporary. */
import { readFileSync } from "node:fs";

for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, "utf8");
  const re = /```json\n([\s\S]*?)\n```/g;
  const tally = new Map<string, number>();
  let m: RegExpExecArray | null;
  let n = 0;
  const lat: number[] = [];
  while ((m = re.exec(text))) {
    let f: any;
    try {
      f = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const x = f.extraction ?? f.meta ?? {};
    if (!f.input?.raw) continue;
    n++;
    const key = `extractor=${x.extractor} provider=${x.provider} model=${x.model} prompt=${x.prompt_version} fallback=${x.fallback_used} cached=${x.cached}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (typeof x.latency_ms === "number") lat.push(x.latency_ms);
  }
  lat.sort((a, b) => a - b);
  const at = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] ?? 0;
  console.log(`\n${path}  (${n} frames)`);
  for (const [k, c] of tally) console.log(`  ${c}x  ${k}`);
  if (lat.length) console.log(`  latency p50=${at(0.5)}ms  p90=${at(0.9)}ms  max=${lat.at(-1)}ms`);
}
