/**
 * Reproduces the reported bug against a stub SearXNG: three back-to-back
 * Discover runs, counting how many live social queries each one lands.
 *
 * Run: npx tsx scripts/verify-social-budget.ts
 */
import { createServer } from "node:http";

const hits: string[] = [];

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const q = url.searchParams.get("q") || "";
  hits.push(q);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      results: [
        {
          url: `https://www.linkedin.com/posts/jane-doe_hiring-${hits.length}`,
          title: `Looking for a designer — post ${hits.length}`,
          content: "We need a designer for a new brand project, paid.",
        },
      ],
    }),
  );
});

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
process.env.SEARXNG_URL = `http://127.0.0.1:${port}`;

const { searchSearxng, withSearxngBudget, searxngBudgetState } = await import(
  "../src/lib/search/searxng.server.ts"
);

const SOCIAL = ["linkedin", "facebook", "twitter", "instagram", "threads", "quora"];
const OTHER = ["webboolean", "decisionmakers", "discord", "youtube", "fiverr", "startups"];

async function oneRun(label: string, nonce: string) {
  const before = hits.length;
  const socialBefore = hits.filter((h) => h.includes("site:")).length;

  await withSearxngBudget(async () => {
    // Non-social sources are registered earlier in the real fan-out.
    await Promise.all(
      OTHER.map((k) => searchSearxng([`${k} buyers ${nonce}`, `${k} hiring ${nonce}`], 2, "day", k)),
    );
    await Promise.all(
      SOCIAL.map((k) => searchSearxng([`site:${k}.com "looking for a ${nonce}"`], 1, "", k)),
    );
    await Promise.all(
      SOCIAL.map((k) => searchSearxng([`site:${k}.com "need a ${nonce}"`], 1, "", k)),
    );
  });

  const social = hits.filter((h) => h.includes("site:")).length - socialBefore;
  const b = searxngBudgetState();
  console.log(
    `${label}: ${hits.length - before} live queries, ${social} of them social` +
      ` | window social ${b.social.used}/${b.social.limit}, other ${b.other.used}/${b.other.limit}`,
  );
  return social;
}

const a = await oneRun("search 1", "designer");
const b = await oneRun("search 2", "copywriter");
const c = await oneRun("search 3", "illustrator");

server.close();
console.log("\nsocial queries per search:", [a, b, c].join(" / "));
console.log(a > 0 && b > 0 && c > 0 ? "PASS — no search was starved" : "FAIL — a search got zero social");
process.exit(a > 0 && b > 0 && c > 0 ? 0 : 1);
