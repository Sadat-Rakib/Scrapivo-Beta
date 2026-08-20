/**
 * Jobs ATS smoke test — live public boards.
 * Run: npx tsx scripts/verify-jobs-ats.mts
 */
import { ensureJobCatalogRegistered } from "../src/lib/jobs/source-catalog";
import { fetchAllJobSources, jobDedupeId, listJobSources } from "../src/lib/jobs/registry";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  ensureJobCatalogRegistered();
  check("catalog registered", listJobSources().length >= 6, `n=${listJobSources().length}`);

  const id1 = jobDedupeId("source-ats-greenhouse", "https://example.com/a");
  const id2 = jobDedupeId("source-ats-greenhouse", "https://example.com/a");
  check("dedupe id stable", id1 === id2 && id1.length === 40);

  const jobs = await fetchAllJobSources({
    query: "",
    sources: ["greenhouse", "lever", "ashby"],
    limit: 200,
  });
  check("fetched some jobs", jobs.length > 0, `n=${jobs.length}`);

  const bySource = {
    greenhouse: jobs.filter((j) => j.source === "source-ats-greenhouse").length,
    lever: jobs.filter((j) => j.source === "source-ats-lever").length,
    ashby: jobs.filter((j) => j.source === "source-ats-ashby").length,
  };
  console.log("bySource", bySource);
  check(
    "at least 2 sources returned jobs",
    Object.values(bySource).filter((n) => n > 0).length >= 2,
  );

  const engineer = await fetchAllJobSources({
    query: "engineer",
    sources: ["greenhouse", "ashby"],
    limit: 80,
  });
  check("engineer filter returns rows", engineer.length > 0, `n=${engineer.length}`);
  check(
    "engineer titles mostly match",
    engineer.filter((j) => /engineer|engineering|software/i.test(j.title)).length >
      engineer.length * 0.3,
  );

  const ids = new Set(jobs.map((j) => j.id));
  check("dedupe ids unique in batch", ids.size === jobs.length);

  console.log(failed ? `\n${failed} failed` : "\nAll jobs ATS tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
