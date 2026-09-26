/** Live verification: OSM provider function + full planned path on a thin
 *  geography + real jobs fleet. Read-only, bounded by tier budgets. */
import { searchOsmLocalBusinesses } from "@/lib/search/osm-local-businesses.server";
import { runSpecSearchCore } from "@/lib/spec-search.functions";

const t0 = Date.now();
const osm = await searchOsmLocalBusinesses(
  {
    raw: "dentists in Dhaka", skill: "dentists", role: "", queryType: "skill",
    relatedSkills: [], buyerIntentQueries: [], buyerPhrases: [],
    jobBoardQueries: [], jobBoardTerms: [], socialQueries: [],
    redditBuyerQueries: [], booleanWebQueries: [], customerPhrases: [],
    subreddits: [], negativePhrases: [], negativeSignals: [],
  },
  "Dhaka",
);
console.log(
  JSON.stringify({
    check: "osm-direct",
    rows: osm.length,
    sample: osm.slice(0, 2).map((l) => l.title),
    ms: Date.now() - t0,
  }),
);

const t1 = Date.now();
const r = await runSpecSearchCore("dentists in Reykjavik", {}, 10, { mode: "looking" });
console.log(
  JSON.stringify({
    check: "spec-thin-geo",
    rows: r.rows.length,
    countries: [...new Set(r.rows.map((x) => x.country).filter(Boolean))],
    engines: r.dbMeta.map((m) => m.engine),
    live: r.liveDiscovery,
    ms: Date.now() - t1,
  }),
);

const t2 = Date.now();
const j = await runSpecSearchCore("frontend developer jobs", {}, 10, {});
console.log(
  JSON.stringify({
    check: "spec-jobs-live",
    entity: j.spec.entity,
    rows: j.rows.length,
    sample: j.rows.slice(0, 3).map((x) => x.title),
    engines: j.dbMeta.map((m) => m.engine),
    clarify: j.clarify.map((q) => q.id),
    ms: Date.now() - t2,
  }),
);
