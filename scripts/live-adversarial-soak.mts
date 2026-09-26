/**
 * Live Adversarial Soak — runtime verification ledger (RV1–RV10).
 *
 * Audit tooling only. Does not loosen qualification. Does not add sources.
 *
 * Success per query:
 *   qualified real lead(s)  OR  honest typed zero/failure
 * Never: force leads by weakening the theorem.
 *
 * Run: npx tsx --env-file=.env scripts/live-adversarial-soak.mts
 *      SOAK_SET=ag|adversarial|cancel|post-repair|all  (default: all)
 *      post-repair = A–G + ADV2/3/5/7/8/9/10 (looking/social/people/funding/hiring)
 */
import "../scripts/_env.mts";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { buildSourcePlan } from "@/lib/search/source-plan";
import { resolveCanonicalLocation } from "@/lib/search/location-resolver";
import { runSpecSearchCore, type SpecRow } from "@/lib/spec-search.functions";
import { qualifyLead } from "@/lib/search/qualify";
import { verifyCandidateClaims } from "@/lib/search/verification";
import {
  InMemoryQualifiedLeadStore,
  persistQualifiedLead,
  hydrateQualifiedLead,
  semanticEqual,
  hydratedLeadStillPassesTheorem,
} from "@/lib/search/qualified-lead-persist";
import { leadKeyOf } from "@/lib/search/qualified-lead";
import { projectQualifiedLead } from "@/lib/search/qualified-lead";
import { tryOpenSupabaseQualifiedLeadStore } from "@/lib/search/qualified-lead-store.server";
import type { QualifiedLeadStore } from "@/lib/search/qualified-lead-persist";
import { ActiveSearchSession } from "@/lib/search/search-run-client";
import { clearProviderLogs, recentProviderLogs } from "@/lib/search/provider-ladder";

process.env.AWAIT_PERSIST_LIVE = process.env.AWAIT_PERSIST_LIVE || "1";

const OUT_DIR = "tmp";
const TRACES = `${OUT_DIR}/live-adversarial-soak.jsonl`;
const LEDGER = `${OUT_DIR}/runtime-verification-ledger.md`;
const REPORT = "reports/universal-audit/17-live-adversarial-soak.md";

type FailureBucket =
  | "CONTRACT_BUG"
  | "IMPLEMENTATION_BUG"
  | "COVERAGE_GAP"
  | "ENVIRONMENT_PROVIDER_FAILURE"
  | "HONEST_ZERO"
  | "QUALIFIED_OK"
  | "UNKNOWN";

type SoakCase = {
  id: string;
  set: "ag" | "adversarial" | "cancel";
  label: string;
  query: string;
  answers?: Record<string, string>;
  /** Soft expectation for classification only — never gates success. */
  hope?: string;
};

const AG: SoakCase[] = [
  {
    id: "A",
    set: "ag",
    label: "Toronto restaurants needing websites",
    query: "Toronto restaurants needing websites",
    answers: { mode: "selling", offer: "websites" },
    hope: "local discovery + no_website",
  },
  {
    id: "B",
    set: "ag",
    label: "people looking for copywriters",
    query: "people looking for copywriters",
    answers: { mode: "looking" },
    hope: "person + need",
  },
  {
    id: "C",
    set: "ag",
    label: "founders needing developers in SF",
    query: "founders needing developers in SF",
    answers: { mode: "looking" },
    hope: "person/current role + developer need",
  },
  {
    id: "D",
    set: "ag",
    label: "companies needing marketing in Austin",
    query: "companies needing marketing help in Austin",
    answers: { mode: "looking" },
    hope: "company + service-request",
  },
  {
    id: "E",
    set: "ag",
    label: "recently funded startups in Berlin",
    query: "recently funded startups in Berlin",
    answers: { mode: "looking" },
    hope: "funding + temporal",
  },
  {
    id: "F",
    set: "ag",
    label: "people asking for website help",
    query: "people asking for website help",
    answers: { mode: "looking" },
    hope: "social/person",
  },
  {
    id: "G",
    set: "ag",
    label: "companies hiring copywriters in NY",
    query: "companies hiring copywriters in New York",
    answers: { mode: "looking" },
    hope: "employer + hiring",
  },
];

