# STAGE 2 BASELINE — FORENSIC TRACE (before any production change)

Branch `rc/mvp-local-testing-baseline` @ f70791d. Scope: SearchSpec → planner →
sources → acquisition → normalization → dedupe → candidate pool.

## CONFIRMED ARCHITECTURE (code-verified, file:line in the trace notes)

- **Source selection**: `source-capabilities.ts` catalog (11 providers, static
  cost tiers L0-L7, per-entity applicability) → `source-plan.ts buildSourcePlan`
  (free-first, paid-serp forced to escalation) → coverage-selector orders
  hot-index → S3 → OSM provider tier (business+location+category only).
- **Internal data**: Postgres index (Supabase, skips unconstrained/investor/job),
  S3 parquet corpus (people/companies/businesses/investors; businesses refuse
  world scans without a gazetteer hit), object index (OFF by default).
- **Live fallback trigger**: DB qualified < requested target OR signal_required
  OR needs_live → `runLiveGapfill` (OSM → jobs → searxng/direct-http primaries;
  browser discovery in parallel when verifiedCount < desired).
- **Browser acquisition** (`browser-live.server.ts`): SearXNG structured SERP →
  in-browser DDG/Bing fallback → link triage → page reads (cheerio + JSON-LD) →
  deterministic/LLM extraction → strict normalization (`browserEntitiesToRows`)
  → per-candidate research (contact pages, no-website absence proof).
- **Widening**: ≤3 passes, target/deadline/empty-pass stop rules, wider plans
  (10 queries / 90 pages), key-merge with contradiction ledgering.
- **Deadlines**: run budget 120s+20s×target+120s widen (≤600s); AbortSignal
  reaches gapfill/browser/S3/searxng/enrichment; browser returns accumulated
  rows on deadline.

## PROVEN DEFECTS (why real candidates become zeros)

1. **Web discovery is single-threaded on SearXNG.** `provider-ladder.ts:83-96`
   throws `SEARXNG_UNCONFIGURED` when `SEARXNG_URL` is unset; the browser then
   falls to DDG/Bing which are frequently bot-challenged (`blockedEngines`,
   browser-live.server.ts:1126-1140). Live evidence: `searxng_preflight
   unhealthy` + provider diagnostics `searxng: SOURCE_UNAVAILABLE` in every
   Stage-1 battery run. Public SERP evidence existed; acquisition got zero.
2. **"Succeeded with zero" lie.** live-gapfill.ts:850-865 reports browser
   `succeeded: fulfilled` with `queries/pages` = PLAN values (6/60), never
   actual spent counts. True stage only in `queryFunnel`
   (SEARCH_EMPTY/SEARCH_BLOCKED/…) which is diagnostics-only.
3. **Contact-completeness fail-closed.** `completeness.ts:37-46` requires
   email|phone|url for business/company; incomplete rows are never delivered —
   combined with the enrichment cap (`maxContactCandidates` 8-14, 20s budget,
   enrichment-run.ts:394-424) candidates beyond the cap are dropped. This is
   the "extracted real entities, lost all of them at qualification" symptom.
   Violates the Stage-2 rule: a candidate does not require email/phone.
4. **no_website proof near-unreachable** (qualify.ts:151-159): 4-part proof
   (structured_absence + structured_source_url + ≥2 exact queries + minted
   evidence) that OSM rows can never satisfy (live-gapfill.ts:175-179).
5. **Taxonomy fail-closed**: `kindSupported` (browser-live:413-426),
   `craftMatches`/CRAFT_QUERY map (businesses.server:144-267),
   `companyCategoryMatches` narrow aliases, `personRoleMatches`, strict job
   regex — unknown-but-evidenced categories die at normalization or
   post-research `UNPROVEN_CRITERION`. The in-code Windhoek comment
   (browser-live:419-421) documents this exact class of loss.
6. **Unconstrained-spec early zero** (spec-search.functions:2000-2024): bare
   person/company asks return NO_QUALIFIED_RESULTS BEFORE live gapfill is
   considered.
7. **Phantom providers**: `company-registry` planned but has no adapter
   (`handled_outside_live_gapfill`); paid-serp escalation unreachable on the
   interactive path; html-parser/sitemap-jsonld recorded but not executed as
   primaries.
8. **Ledger blind spots**: pre-funnel spec-filter drops (kept filter :2064,
   keyless drop :2070, opportunity filter :2090) never enter `rejectReasons`;
   non-streamed live-row losses only partially booked; `parsed` funnel stage
   is a raw-count stub (:3010). `unaccounted=0` can coexist with massive
   unrecorded losses.
9. **Abort edges**: `withTierTimeout` does not cancel the underlying work;
   extraction errors swallowed unless memory empty; provider "succeeded 0"
   indistinguishable from provider-dead in the final outcome.

## ENVIRONMENT BASELINE (measured)

- Docker 29.6.1 present; `docker-compose.searxng.yml` exists
  (SearXNG on 127.0.0.1:8888); `SEARXNG_URL` set in .env but container was NOT
  running at baseline → every web path dead at source #1.
- Playwright in-process browser adapter (default), no workers configured — OK.
- S3 corpus unreachable without AWS creds/network → internal data effectively
  empty here; live acquisition is the only real path (correct per rules).

## LIVE REPRODUCTION

Pending: SearXNG container image pull in progress (docker daemon locked on
pull). The 10-query acceptance reproduction with per-stage funnel capture runs
immediately after the container is up; numbers will be appended below and the
fix phases (accounting first) follow the mandated order.

## FIX PHASES (mandated order)

1. Ledger accounting: pre-funnel drops booked with named reasons; real
   parsed/deduped counts; unaccounted must be genuinely 0.
2. Internal-data path: keep honest S3/index behavior; ensure thin-DB → live.
3. Live fallback: SearXNG up + provider-ladder resilience; real spent-count
   diagnostics (no more succeeded-0 lie).
4. Browser acquisition: funnel surfaced end-to-end.
5. Normalization/taxonomy: evidence-backed unknown categories survive;
   completeness no longer drops contactless candidates (Stage-2 rule).
6. Widening bounded + logged (already bounded; verify with funnels).
7. Cancellation/deadline edges (withTierTimeout leak).
8. Final-zero gating: zero only after applicable paths + widening exhausted,
   with per-path evidence.
