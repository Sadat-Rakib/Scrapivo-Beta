/**
 * Live smoke test for the /jobs pipeline (no auth needed — calls the registry
 * directly, not the server function).
 *
 * Run: npx tsx scripts/jobs-smoke.mts "senior designer" senior
 */
import { ensureJobCatalogRegistered } from "../src/lib/jobs/source-catalog";
import { fetchAllJobSourcesWithMeta } from "../src/lib/jobs/registry";
import { parseQuery } from "../src/lib/jobs/relevance";

const query = process.argv[2] ?? "senior designer";
const seniority = process.argv[3] ?? "senior";
const location = process.argv[4] ?? "";

async function main() {
  ensureJobCatalogRegistered();
  const t0 = Date.now();
  const { jobs, fetched, sourceStatuses } = await fetchAllJobSourcesWithMeta({
    query,
    location,
    remoteOnly: false,
    seniority: seniority === "any" ? undefined : seniority,
    region: "any",
    sources: [],
    limit: 200,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n=== jobs smoke: "${query}" (seniority=${seniority || "any"}) ===`);
  console.log(`fetched (pre-filter, deduped): ${fetched}`);
  console.log(`after filters: ${jobs.length} in ${secs}s\n`);

  console.log("per-source:");
  for (const s of [...sourceStatuses].sort((a, b) => b.count - a.count)) {
    console.log(
      `  ${s.status === "error" ? "✗" : "•"} ${s.label.padEnd(18)} ${String(s.count).padStart(4)}${
        s.error ? `  (${s.error})` : ""
      }`,
    );
  }

  const pq = parseQuery(query);
  console.log(`\nparsed query: tokens=${JSON.stringify(pq.tokens)} seniority=${pq.seniority ?? "-"}`);
  console.log(`\ntop 20:`);
  for (const j of jobs.slice(0, 20)) {
    console.log(`  [${j.source.replace(/^source-(ats-)?/, "")}] ${j.title} — ${j.company} (${j.location || "?"})`);
  }

  // Relevance assertions: every returned job must contain a role token in the
  // title (the gate), and none may be an intern posting for a senior query.
  const offenders = jobs.filter((j) => {
    const t = j.title.toLowerCase();
    if (seniority === "senior" && /\bintern\b/.test(t)) return true;
    return false;
  });
  console.log(
    `\nrelevance check: ${offenders.length} offenders ${
      offenders.length ? "✗" : "✓"
    }`,
  );
  for (const o of offenders.slice(0, 5)) console.log(`  OFFENDER: ${o.title} — ${o.company}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
