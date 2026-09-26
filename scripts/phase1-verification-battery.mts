/**
 * Phase 1 independent verification battery (audit-only tooling).
 * Writes tmp/phase1-verification-traces.jsonl — does not modify product code.
 *
 * Run: npx tsx --env-file=.env scripts/phase1-verification-battery.mts
 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { runSpecSearchCore, type SpecRow } from "@/lib/spec-search.functions";
import { clearProviderLogs, recentProviderLogs } from "@/lib/search/provider-ladder";
import type { DbHitMeta } from "@/lib/canonical/read-parquet.server";

const OUT = "tmp/phase1-verification-traces.jsonl";

function field(spec: ReturnType<typeof extractSearchSpec>, f: string) {
  return spec.criteria.find((c) => c.field === f)?.value ?? null;
}

function classifyWhy(why: string | null | undefined): string {
  if (!why) return "absent";
  if (/^Live web result/i.test(why)) return "live_host_template";
  if (/^Hiring (signal|evidence)/i.test(why)) return "evidence_hiring";
  if (/^Service need|^Social ask|^Funding /i.test(why)) return "evidence_signal";
  if (/^No website/i.test(why)) return "evidence_opportunity";
  if (/public phone|email on file|listed site|Directory match/i.test(why))
    return "directory_field_template";
  return "other_or_richer";
}

function enginesOf(meta: DbHitMeta[]) {
  return [...new Set(meta.map((m) => m.engine).filter(Boolean))];
}

function sample(rows: SpecRow[], n = 5) {
  return rows.slice(0, n).map((r) => ({
    kind: r.kind,
    title: (r.title ?? "").slice(0, 120),
    url: r.url ?? null,
    why_match: r.why_match ?? null,
    why_class: classifyWhy(r.why_match),
    disposition: r.disposition ?? null,
    relevance_score: r.relevance_score ?? null,
    intent_score: r.intent_score ?? null,
    evidence_types: (r.evidence ?? []).map((e) => e.evidence_type),
    evidence_excerpts: (r.evidence ?? []).map((e) => (e.excerpt ?? "").slice(0, 100)),
    evidence_urls: (r.evidence ?? []).map((e) => e.source_url),
    verification_status: r.verification_status ?? null,
    key: r.key ?? null,
  }));
}

function writeLine(obj: unknown) {
  appendFileSync(OUT, JSON.stringify(obj) + "\n", "utf8");
}

/** Extract-only adversarial / synonym / ambiguity cases. */
function runExtractBattery() {
  const cases: Array<{ id: string; query: string; expect?: Record<string, unknown> }> = [
    { id: "adv-plural-websites", query: "restaurants needing websites" },
    { id: "adv-plural-developers", query: "founders needing developers" },
    { id: "adv-plural-marketers", query: "companies needing marketers" },
    { id: "adv-plural-copywriters", query: "people looking for copywriters" },
    { id: "adv-syn-needs", query: "restaurants that need websites" },
    { id: "adv-syn-looking", query: "restaurants looking for website help" },
    { id: "adv-syn-seeking", query: "companies seeking marketing help" },
    { id: "adv-syn-hiring", query: "companies hiring copywriters" },
    { id: "adv-syn-requires", query: "businesses that require SEO" },
    { id: "adv-amb-marketing-co", query: "marketing companies in Austin" },
    { id: "adv-amb-need-marketing", query: "companies needing marketing" },
    { id: "adv-amb-web-agency", query: "web agencies in Toronto" },
    { id: "adv-amb-need-websites", query: "companies needing websites" },
    { id: "adv-amb-dev-companies", query: "developer companies in SF" },
    { id: "adv-amb-hiring-devs", query: "companies hiring developers" },
    { id: "adv-funding-berlin", query: "recently funded startups in Berlin" },
    { id: "adv-funding-toronto", query: "recently funded startups in Toronto" },
    { id: "adv-funding-seed", query: "startups that raised a seed round" },
    { id: "neg-directory-gyms", query: "gyms in Toronto" },
    { id: "neg-directory-saas", query: "SaaS companies in Europe" },
  ];

  for (const c of cases) {
    const spec = extractSearchSpec(c.query);
    const industry = field(spec, "industry");
    const category = field(spec, "category");
    writeLine({
      kind: "extract",
      id: c.id,
      query: c.query,
      entity: spec.entity,
      signal_required: spec.signal_required,
      signal_types: spec.signal_types,
      industry,
      category,
      requested_service: field(spec, "requested_service"),
      requested_role: field(spec, "requested_role"),
      requested_product: field(spec, "requested_product"),
      opportunity: field(spec, "opportunity"),
      funding_status: field(spec, "funding_status"),
      location: field(spec, "location"),
      criteria: spec.criteria,
      // Semantic direction checks
      industry_is_marketing: (industry ?? "").toLowerCase() === "marketing",
      need_vs_identity_ok:
        c.id === "adv-amb-need-marketing"
          ? (industry ?? "").toLowerCase() !== "marketing" &&
            !!field(spec, "requested_service")
          : c.id === "adv-amb-marketing-co"
            ? true // may set industry marketing as identity — expected different
            : null,
    });
  }
}

