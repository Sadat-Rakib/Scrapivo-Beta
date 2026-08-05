/**
 * Suspended-engine behaviour: a stub that answers 200-with-zero-results, the
 * exact shape SearXNG returns when its upstreams have cut us off.
 *
 * Checks the two things that decide whether a later search still has social:
 *   1. a dork that just came back empty is not re-asked (negative cache), so
 *      the minute's budget isn't spent on guaranteed zeroes
 *   2. once a dork HAS a cached copy, a refusal serves that instead of nothing
 *
 * Run: npx tsx scripts/verify-searxng-degradation.ts
 */
import { createServer } from "node:http";

let mode: "results" | "empty" = "empty";
let upstreamHits = 0;

const server = createServer((req, res) => {
  upstreamHits++;
  const results =
    mode === "results"
      ? [
          {
            url: "https://www.linkedin.com/posts/jane-doe_hiring-1",
            title: "Looking for a designer",
            content: "We need a designer for a rebrand, paid work.",
          },
        ]
      : [];
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ results }));
});

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
process.env.SEARXNG_URL = `http://127.0.0.1:${port}`;

const { searchSearxng, withSearxngBudget } = await import("../src/lib/search/searxng.server.ts");

const DORK = 'site:linkedin.com/posts "looking for a designer"';

// 1) Engines suspended. First ask hits upstream (plus its retry).
upstreamHits = 0;
await withSearxngBudget(() => searchSearxng([DORK], 1, "", "linkedin"));
const firstAsk = upstreamHits;

// 2) Same dork again while still suspended — must not touch upstream at all.
upstreamHits = 0;
await withSearxngBudget(() => searchSearxng([DORK], 1, "", "linkedin"));
const repeatAsk = upstreamHits;

console.log(`suspended engines: first ask ${firstAsk} upstream calls, repeat ask ${repeatAsk}`);

// 3) Engines recover, cache a real answer, then suspend again and confirm the
//    cached copy is what a later refusal serves.
mode = "results";
await new Promise((r) => setTimeout(r, 100));
const warm = await withSearxngBudget(() =>
  searchSearxng([`${DORK} v2`], 1, "", "linkedin"),
) as unknown[];
mode = "empty";
const afterSuspend = (await withSearxngBudget(() =>
  searchSearxng([`${DORK} v2`], 1, "", "linkedin"),
)) as unknown[];

server.close();

console.log(`cached dork: ${warm.length} rows warm, ${afterSuspend.length} rows once suspended`);
const pass = repeatAsk === 0 && afterSuspend.length > 0;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
