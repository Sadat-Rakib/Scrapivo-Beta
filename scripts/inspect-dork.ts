/**
 * Prints what a single dork actually returns, per engine, so we can tell a real
 * platform hit from an index that quietly ignored the site: operator.
 *
 *   npx tsx scripts/inspect-dork.ts 'site:linkedin.com/posts "looking for a designer"'
 */

const BASE = process.env.SEARXNG_URL ?? "http://127.0.0.1:8888";
const QUERY = process.argv[2] ?? 'site:linkedin.com/posts "looking for a designer"';
const ENGINES = process.argv[3];

async function main() {
  const params = new URLSearchParams({
    q: QUERY,
    format: "json",
    categories: "general",
    language: "en",
  });
  if (ENGINES) params.set("engines", ENGINES);

  const started = Date.now();
  const res = await fetch(`${BASE}/search?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json()) as {
    results?: { url?: string; title?: string; engines?: string[] }[];
    unresponsive_engines?: [string, string][];
  };
  const results = data.results ?? [];
  console.log(`query: ${QUERY}`);
  console.log(`${results.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  // The dork asked for one host. Anything else means the engine ignored it.
  const siteMatch = /site:([^\s"]+)/.exec(QUERY);
  const wantHost = siteMatch?.[1];

  const byEngine = new Map<string, { total: number; onTarget: number; sample: string[] }>();
  for (const r of results) {
    const url = r.url ?? "";
    const onTarget = wantHost ? url.toLowerCase().includes(wantHost.toLowerCase()) : true;
    for (const e of r.engines ?? ["?"]) {
      const row = byEngine.get(e) ?? { total: 0, onTarget: 0, sample: [] };
      row.total++;
      if (onTarget) row.onTarget++;
      if (row.sample.length < 3) row.sample.push(url.slice(0, 100));
      byEngine.set(e, row);
    }
  }

  for (const [engine, row] of [...byEngine.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const pct = row.total ? Math.round((row.onTarget / row.total) * 100) : 0;
    console.log(`${engine}: ${row.total} rows, ${row.onTarget} on-target (${pct}%)`);
    for (const s of row.sample) console.log(`    ${s}`);
  }

  const onTargetTotal = results.filter((r) =>
    wantHost ? (r.url ?? "").toLowerCase().includes(wantHost.toLowerCase()) : true,
  ).length;
  console.log(`\nUSABLE (on ${wantHost ?? "any host"}): ${onTargetTotal} / ${results.length}`);

  if (data.unresponsive_engines?.length) {
    console.log(`\ndead: ${data.unresponsive_engines.map((e) => e.join(":")).join(", ")}`);
  }
}

void main();
