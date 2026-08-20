/**
 * Jobs search filters + hygiene (no live network required for most checks).
 * Live fetch: npx tsx scripts/verify-jobs-search.mts
 */
import { matchesJobFilters, looksRemote } from "../src/lib/jobs/filters";
import { isActiveJob, isClosedJob, isScamJob, isStaleDated } from "../src/lib/jobs/hygiene";
import type { JobPosting } from "../src/lib/jobs/types";
import { ensureJobCatalogRegistered } from "../src/lib/jobs/source-catalog";
import { fetchAllJobSources, listJobSources } from "../src/lib/jobs/registry";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const engineer: JobPosting = {
  id: "a",
  title: "Software Engineer",
  company: "Acme",
  location: "New York, NY",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  source: "source-ats-greenhouse",
  board_id: "acme",
  posted_at: new Date().toISOString(),
  description: "Remote-friendly backend role",
  salary: null,
  remote: false,
  seniority: "mid",
};

check(
  "developer synonym matches engineer title",
  matchesJobFilters(engineer, { query: "developer" }),
);
check(
  "remoteOnly keeps description-remote jobs",
  matchesJobFilters(engineer, { remoteOnly: true }) &&
    looksRemote("", engineer.title, engineer.description),
);
check("nyc alias matches New York", matchesJobFilters(engineer, { location: "NYC" }));
check("asia region does not wipe a NY job", !matchesJobFilters(engineer, { region: "asia" }));
check("north america keeps NY job", matchesJobFilters(engineer, { region: "north_america" }));
check(
  "closed title dropped",
  isClosedJob({ title: "Engineer (Position Filled)", description: "" }),
);
check(
  "scam telegram dropped",
  isScamJob({
    title: "Easy cash",
    company: "x",
    url: "https://t.me/join",
    description: "earn $500 / day",
  }),
);
check(
  "stale 60-day dated dropped",
  isStaleDated(new Date(Date.now() - 60 * 86400_000).toISOString()),
);
check(
  "fresh ATS job is active",
  isActiveJob({
    title: "Designer",
    company: "Figma",
    url: "https://boards.greenhouse.io/figma/jobs/1",
    source: "source-ats-greenhouse",
    board_id: "figma",
    posted_at: new Date().toISOString(),
  }),
);
check(
  "dead 404 board does not empty via filter (missing url rejected individually)",
  !isActiveJob({ title: "X", company: "Y", url: "", source: "source-ats-lever", board_id: "dead" }),
);

async function live() {
  ensureJobCatalogRegistered();
  check(
    "catalog has more than 3 adapters",
    listJobSources().length > 3,
    `n=${listJobSources().length}`,
  );
  const jobs = await fetchAllJobSources({ query: "developer", remoteOnly: true, limit: 80 });
  check("developer+remote live rows", jobs.length > 0, `n=${jobs.length}`);
  const stale = jobs.filter((j) => j.posted_at && isStaleDated(j.posted_at));
  check("no 30d+ dated jobs in results", stale.length === 0, `stale=${stale.length}`);
}

live()
  .then(() => {
    console.log(failed ? `\n${failed} failed` : "\nAll jobs search tests passed.");
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