const AG = [
  { id: "A", label: "Toronto restaurants needing websites", query: "Toronto restaurants needing websites", answers: { mode: "selling", offer: "websites" } },
  { id: "B", label: "Copywriting demand", query: "people looking for copywriters", answers: { mode: "looking" } },
  { id: "C", label: "Founders needing developers", query: "founders needing developers in San Francisco", answers: { mode: "looking" } },
  { id: "D", label: "Companies needing marketing", query: "companies needing marketing help in Austin", answers: { mode: "looking" } },
  { id: "E", label: "Recently funded startups", query: "recently funded startups in Berlin", answers: { mode: "looking" } },
  { id: "F", label: "People asking for web help", query: "people asking for website help", answers: { mode: "looking" } },
  { id: "G", label: "Companies hiring copywriters", query: "companies hiring copywriters in New York", answers: { mode: "looking" } },
];

async function runOneRuntime(c: (typeof AG)[0]) {
  clearProviderLogs();
  const parsed = extractSearchSpec(c.query);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runSpecSearchCore>>;
  try {
    result = await runSpecSearchCore(c.query, {}, 25, c.answers);
  } catch (e) {
    writeLine({
      kind: "runtime",
      id: c.id,
      label: c.label,
      query: c.query,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
      parsed: {
        entity: parsed.entity,
        signal_required: parsed.signal_required,
        criteria: parsed.criteria,
      },
    });
    return;
  }
  const ms = Date.now() - started;
  const meta = result.dbMeta ?? [];
  const liveKeys = result.rows.filter((r) => (r.key ?? "").startsWith("live-"));
  const directoryOnly = result.rows.filter(
    (r) => !(r.key ?? "").startsWith("live-") && !(r.evidence?.length),
  );
  const wrongClaimC =
    c.id === "C"
      ? result.rows.filter((r) => (r.evidence ?? []).some((e) => e.evidence_type === "funding"))
      : [];
  const aggregatorE =
    c.id === "E"
      ? result.rows.filter((r) =>
          /list|directory|best startups|vcbacked|seedtable|projectstartups|handpicked/i.test(
            r.title ?? "",
          ),
        )
      : [];

  // Persist probe
  const { stampVerified, persistVerifiedLiveRows, isVerifiedForPersist } = await import(
    "@/lib/canonical/persist-live.server"
  );
  const stamped = stampVerified(result.rows);
  const liveOnly = stamped.filter(
    (r) =>
      (r.key ?? "").startsWith("live-web:") ||
      (r.key ?? "").startsWith("live-social:") ||
      (r.key ?? "").startsWith("live-osm:"),
  );
  const verified = liveOnly.filter(isVerifiedForPersist);
  const pr = await persistVerifiedLiveRows(liveOnly);
  let roundTrip = 0;
  if (pr.keys.length) {
    try {
      const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
      const admin = getAdmin();
      for (const key of pr.keys.slice(0, 5)) {
        for (const table of ["idx_companies", "idx_businesses", "idx_people"] as const) {
          const { data } = await admin.from(table).select("registry_key").eq("registry_key", key).maybeSingle();
          if (data) {
            roundTrip += 1;
            break;
          }
        }
      }
    } catch {
      /* round-trip unavailable */
    }
  }

  const logs = recentProviderLogs();
  writeLine({
    kind: "runtime",
    id: c.id,
    label: c.label,
    query: c.query,
    ms,
    parsed: {
      entity: parsed.entity,
      signal_required: parsed.signal_required,
      industry: field(parsed, "industry"),
      requested_service: field(parsed, "requested_service"),
      requested_role: field(parsed, "requested_role"),
      opportunity: field(parsed, "opportunity"),
      funding_status: field(parsed, "funding_status"),
      criteria: parsed.criteria,
    },
    after_answers: {
      entity: result.spec.entity,
      signal_required: result.spec.signal_required,
      criteria: result.spec.criteria,
    },
    engines: enginesOf(meta),
    live_engines: enginesOf(meta).filter((e) => String(e).startsWith("live-")),
    live_discovery: result.liveDiscovery,
    final_rows: result.rows.length,
    live_rows_in_page: liveKeys.length,
    directory_rows_without_evidence: directoryOnly.length,
    why_classes: [...new Set(result.rows.map((r) => classifyWhy(r.why_match)))],
    sample_rows: sample(result.rows),
    adversarial_notes: {
      c_funding_evidence_on_developer_need: wrongClaimC.map((r) => r.title?.slice(0, 80)),
      e_aggregator_titles: aggregatorE.map((r) => r.title?.slice(0, 80)),
      d_industry_marketing: field(result.spec, "industry")?.toLowerCase() === "marketing",
    },
    provider_logs: logs.slice(-8),
    free_first: {
      searxng_used: logs.some((l) => l.provider_used === "searxng" || l.cost_class === "self_hosted"),
      paid_success: logs.some((l) => l.cost_class === "paid" && l.success),
      paid_skipped: logs.some((l) => l.provider_used === "paid-serp-skipped"),
    },
    persist: {
      verified_candidates: verified.length,
      attempted: pr.attempted,
      persisted: pr.persisted,
      skipped: pr.skipped,
      via: pr.via ?? null,
      error: pr.error ?? null,
      keys_sample: pr.keys.slice(0, 5),
      round_trip_found: roundTrip,
    },
    social_meta: enginesOf(meta).filter((e) => String(e).includes("social")),
  });
}

