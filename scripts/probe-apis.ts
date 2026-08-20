/**
 * Hits each free upstream API raw, so a source returning zero can be blamed on
 * the API being dead vs. our filtering being too strict.
 *
 *   npx tsx scripts/probe-apis.ts
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Probe = {
  name: string;
  url: string;
  count: (j: any) => number;
  headers?: Record<string, string>;
};

const PROBES: Probe[] = [
  {
    name: "bluesky searchPosts",
    url:
      "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" +
      encodeURIComponent("looking for a designer") +
      "&limit=20",
    count: (j) => j?.posts?.length ?? 0,
  },
  {
    name: "hn algolia (all)",
    url:
      "https://hn.algolia.com/api/v1/search_by_date?query=" +
      encodeURIComponent("looking for a designer") +
      "&tags=comment&hitsPerPage=30",
    count: (j) => j?.hits?.length ?? 0,
  },
  {
    name: "lemmy (lemmy.world)",
    url:
      "https://lemmy.world/api/v3/search?q=" +
      encodeURIComponent("designer") +
      "&type_=Posts&sort=New&limit=20",
    count: (j) => j?.posts?.length ?? 0,
  },
  {
    name: "mastodon (mastodon.social)",
    url:
      "https://mastodon.social/api/v2/search?q=" +
      encodeURIComponent("looking for a designer") +
      "&type=statuses&limit=20",
    count: (j) => j?.statuses?.length ?? 0,
  },
  {
    name: "devto",
    url: "https://dev.to/api/articles?tag=hiring&per_page=20",
    count: (j) => (Array.isArray(j) ? j.length : 0),
  },
  {
    name: "lobsters",
    url: "https://lobste.rs/search.json?q=designer&what=stories&order=newest",
    count: (j) => (Array.isArray(j) ? j.length : (j?.length ?? 0)),
  },
  {
    name: "remoteok",
    url: "https://remoteok.com/api",
    count: (j) => (Array.isArray(j) ? j.length : 0),
  },
  {
    name: "arbeitnow",
    url: "https://www.arbeitnow.com/api/job-board-api",
    count: (j) => j?.data?.length ?? 0,
  },
  {
    name: "usajobs (needs key)",
    url: "https://data.usajobs.gov/api/search?Keyword=designer&ResultsPerPage=10",
    count: (j) => j?.SearchResult?.SearchResultCount ?? 0,
  },
  {
    name: "freelancer",
    url: "https://www.freelancer.com/api/projects/0.1/projects/active/?query=designer&limit=20&job_details=true",
    count: (j) => j?.result?.projects?.length ?? 0,
  },
  {
    name: "hn firebase (alive check)",
    url: "https://hacker-news.firebaseio.com/v0/maxitem.json",
    count: (j) => (typeof j === "number" ? 1 : 0),
  },
  {
    name: "discourse (meta.discourse)",
    url: "https://meta.discourse.org/search.json?q=" + encodeURIComponent("looking for a designer"),
    count: (j) => j?.posts?.length ?? 0,
  },
  {
    name: "indiehackers (algolia proxy)",
    url: "https://www.indiehackers.com/api/v1/posts?limit=10",
    count: (j) => (Array.isArray(j) ? j.length : (j?.posts?.length ?? 0)),
  },
];

async function main() {
  for (const p of PROBES) {
    const started = Date.now();
    try {
      const res = await fetch(p.url, {
        headers: { "User-Agent": UA, Accept: "application/json", ...p.headers },
        signal: AbortSignal.timeout(20_000),
      });
      const ms = Date.now() - started;
      const body = await res.text();
      let n = 0;
      let note = "";
      try {
        n = p.count(JSON.parse(body));
      } catch {
        note = ` (non-JSON: ${body.slice(0, 60).replace(/\s+/g, " ")})`;
      }
      const verdict = res.ok ? (n > 0 ? "OK" : "EMPTY") : `HTTP ${res.status}`;
      console.log(
        `${p.name.padEnd(30)} ${verdict.padEnd(10)} ${String(n).padStart(4)} rows  ${ms}ms${note}`,
      );
    } catch (e) {
      console.log(
        `${p.name.padEnd(30)} ${"THREW".padEnd(10)}    0 rows  ${Date.now() - started}ms  ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}

void main();
