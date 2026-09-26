/**
 * Post-implementation reality check — Tests A–G (audit-only).
 * Run: npx tsx --env-file=.env scripts/reality-check-traces.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { runSpecSearchCore, type SpecRow } from "@/lib/spec-search.functions";
import type { DbHitMeta } from "@/lib/canonical/read-parquet.server";

const LOOK = { mode: "looking" };
const SELL_WEB = { mode: "selling", offer: "websites" };

interface Case {
  id: string;
  label: string;
  query: string;
  answers: Record<string, string>;
}

const CASES: Case[] = [
  { id: "A", label: "Toronto restaurants needing websites", query: "Toronto restaurants needing websites", answers: SELL_WEB },
  { id: "B", label: "Copywriting demand", query: "people looking for copywriters", answers: LOOK },
  { id: "C", label: "Founders needing developers", query: "founders needing developers in San Francisco", answers: LOOK },
  { id: "D", label: "Companies needing marketing", query: "companies needing marketing help in Austin", answers: LOOK },
  { id: "E", label: "Recently funded startups", query: "recently funded startups in Berlin", answers: LOOK },
  { id: "F", label: "People asking for web help", query: "people asking for website help", answers: LOOK },
  { id: "G", label: "Companies hiring copywriters", query: "companies hiring copywriters in New York", answers: LOOK },
];

function enginesOf(meta: DbHitMeta[]): string[] {
  return [...new Set(meta.map((m) => m.engine).filter(Boolean))];
}
function dbEngines(meta: DbHitMeta[]) {
  return enginesOf(meta).filter((e) => !String(e).startsWith("live-"));
}
function liveEngines(meta: DbHitMeta[]) {
  return enginesOf(meta).filter((e) => String(e).startsWith("live-"));
}
function sampleRows(rows: SpecRow[], n = 5) {
  return rows.slice(0, n).map((r) => ({
    kind: r.kind,
    title: (r.title ?? "").slice(0, 120),
    url: r.url ?? null,
    email: r.email ? "[present]" : null,
    phone: r.phone ? "[present]" : null,
    why_match: r.why_match ?? null,
    why_class: classifyWhyMatch(r.why_match),
    complete: r.complete ?? null,
    soft_duplicate: r.soft_duplicate ?? false,
    key: r.key ?? null,
    disposition: r.disposition ?? null,
    relevance_score: r.relevance_score ?? null,
    intent_score: r.intent_score ?? null,
    evidence_types: (r.evidence ?? []).map((e) => e.evidence_type),
    verification_status: r.verification_status ?? null,
  }));
}
function classifyWhyMatch(why: string | null | undefined): string {
  if (!why) return "absent";
  if (/^Live web result/i.test(why)) return "live_host_template";
  if (/^Active posting/i.test(why)) return "job_board_template";
  if (/^Hiring (signal|evidence)/i.test(why)) return "evidence_hiring";
  if (/^Service need|^Social ask|^Funding /i.test(why)) return "evidence_signal";
  if (/^No website/i.test(why)) return "evidence_opportunity";
  if (/No website listed/i.test(why)) return "opportunity_template";
  if (/public phone|email on file|listed site|Directory match/i.test(why)) return "directory_field_template";
  if (/ · /.test(why) && why.split(" · ").length <= 4) return "criteria_join_template";
  return "other_or_richer";
}

async function runOne(c: Case) {
  const parsed = extractSearchSpec(c.query);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runSpecSearchCore>>;
  try {
    result = await runSpecSearchCore(c.query, {}, 25, c.answers);
  } catch (e) {
    return {
      id: c.id,
      label: c.label,
      raw_query: c.query,
      answers: c.answers,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
      parsed_specification: {
        entity: parsed.entity,
        status: parsed.status,
        signal_required: parsed.signal_required,
        missing: parsed.missing,
        criteria: parsed.criteria,
      },
    };
  }
  const ms = Date.now() - started;
  const meta = result.dbMeta ?? [];
  const liveMeta = meta.filter((m) => String(m.engine).startsWith("live-"));
  const dbMetaOnly = meta.filter((m) => !String(m.engine).startsWith("live-"));
  const whyClasses = [...new Set(result.rows.map((r) => classifyWhyMatch(r.why_match)))];
  const liveKeys = result.rows.filter((r) => (r.key ?? "").startsWith("live-"));

  // Explicit persist + round-trip (idempotent; core already awaited when AWAIT_PERSIST_LIVE=1).
  const { stampVerified, persistVerifiedLiveRows, isVerifiedForPersist } = await import(
    "@/lib/canonical/persist-live.server",
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
          const { data } = await admin
            .from(table)
            .select("registry_key")
            .eq("registry_key", key)
            .maybeSingle();
          if (data?.registry_key) {
            roundTrip += 1;
            break;
          }
        }
      }
    } catch {
      /* round-trip optional */
    }
  }

  const written = pr.persisted > 0;
  let conclusion: string;
  if (written) {
    conclusion = `live → DB write-back YES (${pr.persisted} upserted via ${pr.via ?? "?"}; round-trip ${roundTrip})`;
  } else if (verified.length) {
    conclusion = `verified candidates=${verified.length} but persist=${pr.persisted}${pr.error ? ` err=${pr.error}` : ""}`;
  } else if (liveOnly.length) {
    conclusion = "live rows present but none VERIFIED for persist";
  } else {
    conclusion = "no live-* keys kept on final page";
  }

  return {
    id: c.id,
    label: c.label,
    raw_query: c.query,
    answers: c.answers,
    ms,
    parsed_specification: {
      entity: parsed.entity,
      status: parsed.status,
      signal_required: parsed.signal_required,
      missing: parsed.missing,
      criteria: parsed.criteria,
      signal_types: parsed.signal_types,
    },
    after_answers_spec: {
      entity: result.spec.entity,
      status: result.spec.status,
      signal_required: result.spec.signal_required,
      missing: result.spec.missing,
      criteria: result.spec.criteria,
    },
    clarifications: result.clarify.map((q) => ({ id: q.id, prompt: (q.prompt ?? "").slice(0, 160) })),
    questions: result.questions,
    db_sources: dbEngines(meta),
    db_meta: dbMetaOnly,
    db_rows_reported: dbMetaOnly.reduce((s, m) => s + (m.rowsReturned ?? 0), 0),
    live_sources: liveEngines(meta),
    live_meta: liveMeta,
    live_rows_reported: liveMeta.reduce((s, m) => s + (m.rowsReturned ?? 0), 0),
    live_discovery: result.liveDiscovery,
    enrichment: {
      path: "enrichIncompleteRows → enrichSpecRowFromSite → discoverContacts",
      query_aware: false,
      fills: "email/phone from website only",
    },
    intent: {
      signal_required: result.spec.signal_required,
      mode: c.answers.mode ?? null,
      offer: c.answers.offer ?? null,
      opportunity: result.spec.criteria.find((x) => x.field === "opportunity")?.value ?? null,
      note: "SPEC intent ≈ signal_required + mode/offer/opportunity. No separate intent scorer.",
    },
    relevance: {
      general_relevance_score: null,
      note: "No general relevance score on SPEC path; rowSatisfiesSpec only.",
    },
    why_match: {
      classes_seen: whyClasses,
      samples: result.rows.slice(0, 8).map((r) => ({
        title: (r.title ?? "").slice(0, 80),
        why_match: r.why_match ?? null,
        class: classifyWhyMatch(r.why_match),
      })),
      uses_excerpt: false,
    },
    evidence_urls: result.rows.map((r) => r.url).filter(Boolean).slice(0, 10),
    deduplication: {
      soft_duplicate_count: result.rows.filter((r) => r.soft_duplicate).length,
      mechanism: "markSoftDuplicates; no cross-session DB merge",
    },
    persisted_to_db: written,
    persisted_note: written
      ? `upserted ${pr.persisted}/${pr.attempted} via ${pr.via}`
      : (pr.error ?? "no verified live rows persisted"),
    persist: {
      attempted: pr.attempted,
      persisted: pr.persisted,
      skipped: pr.skipped,
      via: pr.via ?? null,
      error: pr.error ?? null,
      keys_sample: pr.keys.slice(0, 5),
      verified_candidates: verified.length,
      round_trip_found: roundTrip,
    },
    live_became_leads: {
      live_row_count_in_response: liveKeys.length,
      normalized_entity: liveKeys.length ? "PARTIAL SERP title/url/snippet → SpecRow" : "n/a",
      written_to_db: written,
      conclusion,
    },
    final_rows: result.rows.length,
    rejected: result.rejected,
    sample_rows: sampleRows(result.rows),
  };
}