async function main() {
  mkdirSync("tmp", { recursive: true });
  writeFileSync(OUT, "", "utf8");
  writeLine({
    kind: "meta",
    at: new Date().toISOString(),
    purpose: "phase1-independent-verification",
    SEARXNG_URL: process.env.SEARXNG_URL ? "set" : "absent",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "absent",
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL ? "set" : "absent",
    SPEC_SEARCH_ENABLED: process.env.SPEC_SEARCH_ENABLED ?? "(unset)",
    USE_PAID_SOURCES: process.env.USE_PAID_SOURCES ?? "(unset)",
  });

  console.log("[phase1-verify] extract battery…");
  runExtractBattery();

  for (const c of AG) {
    console.log(`[phase1-verify] runtime ${c.id} ${c.label}…`);
    await runOneRuntime(c);
  }

  // Free-first dedicated probe: ensure paid not required on a thin company query
  clearProviderLogs();
  console.log("[phase1-verify] free-first probe…");
  await runSpecSearchCore("companies hiring copywriters in New York", {}, 10, {
    mode: "looking",
  });
  const ff = recentProviderLogs();
  writeLine({
    kind: "free_first_probe",
    provider_logs: ff,
    paid_provider_called: ff.some((l) => l.cost_class === "paid" && l.success),
    free_provider_used: ff.some(
      (l) => l.cost_class === "self_hosted" || l.provider_used === "searxng",
    ),
  });

  // Social provider attempt (capability)
  console.log("[phase1-verify] social provider probe…");
  try {
    const { redditSocialProvider, socialQueryFromSpec } = await import(
      "@/lib/search/social-signal"
    );
    const spec = extractSearchSpec("people looking for copywriters");
    const q = socialQueryFromSpec(spec);
    let hits: unknown[] = [];
    let err: string | null = null;
    try {
      hits = await redditSocialProvider.search(spec, 5);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    writeLine({
      kind: "social_probe",
      provider_id: redditSocialProvider.id,
      query: q,
      hit_count: hits.length,
      error: err,
      fabricated: false,
      capability_executed: true,
      request_level_ok: !err || hits.length > 0,
    });
  } catch (e) {
    writeLine({
      kind: "social_probe",
      error: e instanceof Error ? e.message : String(e),
      capability_executed: false,
    });
  }

  console.log(`[phase1-verify] wrote → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
