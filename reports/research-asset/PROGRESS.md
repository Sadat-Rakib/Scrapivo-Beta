# PROGRESS — research-asset / data-asset pass

## Session 2026-09-27 — deterministic whole-sequence acceptance (data-asset)

Shipped:
- `src/lib/jobs/__tests__/acceptance-sequence.test.ts` — 10 ordered steps (S1–S10)
  walking the frozen sequence offline: project context v1 → "find 100" job pins
  snapshot v1 → first rows stream → mid-run context edit to v2 (running job stays
  on v1) → lease expiry + atomic reclaim by new owner → resume with zero
  duplicate candidate_keys/query_hashes (dup upserts collapse, last-write-wins)
  → TARGET_REACHED at 100 (+ COVERAGE_EXHAUSTED alternative) → project-scoped
  dataset reads via store.list(projectId) → list add dedupe on (list_id,
  entity_id) → same-thesis rerun reuse deltas (cache hits up, fresh 0→3, live
  8→5, only stale fields re-researched; real freshness TTLs) → watch rides the
  SAME engine (mode 'watch', idempotent slot) → three watch-diff notification
  outcomes → outbox duplicate-enqueue/ambiguous-delivery/retry invariants.
- `scripts/acceptance-data-asset.mts` — offline tsx runner: executes the 9
  focused vitest suites (jobs, watch, notifications, signals, projects,
  canonical, spec-search, research-agent, absence-verification), prints
  per-suite PASS/FAIL + the BENCHMARK TABLE for FINAL_STATUS.md, exits nonzero
  on any failure. No network, no env loading.
- Updated LATER_WORK.md deferred list (appended data-asset follow-ups only).

Verified:
- `npx tsc --noEmit` → 43 errors = exact 43-error baseline, zero in new files.
- `npx vitest --run src/lib/jobs/__tests__/acceptance-sequence.test.ts` → 10/10 green.
- `npx tsx scripts/acceptance-data-asset.mts` → all 9 suites green, 215 tests
  (jobs 36, watch 17, notifications 12, signals 27, projects 20, canonical 46,
  spec-search 23, research-agent 23, absence-verification 11), exit 0.

Files saved:
- src/lib/jobs/__tests__/acceptance-sequence.test.ts (new)
- scripts/acceptance-data-asset.mts (new)
- LATER_WORK.md (appended only)
- reports/research-asset/PROGRESS.md (this file)

Frozen sources untouched: job-engine.server.ts, search-job.types.ts,
watch-scheduler.server.ts, outbox.server.ts, projects-store.ts, freshness.ts.

Cut / honest limitations (also noted in test header comments):
- No real Postgres: claim atomicity + unique upserts are mirrored in an
  in-memory store and the migration SQL asserted textually.
- createSearchJob server fn not callable offline (auth middleware); context
  pinning replicated via the same store.update the fn performs.
- Reuse invariants driven by a scripted indexer double at the documented
  wiring point (createReuseRun), not the live passRunner.

Next step:
- Paste the runner's printed benchmark table into
  reports/research-asset/FINAL_STATUS.md when that file is drafted.
- Optional: live-Postgres replay of the frozen sequence (see LATER_WORK.md).
