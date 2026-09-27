# SCRAPIVO DATA-ASSET PASS — FINAL STATUS

READY FOR USER TESTING (with documented limits)

Date: 2026-09-27. Baseline `6a6e361` (checkpoint) → this report. Plan frozen
before execution (Data-Asset Pass v3.1); no redesign during build.

## THE BET, SHIPPED

Arbitrary thesis → verified dataset → persists → is reused → is watched.
Browser stayed infrastructure. Nothing was weakened to make numbers green.

## PRODUCT DIFFERENTIATION
- thesis compiler: pre-existing (UnderstandingFrame + readiness gate); jobs
  now carry the compiled spec (`opts.spec` skips re-understanding per pass)
- elastic search: WS1 — engine widening math (yield → deficit → pool target,
  cap 250 interactive / 2000 job+watch), untried-variant memory in
  `search_job_queries`, coverage exhaustion after 2 empty passes
- custom signals: WS7A deep-signal pass only; compiler CUT (see cuts)
- opportunity packets: pre-existing QualifiedLead path; packets now persist as
  job candidates (`search_job_candidates`) with source job linkage
- research graph: WS4 — canonical-facts-ONLY write-back (judgment fields
  physically blocked; verified live — see below), field-level freshness
  (stable 90d / medium 30d / volatile 7d / event / very-volatile 2d)
- watch: WS5 — watch = compiled thesis + schedule + change mode + delivery,
  executed as a SearchJob (mode `watch`) through the SAME engine; fingerprint
  diff (`watch_seen_matches`) for NEW_ENTITY and NEW_SIGNAL; cron
  `/api/cron/signal-watches` (hourly, CRON_SECRET)
- act: notification outbox → in-app / email / Slack adapters (WS6)

## ARCHITECTURE LANDED
- `search_jobs` + `search_job_candidates|queries|sources` (normalized, unique
  (job_id,candidate_key)/(job_id,query_hash)), `scheduled_for` +
  UNIQUE(watch_id, scheduled_for), `completion_reason`
  (TARGET_REACHED/COVERAGE_EXHAUSTED/BUDGET_EXHAUSTED/USER_STOPPED/FAILED),
  atomic lease RPCs (`claim_search_job` FOR UPDATE SKIP LOCKED,
  `heartbeat_search_job`, `release_search_job`), desired-state pause/stop at
  safe checkpoints, context snapshot pinned at job start
- Projects: `projects` (extended) + `project_context` (context_version) +
  `project_icps` + saved searches + lists (reference-only items) + activity;
  resolver precedence explicit > project > global with provenance; Memory
  backfilled to `project_global_defaults`, sidebar Memory→Projects, old route
  redirects to Settings → Profile & Defaults
- Acquisition: HTTP/JSON-LD FIRST for statically usable pages; browser only
  when rendering needed; browser fail → 1 retry → HTTP fallback →
  SOURCE_DEGRADED; candidate concurrency 3, per-domain serialized
- Source learning: `source_yield_stats` daily windows, 7-day half-life decayed
  yield with smoothing prior, plan reorder only on ≥8 decayed attempts
- Notifications: `NotificationChannel` interface; outbox with UNIQUE
  idempotency_key; statuses pending/sending/delivered/delivery_unknown/failed;
  NO blind retry of ambiguous external sends; credentials AES-256-GCM,
  server-only, never returned/logged

## SCALE (live spot checks, real pipeline)
- H2 investors broad: 11 qualified / 10 returned, ~22s
- H5 remote React jobs Canada: 17 qualified / 10 returned, ~26s
- H14 no-website HVAC GTA: 27 candidates → researched 27 → 1 verified absent,
  8 correctly rejected (website observed — CLAIM_PARAMETER_MISMATCH), 12
  honest `no_website_verification` pending at budget timeout, ~132s.
  Procedure correct; zero fabrication; strict 4-component rule held
- H8 signal query: readiness gate demanded industry before any research
  (733ms, honest clarify, no wasted infrastructure)

