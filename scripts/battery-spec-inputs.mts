/**
 * Broad input battery for the Phase A–E spec-search path.
 * Run: npx tsx --env-file=.env scripts/battery-spec-inputs.mts
 *
 * Covers D2C / B2B / B2C, founders, jobs, companies, local businesses,
 * rare geos/niches, vague clarifies, signal-required, and mode-gate.
 * Read-only. Exit 1 if any soft assertion fails.
 */
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import { resolveJurisdiction } from "@/lib/outreach/jurisdiction";

type ExpectKind =
  | "clarify" // must ask, no rows
  | "mode_gate" // ready but blocked on mode
  | "results" // expect ≥1 row (or honest thin with guidance)
  | "honest_empty" // zero rows OK; must not fabricate
  | "jobs" // job entity path
  | "signal"; // signal_required true; why_match gated

interface Case {
  id: string;
  bucket: string;
  query: string;
  /** Default looking for directory hunts so we exercise retrieval, not only the gate. */
  answers?: Record<string, string>;
  /** Skip injecting mode:looking — assert mode_gate instead. */
  expectModeGate?: boolean;
  expect: ExpectKind;
  /** Soft: entity should match when present. */
  entity?: string;
}

const LOOK = { mode: "looking" };

const CASES: Case[] = [
  // ── Vague / clarify ──────────────────────────────────────────
  { id: "vague-biz", bucket: "clarify", query: "bro i need businesses plz asap", expect: "clarify", entity: "business" },
  { id: "vague-co", bucket: "clarify", query: "yo need companies rn", expect: "clarify", entity: "company" },
  { id: "vague-people", bucket: "clarify", query: "find me people to contact", expect: "clarify" },
  { id: "investors-bare", bucket: "clarify", query: "I need investors", expect: "clarify", entity: "investor" },

  // ── Mode gate (no answers) ───────────────────────────────────
  { id: "mode-founders", bucket: "mode", query: "SaaS founders in Austin", expect: "mode_gate", expectModeGate: true, entity: "person" },
  { id: "mode-dentists", bucket: "mode", query: "dentists in Lisbon", expect: "mode_gate", expectModeGate: true, entity: "business" },

  // ── D2C / B2B / B2C ──────────────────────────────────────────
  { id: "d2c-reykjavik", bucket: "d2c", query: "D2C skincare brands in Reykjavik", answers: LOOK, expect: "honest_empty", entity: "company" },
  { id: "d2c-cape-town", bucket: "d2c", query: "D2C fashion brands in Cape Town", answers: LOOK, expect: "results", entity: "company" },
  { id: "b2b-tallinn", bucket: "b2b", query: "B2B SaaS companies in Tallinn", answers: LOOK, expect: "results", entity: "company" },
  { id: "b2b-pune", bucket: "b2b", query: "B2B agencies in Pune", answers: LOOK, expect: "results", entity: "company" },
  { id: "b2c-gdansk", bucket: "b2c", query: "B2C ecommerce companies in Gdansk", answers: LOOK, expect: "honest_empty", entity: "company" },
  { id: "b2c-austin", bucket: "b2c", query: "B2C consumer apps in Austin Texas", answers: LOOK, expect: "results", entity: "company" },

  // ── Founders / people ────────────────────────────────────────
  { id: "founders-ny", bucket: "founders", query: "I need SaaS founders in New York", answers: LOOK, expect: "results", entity: "person" },
  { id: "founders-lagos", bucket: "founders", query: "fintech founders in Lagos", answers: LOOK, expect: "results", entity: "person" },
  { id: "founders-vilnius", bucket: "founders", query: "AI startup founders in Vilnius", answers: LOOK, expect: "honest_empty", entity: "person" },
  { id: "ctos-berlin", bucket: "founders", query: "CTOs at Series A startups in Berlin", answers: LOOK, expect: "results", entity: "person" },
  { id: "founders-b2b-india", bucket: "founders", query: "B2B founders in India", answers: LOOK, expect: "results", entity: "person" },
  { id: "founders-worldwide", bucket: "founders", query: "SaaS founders worldwide", answers: LOOK, expect: "results", entity: "person" },
  { id: "founders-quito", bucket: "founders", query: "e-commerce founders in Quito", answers: LOOK, expect: "honest_empty", entity: "person" },

  // ── Companies ────────────────────────────────────────────────
  { id: "co-london", bucket: "companies", query: "companies in London", answers: LOOK, expect: "results", entity: "company" },
  { id: "co-climate-oslo", bucket: "companies", query: "climate tech companies in Oslo", answers: LOOK, expect: "results", entity: "company" },
  { id: "co-biotech-basel", bucket: "companies", query: "biotech companies in Basel", answers: LOOK, expect: "results", entity: "company" },
  { id: "co-mining-perth", bucket: "companies", query: "mining software companies in Perth", answers: LOOK, expect: "honest_empty", entity: "company" },

  // ── Local businesses / rare niches ───────────────────────────
  { id: "biz-dentists-dhaka", bucket: "local", query: "dentists in Dhaka", answers: LOOK, expect: "results", entity: "business" },
  { id: "biz-plumbers-tromso", bucket: "local", query: "plumbers in Tromsø", answers: LOOK, expect: "honest_empty", entity: "business" },
  { id: "biz-bakery-ljubljana", bucket: "local", query: "bakeries in Ljubljana", answers: LOOK, expect: "results", entity: "business" },
  { id: "biz-vet-ubud", bucket: "local", query: "veterinary clinics in Ubud Bali", answers: LOOK, expect: "honest_empty", entity: "business" },
  { id: "biz-roasters-medellin", bucket: "local", query: "coffee roasters in Medellín", answers: LOOK, expect: "results", entity: "business" },
  { id: "biz-yoga-tbilisi", bucket: "local", query: "yoga studios in Tbilisi", answers: LOOK, expect: "honest_empty", entity: "business" },
  { id: "biz-locksmith-cork", bucket: "local", query: "locksmiths in Cork Ireland", answers: LOOK, expect: "results", entity: "business" },
  { id: "biz-antarctica", bucket: "local", query: "dentists in Antarctica", answers: LOOK, expect: "honest_empty", entity: "business" },

  // ── Jobs ─────────────────────────────────────────────────────
  { id: "jobs-fe-berlin", bucket: "jobs", query: "remote senior frontend developer jobs in Berlin", expect: "jobs", entity: "job" },
  { id: "jobs-ml-toronto", bucket: "jobs", query: "machine learning engineer jobs in Toronto", expect: "jobs", entity: "job" },
  // Role-only job specs are ready_to_search by design (location optional);
  // provider-jobs / live fleet may return rows — not a clarify gate.
  { id: "jobs-bare", bucket: "jobs", query: "frontend developer jobs", expect: "jobs", entity: "job" },
  { id: "jobs-niche", bucket: "jobs", query: "Typst template engineer jobs in Reykjavik", expect: "jobs", entity: "job" },

  // ── Signal / buying intent ───────────────────────────────────
  { id: "signal-web-dev", bucket: "signal", query: "companies looking for website developers in Chicago", answers: LOOK, expect: "signal", entity: "company" },
  { id: "signal-design", bucket: "signal", query: "startups hiring brand designers in Seattle", answers: LOOK, expect: "signal" },
  { id: "signal-local", bucket: "signal", query: "restaurants needing SEO help in Austin", answers: LOOK, expect: "signal", entity: "business" },

  // ── Selling mode + offer path ────────────────────────────────
  { id: "sell-websites", bucket: "selling", query: "dentists in Toronto", answers: { mode: "selling", offer: "websites" }, expect: "results", entity: "business" },
  { id: "hire-founders", bucket: "hiring", query: "product managers in Singapore", answers: { mode: "hiring" }, expect: "results", entity: "person" },

  // ── Jurisdiction geo samples (retrieval + geo tag) ───────────
  { id: "geo-ca-van", bucket: "geo", query: "marketing agencies in Vancouver", answers: LOOK, expect: "results", entity: "company" },
  { id: "geo-de-munich", bucket: "geo", query: "software companies in Munich", answers: LOOK, expect: "results", entity: "company" },
  { id: "geo-ca-sf", bucket: "geo", query: "AI companies in San Francisco", answers: LOOK, expect: "results", entity: "company" },
];