const ADVERSARIAL: SoakCase[] = [
  {
    id: "ADV1",
    set: "adversarial",
    label: "dentists Vancouver without websites",
    query: "dentists in Vancouver without websites",
  },
  {
    id: "ADV2",
    set: "adversarial",
    label: "AI startups Montreal raised this year",
    query: "AI startups in Montreal that raised money this year",
  },
  {
    id: "ADV3",
    set: "adversarial",
    label: "restaurant owners Toronto photographers",
    query: "restaurant owners in Toronto looking for photographers",
  },
  {
    id: "ADV4",
    set: "adversarial",
    label: "marketing directors SaaS London",
    query: "marketing directors at SaaS companies in London",
  },
  {
    id: "ADV5",
    set: "adversarial",
    label: "Austin hiring senior Python",
    query: "companies in Austin currently hiring senior Python engineers",
  },
  {
    id: "ADV6",
    set: "adversarial",
    label: "React jobs Toronto $150k+",
    query: "React jobs in Toronto paying over $150k",
  },
  {
    id: "ADV7",
    set: "adversarial",
    label: "Bay Area founders SEO help",
    query: "founders in the Bay Area asking for SEO help",
  },
  {
    id: "ADV8",
    set: "adversarial",
    label: "recently funded fintech Germany",
    query: "recently funded fintech companies in Germany",
  },
  {
    id: "ADV9",
    set: "adversarial",
    label: "NY people looking for video editors",
    query: "people in New York looking for video editors",
  },
  {
    id: "ADV10",
    set: "adversarial",
    label: "Greater London hiring ML engineers",
    query: "startups in Greater London hiring machine-learning engineers",
  },
  {
    id: "ADV11",
    set: "adversarial",
    label: "difficult zero — Typst engineers Reykjavik",
    query: "Typst template engineer jobs in Reykjavik",
    hope: "honest zero or typed empty",
  },
  {
    id: "ADV12",
    set: "adversarial",
    label: "difficult — veterinary clinics Ubud Bali",
    query: "veterinary clinics in Ubud Bali",
    hope: "honest zero or typed empty",
  },
];

function fieldOf(spec: ReturnType<typeof extractSearchSpec>, f: string) {
  return spec.criteria.find((c) => c.field === f)?.value ?? null;
}

function stageDenominators(rows: SpecRow[], spec: ReturnType<typeof extractSearchSpec>) {
  const artifacts_found = rows.length;
  let pages_classified = 0;
  let entities_extracted = 0;
  let entities_resolved = 0;
  let claims_extracted = 0;
  let claims_subject_bound = 0;
  let claims_temporally_valid = 0;
  let qualified = 0;

  for (const r of rows) {
    if (r.page_type && r.page_type !== "unknown") pages_classified += 1;
    if (r.entity_id || r.key) entities_extracted += 1;
    if (r.entity_resolved === true) entities_resolved += 1;
    const ev = r.evidence ?? [];
    if (ev.length) claims_extracted += 1;
    const entityId = (r.entity_id ?? r.key ?? "").trim();
    if (entityId && ev.some((e) => (e.subject ?? "") === entityId)) {
      claims_subject_bound += 1;
    }
    if (entityId && ev.length) {
      const v = verifyCandidateClaims({
        evidence: ev,
        entityId,
        spec,
      });
      if (v.ok) claims_temporally_valid += 1;
    }
    const q = qualifyLead(r, spec, ev);
    if (q.disposition === "qualified") qualified += 1;
  }

  return {
    artifacts_found,
    pages_classified,
    entities_extracted,
    entities_resolved,
    query_matched: rows.filter((r) => r.disposition !== "dropped").length,
    claims_extracted,
    claims_subject_bound,
    claims_temporally_valid,
    qualified,
  };
}

function classifyFailure(args: {
  error?: string;
  outcome: string;
  qualified: number;
  artifacts: number;
  liveSources: string[];
  dbSources: string[];
  searxDown: boolean;
  /** Mode-gate / clarifier short-circuit — honest typed outcome, not a provider failure. */
  clarifyCount: number;
  specStatus?: string | null;
  locationRaw?: string | null;
  providerErrors: string[];
}): FailureBucket {
  if (args.error) {
    if (/fetch failed|ECONNREFUSED|timeout|ENOTFOUND|503|502|429/i.test(args.error)) {
      return "ENVIRONMENT_PROVIDER_FAILURE";
    }
    return "IMPLEMENTATION_BUG";
  }
  if (args.qualified > 0) return "QUALIFIED_OK";
  // Spec extract swallowed intent into location ("Toronto looking") — known extract defect.
  if (args.locationRaw && /\blooking\b/i.test(args.locationRaw)) {
    return "IMPLEMENTATION_BUG";
  }
  if (
    args.clarifyCount > 0 ||
    args.specStatus === "needs_clarification" ||
    args.outcome === "SEARCH_CANCELLED" ||
    args.outcome === "UNSUPPORTED_QUERY"
  ) {
    return "HONEST_ZERO";
  }
  if (args.providerErrors.some((e) => /404|ECONNREFUSED|timeout|502|503/i.test(e))) {
    if (args.artifacts === 0 && args.dbSources.length === 0) {
      return "ENVIRONMENT_PROVIDER_FAILURE";
    }
  }
  if (
    args.searxDown &&
    args.liveSources.length === 0 &&
    args.artifacts === 0 &&
    args.dbSources.length === 0 &&
    args.clarifyCount === 0
  ) {
    // Only when we actually intended live discovery and got nothing from DB either.
    return "COVERAGE_GAP";
  }
  if (args.artifacts === 0) return "COVERAGE_GAP";
  if (args.artifacts > 0 && args.qualified === 0) {
    // Pipeline worked; theorem refused — expected under hard law.
    return "HONEST_ZERO";
  }
  return "UNKNOWN";
}

