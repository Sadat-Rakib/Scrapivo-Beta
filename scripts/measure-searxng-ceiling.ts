/**
 * Measures what the local SearXNG instance actually tolerates, so the budget
 * constants are set from data instead of from the last incident's guess.
 *
 * Fires N distinct site: dorks concurrently and reports successes, empties,
 * errors and latency percentiles. Distinct phrasings only — a repeated dork
 * would be answered from SearXNG's own cache and measure nothing.
 *
 *   npx tsx scripts/measure-searxng-ceiling.ts [concurrency]
 */

const BASE = process.env.SEARXNG_URL ?? "http://127.0.0.1:8888";
const CONCURRENCY = Number(process.argv[2] ?? 40);

const SITES = [
  "linkedin.com/posts",
  "facebook.com/groups",
  "twitter.com",
  "instagram.com",
  "threads.net",
  "quora.com",
  "reddit.com",
  "news.ycombinator.com",
];
const PHRASES = [
  "looking for a designer",
  "need a designer",
  "can anyone recommend a designer",
  "hiring a designer",
  "looking for a developer",
  "need a video editor",
  "looking for a copywriter",
  "need a marketing consultant",
  "recommend an agency",
  "looking for a freelancer",
];

function buildQueries(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    const site = SITES[i % SITES.length];
    const phrase = PHRASES[Math.floor(i / SITES.length) % PHRASES.length];
    out.push(`site:${site} "${phrase}"`);
  }
  return out;
}

type Outcome = { status: "ok" | "empty" | "error"; ms: number; rows: number; detail?: string };

/** engine name -> rows it contributed, so we can see who is actually earning. */
const contributed = new Map<string, number>();

async function ask(q: string): Promise<Outcome> {
  const started = Date.now();
  const params = new URLSearchParams({ q, format: "json", categories: "general", language: "en" });
  try {
    const res = await fetch(`${BASE}/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { status: "error", ms, rows: 0, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      results?: { engines?: string[] }[];
      unresponsive_engines?: [string, string][];
    };
    const rows = data.results?.length ?? 0;
    for (const r of data.results ?? []) {
      for (const e of r.engines ?? []) contributed.set(e, (contributed.get(e) ?? 0) + 1);
    }
    const dead = (data.unresponsive_engines ?? []).map((e) => e.join(":")).join(", ");
    return { status: rows > 0 ? "ok" : "empty", ms, rows, detail: dead || undefined };
  } catch (e) {
    return {
      status: "error",
      ms: Date.now() - started,
      rows: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

async function main() {
  const queries = buildQueries(CONCURRENCY);
  console.log(`firing ${queries.length} distinct dorks at ${BASE} all at once\n`);

  const wall = Date.now();
  const results = await Promise.all(queries.map(ask));
  const elapsed = Date.now() - wall;

  const ok = results.filter((r) => r.status === "ok");
  const empty = results.filter((r) => r.status === "empty");
  const errored = results.filter((r) => r.status === "error");
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const rows = results.reduce((n, r) => n + r.rows, 0);

  console.log(`ok      ${ok.length}/${results.length}   (${rows} rows total)`);
  console.log(`empty   ${empty.length}`);
  console.log(`error   ${errored.length}`);
  console.log(
    `latency p50 ${pct(latencies, 50)}ms  p90 ${pct(latencies, 90)}ms  max ${latencies.at(-1)}ms`,
  );
  console.log(`wall    ${(elapsed / 1000).toFixed(1)}s for the whole burst\n`);

  const suspensions = new Map<string, number>();
  for (const r of results) {
    if (!r.detail) continue;
    for (const d of r.detail.split(", ")) suspensions.set(d, (suspensions.get(d) ?? 0) + 1);
  }
  if (suspensions.size) {
    console.log("unresponsive engines seen:");
    for (const [name, n] of [...suspensions.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}x  ${name}`);
    }
  } else {
    console.log("no unresponsive engines reported");
  }

  if (contributed.size) {
    console.log("\nengines that actually returned rows:");
    for (const [name, n] of [...contributed.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)} rows  ${name}`);
    }
  }

  const healthy = ok.length / results.length;
  console.log(
    `\n=> ${(healthy * 100).toFixed(0)}% of ${results.length} concurrent dorks succeeded`,
  );
}

void main();
