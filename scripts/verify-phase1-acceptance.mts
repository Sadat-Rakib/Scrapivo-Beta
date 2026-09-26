/** Phase 1 acceptance (geo/flow half): LIVE battery against real backends
 *  (Supabase hot index + S3 parquet, coverage selector ON).
 *  Run: npx tsx --env-file=.env scripts/verify-phase1-acceptance.mts
 *  (needs USE_COVERAGE_SELECTOR=true in env; .env is gitignored).
 *  Every test proves records + filters + source/fallback path + timing.
 *  Exit non-zero on any FAIL. Read-only (SELECT/LIST/GET only).
 */
import { runSpecSearchCore } from "@/lib/spec-search.functions";

interface Check {
  name: string;
  query: string;
  answers?: Record<string, string>;
  limit?: number;
  assert: (r: Awaited<ReturnType<typeof runSpecSearchCore>>, ms: number) => string | null;
}

const LOOK = { mode: "looking" };
const engines = (r: Awaited<ReturnType<typeof runSpecSearchCore>>) =>
  r.dbMeta.map((m) => m.engine);
const countries = (r: Awaited<ReturnType<typeof runSpecSearchCore>>) =>
  [...new Set(r.rows.map((x) => x.country).filter(Boolean))];

const CHECKS: Check[] = [
  {
    name: "dhaka-exact",
    query: "dentists in Dhaka",
    answers: LOOK,
    assert: (r) => {
      if (!r.rows.length) return "zero rows for a covered-S3 geography";
      if (!engines(r).includes("s3-parquet")) return `fallback path missing: ${engines(r)}`;
      const bad = countries(r).filter((c) => c !== "BD");
      if (bad.length) return `geo substitution detected: ${bad}`;
      return null;
    },
  },
  {
    name: "dhaka-misspelled",
    query: "dentists in Daka",
    answers: LOOK,
    assert: (r) => {
      if (r.rows.length) {
        const bad = countries(r).filter((c) => c !== "BD");
        if (bad.length) return `misspelling served wrong geography: ${bad}`;
      }
      if (!r.rows.length && !r.clarify.length) return "empty with no guidance";
      return null;
    },
  },
  {
    name: "mumbai-founders",
    query: "founders in Mumbai",
    answers: LOOK,
    assert: (r) => (!r.rows.length ? "zero founder rows for Mumbai" : null),
  },
  {
    name: "london-companies",
    query: "companies in London",
    answers: LOOK,
    assert: (r) => (!r.rows.length ? "zero company rows for London" : null),
  },
  {
    name: "s3-only-country",
    query: "dentists in Austria",
    answers: LOOK,
    assert: (r) => {
      if (!r.rows.length) return "zero rows for S3-covered Austria (hot=0)";
      if (!engines(r).includes("s3-parquet")) return `expected S3 fallback: ${engines(r)}`;
      return null;
    },
  },
  {
    name: "genuine-zero",
    query: "dentists in Antarctica",
    answers: LOOK,
    assert: (r) => {
      if (r.rows.length) return `fabricated rows for a no-data geography: ${r.rows.length}`;
      return null;
    },
  },
  {
    name: "vague-requires-clarify",
    query: "businesses",
    assert: (r) => {
      if (!r.clarify.length) return "vague query ran without questions";
      if (r.rows.length) return "vague query returned rows before clarifying";
      return null;
    },
  },
  {
    name: "complete-stated-intent-no-questions",
    query: "I need SaaS founders in New York",
    assert: (r) => {
      // Rich: a complete spec asks nothing. Thin (hosted slice genuinely
      // empty): Phase-5 always-ask offers OPTIONAL refinements instead of a
      // dead empty — guidance, not missing-field interrogation (status stays
      // ready, missing stays []).
      if (r.rows.length) {
        return r.clarify.length
          ? `unnecessary questions: ${r.clarify.map((q) => q.id)}`
          : null;
      }
      if (r.liveDiscovery !== "db_thin_gapfill_pending") return "thin without thin flag";
      if (!r.clarify.length) return "thin with no guidance";
      return null;
    },
  },
];

let failed = 0;
for (const c of CHECKS) {
  const t0 = Date.now();
  try {
    const r = await runSpecSearchCore(c.query, {}, c.limit ?? 25, c.answers ?? {});
    const ms = Date.now() - t0;
    const err = c.assert(r, ms);
    console.log(
      JSON.stringify({
        test: c.name,
        pass: err === null,
        fail: err,
        rows: r.rows.length,
        countries: countries(r),
        engines: engines(r),
        clarify: r.clarify.map((q) => q.id),
        liveDiscovery: r.liveDiscovery,
        ms,
      }),
    );
    if (err) failed++;
  } catch (e) {
    console.log(JSON.stringify({ test: c.name, pass: false, fail: `threw: ${e instanceof Error ? e.message : e}` }));
    failed++;
  }
}
console.log(JSON.stringify({ suite: "phase1-geo", failed, total: CHECKS.length }));
process.exit(failed ? 1 : 0);