## DETERMINISTIC ACCEPTANCE (all offline)
`npx tsx scripts/acceptance-data-asset.mts` → 9/9 suites, 215 tests, exit 0.
Whole sequence S1–S10 green: context v1 pinned during mid-run edit to v2;
lease expiry → atomic reclaim by second owner → resume with zero duplicate
candidates/queries; TARGET_REACHED at 100; honest COVERAGE_EXHAUSTED after 2
empty passes; project-scoped dataset reads; list dedupe; reuse invariants
(cache hits 0→3, fresh reused 0→3, live calls 8→5, only-stale re-research);
watch rides same engine; no-new-signal → 0 intents / new signal → 1 / new
entity → 1; duplicate idempotency key → 1 intent; ambiguous delivery →
delivery_unknown, manual retry sends nothing blindly.

## LIVE ENFORCEMENT OBSERVED
`[persist-live] judgment fields blocked from canonical storage: why_match,
disposition, relevance_score, intent_score, disposition_label` — the WS4
split fired on a real run.

## CUTS (frozen cut order, recorded honestly)
1. WS7B custom-signal compiler — CUT (architecture ready: signal slots +
   deep-pass hunter injection point remain)
2. Telegram adapter — CUT (channel interface + connection rows accept it)
Everything in the durable spine shipped: Projects → Search Jobs → widening →
canonical reuse → Watch → notification outbox → WS7A.

## KNOWN LIMITATIONS
- Interactive searches still use the inline 120s path; jobs/batches/watch use
  the engine. UI job controls exist as server fns; deep discover.tsx wiring
  of job progress panels is minimal (project Research-Jobs section reads via
  listSearchJobs projectId filter)
- Watch completion diffing runs on a 60s poller (race-free via icp.last_job_id)
- routeTree.gen.ts hand-extended for the cron route (regenerates on dev/build)
- Real-Postgres claim atomicity + unique upserts are asserted textually in
  tests (no offline Postgres); in-memory fakes mirror the semantics
- Browser page-read reliability improved (ladder + HTTP-first) but per-run
  wall-clock still caps how many absence verifications complete (H14: 1/27 in
  budget; candidate budget pacing remains the next lever)
- US-founder corpus (H7) got planner variants; corpus depth itself unchanged

## NEW DEPLOY REQUIREMENTS
- env: `SCRAPIVO_NOTIFICATIONS_KEY` (32-byte hex, AES-256-GCM key),
  `SCRAPIVO_NOTIFY_FROM` (email channel sender)
- migrations: 20260927000000_search_jobs, 20260927100000_projects_ext,
  20260927200000_source_yield, 20260928000000_notifications,
  20260928100000_watch_v2
- vercel.json: hourly cron `/api/cron/signal-watches` added

## TESTS / HYGIENE
- typecheck: 43 errors / 15 files — IDENTICAL to pre-pass baseline; zero
  introduced (verified after every workstream and at end)
- focused regression: 215 tests / 9 suites green (acceptance runner) +
  102-test cross-suite run (signals/spec-search/jobs/watch/notifications)
- full `src/lib` run: 96/106 files pass; the 10 failing files fail IDENTICALLY
  on the pre-pass baseline commit (verified in a detached worktree at
  `6a6e361`: same 29 failed / 265 passed) — pre-existing cross-suite mock
  interference, zero introduced by this pass; focused strategy per PRD
- live batteries: H1, H2, H5, H8, H14 run post-changes; all procedures correct

## START
```powershell
docker compose -f docker-compose.searxng.yml up -d
npm run dev
```
Batteries: `npx tsx scripts/hardening-battery.mts [H1..H16]` ·
`npx tsx scripts/full-v1-acceptance.mts [A..L]` ·
`npx tsx scripts/acceptance-data-asset.mts` (deterministic, offline)

## NEXT FRONTIER
1. Candidate budget pacing for absence verification (H14 yield × wall-clock)
2. Wire reuse accumulator into the live pass path end-to-end (module + tests
   exist; pass-runner already threads it — measure DB_reuse_rate in prod)
3. Discover.tsx first-class Research-Job progress panels + job resurfacing
4. WS7B custom-signal compiler (injection point ready)
5. Telegram channel adapter (interface ready)