async function main() {
  // Force synchronous write-back so traces capture persist counts.
  process.env.AWAIT_PERSIST_LIVE = "1";
  mkdirSync("tmp", { recursive: true });
  const outPath = "tmp/reality-check-traces.jsonl";
  const lines: string[] = [];
  console.info("[reality-check] SEARXNG_URL=", process.env.SEARXNG_URL ?? "(unset)");
  console.info(
    "[reality-check] DATABASE_URL=",
    process.env.DATABASE_URL ? "set" : "(unset → Supabase service-role upsert)",
  );
  console.info("[reality-check] AWAIT_PERSIST_LIVE=1");

  for (const c of CASES) {
    console.info(`[reality-check] ${c.id} ${c.label} …`);
    const trace = await runOne(c);
    lines.push(JSON.stringify(trace));
    const t = trace as Record<string, unknown>;
    if (t.error) console.info("  ERROR", t.error);
    else {
      const after = t.after_answers_spec as { entity?: string; signal_required?: boolean };
      const persist = t.persist as
        | { persisted?: number; via?: string; round_trip_found?: number }
        | undefined;
      console.info(
        `  entity=${after?.entity} signal=${after?.signal_required} rows=${t.final_rows} live=${t.live_discovery} db=[${((t.db_sources as string[]) ?? []).join(",")}] liveSrc=[${((t.live_sources as string[]) ?? []).join(",")}] persist=${persist?.persisted ?? 0}${persist?.via ? `@${persist.via}` : ""} rt=${persist?.round_trip_found ?? 0}`,
      );
    }
  }
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.info(`[reality-check] wrote ${lines.length} → ${outPath}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