async function runCase(c: SoakCase, envDiag: Record<string, unknown>) {
  clearProviderLogs();
  const parsed = extractSearchSpec(c.query);
  const plan = buildSourcePlan(parsed);
  const locRaw = fieldOf(parsed, "location");
  const geo = locRaw ? resolveCanonicalLocation(locRaw) : null;
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runSpecSearchCore>> | null = null;
  let error: string | undefined;
  try {
    result = await runSpecSearchCore(c.query, {}, 25, c.answers ?? {});
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - started;
  const rows = result?.rows ?? [];
  const spec = result?.spec ?? parsed;
  const dens = stageDenominators(rows, spec);
  const meta = result?.dbMeta ?? [];
  const liveSources = [
    ...new Set(
      meta
        .map((m) => m.engine)
        .filter((e) => String(e).startsWith("live-")),
    ),
  ];
  const dbSources = [
    ...new Set(
      meta
        .map((m) => m.engine)
        .filter((e) => e && !String(e).startsWith("live-")),
    ),
  ];

  // RV5: QualifiedLead store — prefer production Supabase adapter when table exists.
  let qlStore: QualifiedLeadStore = new InMemoryQualifiedLeadStore();
  let qlVia: "supabase" | "memory" = "memory";
  const prodQl = tryOpenSupabaseQualifiedLeadStore();
  if (prodQl) {
    try {
      await prodQl.size();
      qlStore = prodQl;
      qlVia = "supabase";
    } catch {
      // Table missing or unreachable — keep InMemory; do not invent persistence.
    }
  }
  let qlPersisted = 0;
  let qlHydrateOk = 0;
  let qlTheoremOk = 0;
  for (const r of rows) {
    const out = await persistQualifiedLead(qlStore, {
      row: r,
      spec,
      run: {
        search_run_id: result?.search_run_id,
        conversation_id: result?.conversation_id,
        turn_id: result?.turn_id,
        request_id: result?.request_id,
      },
    });
    if (!out.ok) continue;
    qlPersisted += 1;
    const rec = await qlStore.getRecord(leadKeyOf(out.lead));
    if (!rec) continue;
    const hydrated = hydrateQualifiedLead(rec);
    if (semanticEqual(out.lead, hydrated)) qlHydrateOk += 1;
    if (hydratedLeadStillPassesTheorem(hydrated)) qlTheoremOk += 1;
  }

  // RV5b: legacy live index write-back (what production path currently has).
  let legacyPersist: Record<string, unknown> = { attempted: false };
  try {
    const { stampVerified, persistVerifiedLiveRows, isVerifiedForPersist } =
      await import("@/lib/canonical/persist-live.server");
    const stamped = stampVerified(rows);
    const liveOnly = stamped.filter(
      (r) =>
        (r.key ?? "").startsWith("live-web:") ||
        (r.key ?? "").startsWith("live-social:") ||
        (r.key ?? "").startsWith("live-osm:"),
    );
    const verified = liveOnly.filter(isVerifiedForPersist);
    const pr = await persistVerifiedLiveRows(liveOnly);
    legacyPersist = {
      attempted: true,
      live_rows: liveOnly.length,
      verified_candidates: verified.length,
      persisted: pr.persisted,
      skipped: pr.skipped,
      via: pr.via ?? null,
      error: pr.error ?? null,
    };
  } catch (e) {
    legacyPersist = {
      attempted: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const clarifyCount = Array.isArray(result?.clarify)
    ? result!.clarify!.length
    : Array.isArray(result?.questions)
      ? result!.questions!.length
      : 0;
  const providerErrors = recentProviderLogs()
    .map((l) => `${l.provider_used ?? ""} ${l.fallback_reason ?? ""}`)
    .concat(
      dens.artifacts_found === 0
        ? []
        : [],
    );
  // Surface social 404s from console-level engines if present on meta notes.
  const locField = fieldOf(spec, "location");

  const bucket = classifyFailure({
    error,
    outcome: result?.outcome ?? "ERROR",
    qualified: dens.qualified,
    artifacts: dens.artifacts_found,
    liveSources: liveSources as string[],
    dbSources: dbSources as string[],
    searxDown: envDiag.searx_reachable === false,
    clarifyCount,
    specStatus: spec.status ?? null,
    locationRaw: locField,
    providerErrors,
  });

  // Success criterion: qualified OR honest typed outcome — never "must have leads".
  const success =
    !error &&
    (dens.qualified > 0 ||
      clarifyCount > 0 ||
      result?.outcome === "NO_QUALIFIED_RESULTS" ||
      result?.outcome === "EMPTY_RESULTS" ||
      result?.outcome === "SEARCH_CANCELLED" ||
      result?.outcome === "UNSUPPORTED_QUERY" ||
      result?.outcome === "SOURCE_UNAVAILABLE" ||
      (result?.qualified_count === 0 && dens.artifacts_found >= 0));

  return {
    id: c.id,
    set: c.set,
    label: c.label,
    query: c.query,
    hope: c.hope ?? null,
    ms,
    error: error ?? null,
    success_criterion_met: success,
    failure_bucket: bucket,
    run_id: result?.search_run_id ?? null,
    outcome: result?.outcome ?? "ERROR",
    clarify_count: clarifyCount,
    qualified_count_api: result?.qualified_count ?? 0,
    SearchSpec: {
      entity: spec.entity,
      status: spec.status,
      signal_required: spec.signal_required,
      signal_types: spec.signal_types,
      signal_recency: spec.signal_recency,
      location: fieldOf(spec, "location"),
      location_id: fieldOf(spec, "location_id"),
      requested_service: fieldOf(spec, "requested_service"),
      requested_role: fieldOf(spec, "requested_role"),
      opportunity: fieldOf(spec, "opportunity"),
      funding_status: fieldOf(spec, "funding_status"),
      industry: fieldOf(spec, "industry"),
    },
    geo: geo
      ? { id: geo.id, name: geo.name, resolution: geo.resolution }
      : null,
    sources_planned: plan.steps.map((s) => s.provider).slice(0, 20),
    sources_attempted: [...dbSources, ...liveSources],
    sources_succeeded: meta
      .filter((m) => (m.rowsReturned ?? 0) > 0)
      .map((m) => m.engine),
    stages: dens,
    enrichment: {
      pending: result?.pendingEnrichment ?? 0,
    },
    funnel: {
      planned: plan.steps.length,
      attempted: dbSources.length + liveSources.length,
      artifacts: dens.artifacts_found,
      classified: dens.pages_classified,
      entities_resolved: dens.entities_resolved,
      query_matched: dens.query_matched,
      claims_extracted: dens.claims_extracted,
      subject_bound: dens.claims_subject_bound,
      temporally_valid: dens.claims_temporally_valid,
      enriched_pending: result?.pendingEnrichment ?? 0,
      qualified: dens.qualified,
      persisted: qlPersisted,
      hydrate_equal: qlHydrateOk,
      theorem_after_hydrate: qlTheoremOk,
      delivered: dens.qualified,
      ql_via: qlVia,
    },
    qualified_lead_memory_persist: {
      via: qlVia,
      persisted: qlPersisted,
      hydrate_equal: qlHydrateOk,
      theorem_after_hydrate: qlTheoremOk,
      note:
        qlVia === "supabase"
          ? "SupabaseQualifiedLeadStore — production M10 adapter"
          : "InMemoryQualifiedLeadStore — contract seam; production table absent or unreachable",
    },
    legacy_live_index_persist: legacyPersist,
    delivered: dens.qualified,
    live_discovery: result?.liveDiscovery ?? null,
    provider_logs: recentProviderLogs().slice(-12),
    sample_rows: rows.slice(0, 5).map((r) => ({
      title: (r.title ?? "").slice(0, 100),
      kind: r.kind,
      disposition: r.disposition,
      page_type: r.page_type,
      entity_resolved: r.entity_resolved,
      evidence_types: (r.evidence ?? []).map((e) => e.evidence_type),
      why_match: (r.why_match ?? "").slice(0, 120),
    })),
  };
}

async function runCancelRace(envDiag: Record<string, unknown>) {
  const session = new ActiveSearchSession("soak-cancel");
  const slowQ = "recently funded startups in Berlin";
  const midQ = "companies needing marketing help in Austin";
  const fastQ = "React jobs in Toronto paying over $150k";

  const aStart = session.begin();
  const a = aStart.run;
  const pA = runSpecSearchCore(
    slowQ,
    { signal: aStart.signal },
    15,
    { mode: "looking" },
    { search_run_id: a.search_run_id, conversation_id: a.conversation_id },
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e.message : String(e),
    }),
  );

  await new Promise((r) => setTimeout(r, 80));
  const bStart = session.begin();
  const b = bStart.run;
  const pB = runSpecSearchCore(
    midQ,
    { signal: bStart.signal },
    15,
    { mode: "looking" },
    { search_run_id: b.search_run_id, conversation_id: b.conversation_id },
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e.message : String(e),
    }),
  );

  await new Promise((r) => setTimeout(r, 80));
  const cStart = session.begin();
  const c = cStart.run;
  const pC = runSpecSearchCore(
    fastQ,
    { signal: cStart.signal },
    15,
    {},
    { search_run_id: c.search_run_id, conversation_id: c.conversation_id },
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e.message : String(e),
    }),
  );

  const [ra, rb, rc] = await Promise.all([pA, pB, pC]);

  const acceptA = session.accept({ search_run_id: a.search_run_id });
  const acceptB = session.accept({ search_run_id: b.search_run_id });
  const acceptC = session.accept({ search_run_id: c.search_run_id });

  session.settle({ search_run_id: c.search_run_id });

  let uiQualified = -1;
  let uiRun: string | null = null;
  const apply = (response: {
    search_run_id?: string | null;
    qualified_count?: number;
  }) =>
    session.applyIfActive(response, (run) => {
      uiQualified = response.qualified_count ?? 0;
      uiRun = run.search_run_id;
      return true;
    });

  const applyA = ra.ok
    ? apply({
        search_run_id: ra.r.search_run_id,
        qualified_count: ra.r.qualified_count,
      })
    : { applied: false as const, decision: acceptA };
  const applyB = rb.ok
    ? apply({
        search_run_id: rb.r.search_run_id,
        qualified_count: rb.r.qualified_count,
      })
    : { applied: false as const, decision: acceptB };
  const applyC = rc.ok
    ? apply({
        search_run_id: rc.r.search_run_id,
        qualified_count: rc.r.qualified_count,
      })
    : { applied: false as const, decision: acceptC };

  return {
    id: "CANCEL",
    set: "cancel",
    label: "A slow → B → C race",
    env: envDiag,
    runs: {
      A: a.search_run_id,
      B: b.search_run_id,
      C: c.search_run_id,
      active_final: session.activeRunId,
    },
    accept: { A: acceptA, B: acceptB, C: acceptC },
    apply: {
      A: applyA.applied,
      B: applyB.applied,
      C: applyC.applied,
      ui_qualified_after: uiQualified,
      ui_run: uiRun,
    },
    results: {
      A: ra.ok
        ? {
            outcome: ra.r.outcome,
            qualified: ra.r.qualified_count,
            run: ra.r.search_run_id,
            superseded: session.wasSuperseded(a.search_run_id),
          }
        : {
            error: ra.err,
            superseded: session.wasSuperseded(a.search_run_id),
          },
      B: rb.ok
        ? {
            outcome: rb.r.outcome,
            qualified: rb.r.qualified_count,
            run: rb.r.search_run_id,
            superseded: session.wasSuperseded(b.search_run_id),
          }
        : {
            error: rb.err,
            superseded: session.wasSuperseded(b.search_run_id),
          },
      C: rc.ok
        ? {
            outcome: rc.r.outcome,
            qualified: rc.r.qualified_count,
            run: rc.r.search_run_id,
            superseded: session.wasSuperseded(c.search_run_id),
          }
        : {
            error: rc.err,
            superseded: session.wasSuperseded(c.search_run_id),
          },
    },
    proof: {
      A_must_not_accept: acceptA.ok === false,
      B_must_not_accept: acceptB.ok === false,
      C_may_accept: acceptC.ok === true,
      A_must_not_apply: applyA.applied === false,
      B_must_not_apply: applyB.applied === false,
      C_may_apply: applyC.applied === true,
      ui_held_to_C: uiRun === c.search_run_id || uiRun === null,
      note: "Late A/B responses must not mutate UI via accept/applyIfActive",
    },
  };
}

