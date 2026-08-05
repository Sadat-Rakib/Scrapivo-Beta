/**
 * Honest geo filter checks — never invent locations; reject foreign geo.
 *   npx tsx scripts/verify-location-filter.ts
 */
import { passesLocationFilter } from "../src/lib/validation";
import type { Lead } from "../src/lib/scoring";

function lead(partial: Partial<Lead>): Lead {
  return {
    source: "reddit",
    platform: "Reddit",
    title: partial.title || "Need a designer",
    snippet: partial.snippet || "",
    full_post_url: partial.full_post_url || "https://reddit.com/r/x/1",
    ...partial,
  } as Lead;
}

let fails = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(ok ? "ok" : "FAIL", name, detail || "");
  if (!ok) fails++;
}

check("no location always pass", passesLocationFilter(lead({ title: "Need writer in Berlin" }), null));
check(
  "India match",
  passesLocationFilter(lead({ title: "Need writer in Mumbai, India" }), "India"),
);
check(
  "foreign geo reject",
  !passesLocationFilter(lead({ title: "Hiring in Berlin, Germany" }), "India"),
);
check(
  "remote ok for country",
  passesLocationFilter(lead({ title: "Remote writer needed worldwide" }), "India"),
);
check(
  "no geo soft keep",
  passesLocationFilter(lead({ title: "Need a writer ASAP", snippet: "Budget $500" }), "India"),
);
check(
  "places source always",
  passesLocationFilter(lead({ source: "geoapify", title: "Agency" }), "India"),
);

console.log(fails === 0 ? "PASS" : `FAIL ${fails}`);
process.exit(fails === 0 ? 0 : 1);