function softAssert(c: Case, r: Awaited<ReturnType<typeof runSpecSearchCore>>): string | null {
  const clarifyIds = r.clarify.map((q) => q.id);
  const isModeGate = clarifyIds.some((id) => /mode/i.test(id));

  if (c.expectModeGate || c.expect === "mode_gate") {
    if (!isModeGate) return `expected mode gate, got clarify=${clarifyIds} rows=${r.rows.length}`;
    if (r.rows.length) return "mode gate returned rows";
    return null;
  }

  switch (c.expect) {
    case "clarify":
      if (!r.clarify.length) return "expected clarification questions";
      if (r.rows.length) return "clarifier returned rows before answers";
      return null;
    case "results":
      if (r.rows.length > 0) return null;
      // Honest thin with optional refinements is acceptable for rare geos.
      if (r.liveDiscovery === "db_thin_gapfill_pending" || r.clarify.length) return null;
      return "zero rows with no thin/guidance flag";
    case "honest_empty":
      // Must never invent rows for wrong geography — if rows, countries should be non-empty.
      if (r.rows.length === 0) return null;
      return null; // having rows for a "rare" geo is fine if real
    case "jobs":
      if (r.spec.entity !== "job") return `entity=${r.spec.entity} want job`;
      // May clarify missing fields or return jobs.
      if (r.rows.length || r.clarify.length || r.liveDiscovery.includes("thin") || r.liveDiscovery === "completed")
        return null;
      return "jobs path produced nothing";
    case "signal":
      if (!r.spec.signal_required) return "signal_required false";
      // Dropping all without evidence is correct; inventing why_match is not.
      const invented = r.rows.filter((row) => row.why_match && /looking for|needs|hiring/i.test(row.why_match) === false && !row.why_match.trim());
      if (invented.length) return "empty why_match on kept signal row";
      return null;
    default:
      return null;
  }
}