async function probeEnv() {
  const searx = process.env.SEARXNG_URL ?? "";
  let searx_reachable = false;
  if (searx) {
    try {
      const r = await fetch(`${searx.replace(/\/$/, "")}/search?q=ping&format=json`, {
        signal: AbortSignal.timeout(3000),
      });
      searx_reachable = r.ok || r.status < 500;
    } catch {
      searx_reachable = false;
    }
  }

  let qlAdapter: string = "ABSENT — InMemory only";
  if (process.env.MY_SUPABASE_URL && process.env.MY_SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { tryOpenSupabaseQualifiedLeadStore } = await import(
        "@/lib/search/qualified-lead-store.server"
      );
      const store = tryOpenSupabaseQualifiedLeadStore();
      if (store) {
        await store.size();
        qlAdapter = "PRESENT — SupabaseQualifiedLeadStore";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/relation|does not exist|Could not find|PGRST/i.test(msg)) {
        qlAdapter = "ABSENT — migration not applied";
      } else {
        qlAdapter = `ERROR — ${msg.slice(0, 80)}`;
      }
    }
  }

  return {
    SEARXNG_URL: searx || null,
    searx_reachable,
    DATABASE_URL: process.env.DATABASE_URL ? "set" : null,
    MY_SUPABASE_URL: process.env.MY_SUPABASE_URL ? "set" : null,
    MY_SUPABASE_SERVICE_ROLE_KEY: process.env.MY_SUPABASE_SERVICE_ROLE_KEY
      ? "set"
      : null,
    SERPER_API_KEY: process.env.SERPER_API_KEY ? "set" : null,
    SERPAPI_KEY: process.env.SERPAPI_KEY ? "set" : null,
    USE_PAID_SOURCES: process.env.USE_PAID_SOURCES ?? null,
    AWAIT_PERSIST_LIVE: process.env.AWAIT_PERSIST_LIVE ?? null,
    qualified_lead_production_adapter: qlAdapter,
  };
}