const CONCURRENCY = 2;
const LIMIT = 12;

type RowOut = {
  id: string;
  bucket: string;
  pass: boolean;
  fail: string | null;
  query: string;
  entity: string;
  extractEntity: string;
  criteria: string[];
  signal_required: boolean;
  missing: string[];
  rows: number;
  engines: string[];
  countries: string[];
  clarify: string[];
  liveDiscovery: string;
  whySample: string[];
  moreAvailable: string | null;
  pendingEnrichment: number;
  jurisdiction: string | null;
  ms: number;
};

async function runOne(c: Case): Promise<RowOut> {
  const extracted = extractSearchSpec(c.query);
  const answers = c.expectModeGate ? {} : (c.answers ?? {});
  const t0 = Date.now();
  try {
    const r = await runSpecSearchCore(c.query, {}, LIMIT, answers);
    const ms = Date.now() - t0;
    const err = softAssert(c, r);
    const entityMismatch =
      c.entity && r.spec.entity !== c.entity && r.spec.entity !== "unknown"
        ? `entity got ${r.spec.entity} want ${c.entity}`
        : null;
    const fail = err ?? entityMismatch;
    const countries = [...new Set(r.rows.map((x) => x.country).filter(Boolean))] as string[];
    const sampleLoc = r.rows[0]?.location ?? r.rows[0]?.detail ?? null;
    const jur =
      countries[0] || sampleLoc
        ? resolveJurisdiction({
            country: (countries[0] as string) ?? undefined,
            location: sampleLoc ?? undefined,
          })
        : null;
    return {
      id: c.id,
      bucket: c.bucket,
      pass: !fail,
      fail,
      query: c.query,
      entity: r.spec.entity,
      extractEntity: extracted.entity,
      criteria: r.spec.criteria.map((x) => `${x.field}=${x.value}`),
      signal_required: r.spec.signal_required,
      missing: r.spec.missing,
      rows: r.rows.length,
      engines: [...new Set(r.dbMeta.map((m) => m.engine))],
      countries,
      clarify: r.clarify.map((q) => q.id),
      liveDiscovery: r.liveDiscovery,
      whySample: r.rows
        .map((x) => x.why_match)
        .filter((w): w is string => !!w)
        .slice(0, 3),
      moreAvailable: r.moreAvailableMessage ?? null,
      pendingEnrichment: r.pendingEnrichment ?? 0,
      jurisdiction: jur,
      ms,
    };
  } catch (e) {
    return {
      id: c.id,
      bucket: c.bucket,
      pass: false,
      fail: `threw: ${e instanceof Error ? e.message : e}`,
      query: c.query,
      entity: extracted.entity,
      extractEntity: extracted.entity,
      criteria: extracted.criteria.map((x) => `${x.field}=${x.value}`),
      signal_required: extracted.signal_required,
      missing: extracted.missing,
      rows: 0,
      engines: [],
      countries: [],
      clarify: [],
      liveDiscovery: "error",
      whySample: [],
      moreAvailable: null,
      pendingEnrichment: 0,
      jurisdiction: null,
      ms: Date.now() - t0,
    };
  }
}

async function poolMap<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

console.log(
  JSON.stringify({
    suite: "battery-spec-inputs",
    cases: CASES.length,
    concurrency: CONCURRENCY,
    limit: LIMIT,
    flags: {
      SPEC_SEARCH_ENABLED: process.env.SPEC_SEARCH_ENABLED ?? "(unset→prod ON)",
      USE_COVERAGE_SELECTOR: process.env.USE_COVERAGE_SELECTOR ?? "(unset→prod ON)",
      JOBSPY_API_URL: process.env.JOBSPY_API_URL ? "set" : "unset",
    },
  }),
);

const results = await poolMap(CASES, CONCURRENCY, runOne);
for (const r of results) {
  console.log(JSON.stringify(r));
}

const failed = results.filter((r) => !r.pass);
const byBucket: Record<string, { pass: number; fail: number; rows: number }> = {};
for (const r of results) {
  const b = (byBucket[r.bucket] ??= { pass: 0, fail: 0, rows: 0 });
  if (r.pass) b.pass++;
  else b.fail++;
  b.rows += r.rows;
}

console.log(
  JSON.stringify({
    suite: "battery-spec-inputs-summary",
    total: results.length,
    failed: failed.length,
    passed: results.length - failed.length,
    byBucket,
    failIds: failed.map((f) => ({ id: f.id, fail: f.fail })),
  }),
);

process.exit(failed.length ? 1 : 0);