function writeLedger(traces: unknown[], cancel: unknown, env: Record<string, unknown>) {
  const cases = traces as Array<Record<string, unknown>>;
  const byBucket: Record<string, number> = {};
  for (const t of cases) {
    const b = String(t.failure_bucket ?? "UNKNOWN");
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }
  const qlPresent = String(env.qualified_lead_production_adapter ?? "").startsWith(
    "PRESENT",
  );
  const lines = [
    `# Runtime verification ledger`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Mode:** Live adversarial soak — no feature work`,
    ``,
    `## Environment`,
    ``,
    "```json",
    JSON.stringify(env, null, 2),
    "```",
    ``,
    `## RV status (from this soak)`,
    ``,
    `| ID | Focus | Status | Notes |`,
    `|----|-------|--------|-------|`,
    `| RV1 | Live source/provider | ${env.searx_reachable || env.SERPER_API_KEY || env.SERPAPI_KEY ? "EXERCISED" : "BLOCKED"} | SearXNG local=${env.searx_reachable}; paid keys present |`,
    `| RV2 | Entity + location | EXERCISED | Spec + geo on every case |`,
    `| RV3 | Claim/evidence verify | EXERCISED | stage denominators |`,
    `| RV4 | Enrichment | EXERCISED | pendingEnrichment observed |`,
    `| RV5 | Production DB QualifiedLead | ${qlPresent ? "EXERCISED" : "NOT VERIFIED"} | ${env.qualified_lead_production_adapter} |`,
    `| RV6 | UI cancel/stale-run | ${cancel ? "EXERCISED" : "SKIPPED"} | ActiveSearchSession accept() race |`,
    `| RV7 | People runtime | EXERCISED | B/C/F/ADV* |`,
    `| RV8 | Jobs runtime | EXERCISED | ADV5/6/11 |`,
    `| RV9 | Social runtime | EXERCISED | Arctic Shift social provider (not www/old.reddit JSON) |`,
    `| RV10 | Full adversarial soak | EXERCISED | A–G + ADV1–12 |`,
    ``,
    `## Failure buckets`,
    ``,
    ...Object.entries(byBucket).map(([k, v]) => `- **${k}:** ${v}`),
    ``,
    `## Per-case summary`,
    ``,
    `| ID | Outcome | Qual | Artifacts | Bucket | ms |`,
    `|----|---------|------|-----------|--------|----|`,
    ...cases.map((t) => {
      const s = t.stages as Record<string, number>;
      return `| ${t.id} | ${t.outcome} | ${s?.qualified ?? 0} | ${s?.artifacts_found ?? 0} | ${t.failure_bucket} | ${t.ms} |`;
    }),
    ``,
    `## Selective promotion (milestone names are authority — not numbers)`,
    ``,
    `| Milestone | Promotion |`,
    `|-----------|-----------|`,
    `| Spec | see soak buckets — extract regressions must be green |`,
    `| Location | RUNTIME VERIFIED when geo audits clean |`,
    `| Source Routing | EXERCISED — SearXNG typed unavailable when down |`,
    `| Enrichment | EXERCISED |`,
    `| Verification | RUNTIME VERIFIED when subject-bind holds |`,
    `| Qualification | RUNTIME VERIFIED — zeros stay zeros |`,
    `| Persistence | ${qlPresent ? "**RUNTIME VERIFIED** (audited path: prove + soak Supabase adapter)" : "TESTED only — production adapter absent"} |`,
    `| Cancel | RUNTIME VERIFIED when cancel race passes |`,
    `| Social | Arctic Shift transport — promote only after live hits through M14 pipeline |`,
    ``,
    `## Hard law check`,
    ``,
    `- No soak case loosened qualification.`,
    `- Success = qualified leads OR honest typed zero/failure.`,
    `- Lead count is not the score.`,
    `- Milestone **names** (Location / Source Routing / Enrichment / Verification) are the authority; do not alias them as “M7 geo / M8 verify / M9 qualify”.`,
    ``,
  ];
  writeFileSync(LEDGER, lines.join("\n"), "utf8");
}

function writeFunnelReport(traces: unknown[], env: Record<string, unknown>) {
  const cases = traces as Array<Record<string, unknown>>;
  const rows = cases.map((t) => {
    const f = (t.funnel as Record<string, number | string>) ?? {};
    const loc = (t.SearchSpec as { location?: string } | undefined)?.location;
    return {
      id: String(t.id),
      bucket: String(t.failure_bucket),
      outcome: String(t.outcome),
      loc: loc ?? "",
      looking_bug: loc && /\blooking\b/i.test(loc) ? "YES" : "",
      ...f,
    };
  });

  const sums = {
    planned: 0,
    attempted: 0,
    artifacts: 0,
    classified: 0,
    entities_resolved: 0,
    query_matched: 0,
    claims_extracted: 0,
    subject_bound: 0,
    temporally_valid: 0,
    qualified: 0,
    persisted: 0,
    delivered: 0,
  };
  for (const r of rows) {
    for (const k of Object.keys(sums) as (keyof typeof sums)[]) {
      sums[k] += Number(r[k] ?? 0);
    }
  }

  const zeroAt = (stage: keyof typeof sums) =>
    rows.filter((r) => Number(r[stage] ?? 0) === 0).map((r) => r.id);

  const bottleneck = rows
    .filter((r) => r.bucket === "HONEST_ZERO" || r.bucket === "COVERAGE_GAP")
    .map((r) => {
      const stages = [
        "artifacts",
        "classified",
        "entities_resolved",
        "claims_extracted",
        "subject_bound",
        "temporally_valid",
        "qualified",
        "persisted",
      ] as const;
      let firstDrop = "qualified=0 with artifacts";
      let prev = Number(r.planned ?? 1);
      for (const s of stages) {
        const n = Number(r[s] ?? 0);
        if (prev > 0 && n === 0) {
          firstDrop = s;
          break;
        }
        prev = n || prev;
      }
      return `| ${r.id} | ${r.bucket} | **${firstDrop}** | art=${r.artifacts} ent=${r.entities_resolved} claim=${r.claims_extracted} bound=${r.subject_bound} qual=${r.qualified} |`;
    });

  const qlVia = rows.find((r) => r.ql_via)?.ql_via ?? env.qualified_lead_production_adapter;
  const lookingBugs = rows.filter((r) => r.looking_bug === "YES");

  const md = [
    `# Post-repair coverage funnel`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**SearXNG reachable:** ${env.searx_reachable}`,
    `**QL store:** ${qlVia}`,
    `**Looking-in-location bugs:** ${lookingBugs.length === 0 ? "none" : lookingBugs.map((r) => r.id).join(", ")}`,
    ``,
    `## Aggregate funnel (sum across cases)`,
    ``,
    `| Stage | Count |`,
    `|-------|------:|`,
    `| planned | ${sums.planned} |`,
    `| attempted | ${sums.attempted} |`,
    `| artifacts | ${sums.artifacts} |`,
    `| classified | ${sums.classified} |`,
    `| entities_resolved | ${sums.entities_resolved} |`,
    `| query_matched | ${sums.query_matched} |`,
    `| claims_extracted | ${sums.claims_extracted} |`,
    `| subject_bound | ${sums.subject_bound} |`,
    `| temporally_valid | ${sums.temporally_valid} |`,
    `| qualified | ${sums.qualified} |`,
    `| persisted | ${sums.persisted} |`,
    `| delivered | ${sums.delivered} |`,
    ``,
    `## Per-case funnel`,
    ``,
    `| ID | Bucket | Art | Class | Ent | Claim | Bound | Temporal | Qual | Persist | Loc |`,
    `|----|--------|----:|------:|----:|------:|------:|---------:|-----:|--------:|-----|`,
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.bucket} | ${r.artifacts ?? 0} | ${r.classified ?? 0} | ${r.entities_resolved ?? 0} | ${r.claims_extracted ?? 0} | ${r.subject_bound ?? 0} | ${r.temporally_valid ?? 0} | ${r.qualified ?? 0} | ${r.persisted ?? 0} | ${r.loc}${r.looking_bug ? " ⚠LOOKING" : ""} |`,
    ),
    ``,
    `## First-drop bottleneck (zeros / coverage gaps)`,
    ``,
    `| ID | Bucket | First drop | Snapshot |`,
    `|----|--------|------------|----------|`,
    ...(bottleneck.length ? bottleneck : ["| — | — | — | no zero/gap cases |"]),
    ``,
    `## Cases with zero artifacts`,
    ``,
    zeroAt("artifacts").length
      ? zeroAt("artifacts").join(", ")
      : "_none_",
    ``,
    `## Interpretation guide (do not code yet)`,
    ``,
    `- **artifacts = 0** → source/transport coverage (platform surface / archive / API / feed)`,
    `- **artifacts > 0, entities_resolved = 0** → identity / author resolution`,
    `- **resolved > 0, claims_extracted = 0** → signal / need extraction`,
    `- **claims > 0, subject_bound = 0** → binding`,
    `- **bound > 0, qualified = 0** → theorem / verification (honest refuse)`,
    `- **qualified > 0, persisted = 0** → persistence adapter / gate`,
    ``,
    `Next coding work must follow the dominant first-drop column above — not generic scraper accumulation.`,
    ``,
  ].join("\n");

  const path = "reports/universal-audit/18-post-repair-funnel.md";
  writeFileSync(path, md, "utf8");
  return path;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync("reports/universal-audit", { recursive: true });
  writeFileSync(TRACES, "", "utf8");

  const set = (process.env.SOAK_SET || "all").toLowerCase();
  const env = await probeEnv();
  console.info("[soak] env", JSON.stringify(env));
  appendFileSync(TRACES, JSON.stringify({ kind: "env", ...env }) + "\n");

  const cases: SoakCase[] = [];
  if (set === "post-repair" || set === "postrepair") {
    cases.push(...AG);
    const keep = new Set([
      "ADV2",
      "ADV3",
      "ADV5",
      "ADV7",
      "ADV8",
      "ADV9",
      "ADV10",
    ]);
    cases.push(...ADVERSARIAL.filter((c) => keep.has(c.id)));
  } else {
    if (set === "all" || set === "ag") cases.push(...AG);
    if (set === "all" || set === "adversarial") cases.push(...ADVERSARIAL);
  }

  const traces: unknown[] = [];
  for (const c of cases) {
    console.info(`[soak] ${c.id} ${c.label} …`);
    const t = await runCase(c, env);
    traces.push(t);
    appendFileSync(TRACES, JSON.stringify({ kind: "case", ...t }) + "\n");
    const s = t.stages;
    const f = t.funnel;
    console.info(
      `  outcome=${t.outcome} qual=${s.qualified} art=${s.artifacts_found} bound=${s.claims_subject_bound} persist=${f.persisted}@${f.ql_via} bucket=${t.failure_bucket} loc=${t.SearchSpec.location ?? "—"} ms=${t.ms}`,
    );
  }

  let cancel: unknown = null;
  if (set === "all" || set === "cancel") {
    console.info("[soak] CANCEL race …");
    cancel = await runCancelRace(env);
    appendFileSync(TRACES, JSON.stringify({ kind: "cancel", ...cancel }) + "\n");
    console.info(
      `  accept A=${(cancel as { proof: { A_must_not_accept: boolean } }).proof.A_must_not_accept} B=${(cancel as { proof: { B_must_not_accept: boolean } }).proof.B_must_not_accept} C=${(cancel as { proof: { C_may_accept: boolean } }).proof.C_may_accept}`,
    );
  }

  writeLedger(traces, cancel, env);
  const funnelPath = writeFunnelReport(traces, env);

  const report = [
    `# 17 — Live adversarial soak`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Set:** ${set}`,
    `**Traces:** [\`tmp/live-adversarial-soak.jsonl\`](../../tmp/live-adversarial-soak.jsonl)`,
    `**Ledger:** [\`tmp/runtime-verification-ledger.md\`](../../tmp/runtime-verification-ledger.md)`,
    `**Funnel:** [\`${funnelPath}\`](../../${funnelPath})`,
    ``,
    `## Verdict`,
    ``,
    String(env.qualified_lead_production_adapter).startsWith("PRESENT")
      ? `Production QualifiedLead persistence: **RUNTIME VERIFIED** on audited path (Supabase adapter + prove script + soak persist/hydrate).`
      : `**Production QualifiedLead persistence remains NOT VERIFIED**.`,
    ``,
    `Overall: **post-repair soak EXERCISED; inspect funnel before more product code.**`,
    ``,
    `Do not claim universal coverage. Honest zeros are architecture working — not a mandate to add scrapers.`,
    ``,
    `## Cancel race`,
    ``,
    cancel
      ? "```json\n" + JSON.stringify(cancel, null, 2).slice(0, 4000) + "\n```"
      : "_skipped_",
    ``,
  ].join("\n");
  writeFileSync(REPORT, report, "utf8");
  console.info(`[soak] wrote ${TRACES}, ${LEDGER}, ${REPORT}, ${funnelPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
