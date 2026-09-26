# Candidate-Survival V1 — session progress record (2026-09-26)

Mission: fix the funnel so discovered candidates are not stranded before the
research/enrichment that makes them qualify. Invariant: unknown is researchable,
contradicted is rejectable, verified is deliverable.

## What finished (all implemented + tested)

- RC1 circular enrichment gate removed: `spec-search.functions.ts` M8 stage now
  builds a researchable pool (complete + incomplete candidates), runs
  `enrichCandidatesForSpec` over it, recomputes completeness, then splits.
- RC2 orchestration only — final theorem untouched. `complete === false` now
  routes candidates INTO enrichment instead of out of the pipeline.
- RC3 `rowCouldSatisfySpec(spec, row)` added (spec-search.functions.ts): rejects
  only hard contradictions (explicit role/industry/location/category mismatch);
  unknown fields survive to research. Used for live/social split + isVerified.
- RC4 official-destination resolution: `registry-identity` adapter in
  `enrichment-run.ts` now resolves a first-party site via
  `discoverWebFreeFirst` (≤2 queries, 5 results inspected), validated with
  page classification + `isFirstPartyEntityHost` (now exported) + name match on
  host/title. Never assumed result #1; never runs under no_website spec.
- RC5 opportunity stamping: canonical `stampSpecOpportunity()` +
  `sanitizeSpecRow(row, spec?)`; `enrichIncompleteRows` completeness recheck
  preserves `opportunity`.
- RC6 isVerified order fixed: stamps opportunity before completeness, uses
  researchable match. Browser can mark verified no-site candidates.
- RC7 deadline vs cancel: typed abort reasons (`SEARCH_DEADLINE` /
  `SEARCH_STALE_RUN` / `SEARCH_CANCELLED`) in `search-run(.server).ts`;
  deadline finalizes accumulated qualified rows (gate still runs), cancel
  discards. `browser-live.server.ts` returns researched rows on deadline
  instead of throwing; `live-gapfill.ts` keeps browser rows past the deadline.
- RC8 `[ui-projection]` dev log in `discover.tsx` (server/projected/rejected + codes).
- Bonus fixes proven during acceptance: "may need help" no longer sets
  `signal_required` (`to-search-spec.ts` tentativeHelp); in-browser minting of
  the subject-bound `no_website` claim once structured absence + 2 exact checks
  complete (same thresholds as the no-website-verify adapter), with SERP
  metadata used as a real exact check when page reads fail — first-party-looking
  results still block the claim.
- Funnel instrumentation: `retrievalTrace` extended with `researchable`,
  `researched`, `qualified`; `[spec-run]` log includes `deadline`.

## Tests

- New: `src/lib/search/__tests__/candidate-survival.test.ts` (13 tests, all pass)
  covering the 12 acceptance-test items from the mission prompt.
- Neighboring suites pass: spec-search, spec-candidates, m1-m3, m8, m11, m12,
  v1-cancellation, phase1-acceptance, entity-clarifier (137+ green).
- Known pre-existing (NOT from this session, files untracked before start):
  typecheck errors in m4-entity-resolve.test / m9-verification.test /
  universal-audit-fills.test / person-qualify.ts / verification.ts, and the
  understanding isolation test ("to-search-spec imports the legacy parser").

## Acceptance (one run each, funnel from retrievalTrace)

- B (SaaS founders global): PASS. discovered=10 researchable=10 researched=10
  complete=3 qualified=3 server=3 runtime=113s. Real founders (Outshine,
  Waydev, Thrust Carbon), signal_required=false, zero fake intent.
- A (Austin no-website plumbers): 0 qualified. discovered=38 → postSpecFilter=27
  → complete=17 → rejected 17 (3 correct: browser found their websites;
  rest NO_CLAIM_EVIDENCE). Blocker: browser page reads fail (`Read page:1`),
  so most absence verifications cannot complete — this is the parked
  LATER_WORK browser-reliability item, now the sole A bottleneck.
- C (Toronto SaaS contacts): 0 qualified. discovered=6 → researched=6 →
  complete=0 (all list-page candidates unresolved; enrichment correctly skips
  unresolved sources; browser budget expired before identity resolution).
- Deadline no longer erases results (outcome NO_QUALIFIED_RESULTS /
  QUALIFIED_RESULTS instead of SEARCH_CANCELLED on timeout).

## Next step

A/C hinge on browser page-read reliability + per-candidate budget pacing —
parked in reports/result-drop-audit/LATER_WORK.md; that is the next frontier,
not the funnel. Optional cheap lever: raise browser page budget per candidate
for no_website hunts only.

## Files touched this session

- src/lib/spec-search.functions.ts
- src/lib/search/search-run.ts, search-run.server.ts
- src/lib/search/enrich-incomplete.ts
- src/lib/search/enrichment-run.ts
- src/lib/search/entity-resolve.ts (export only)
- src/lib/search/live-gapfill.ts
- src/lib/search/browser-live.server.ts
- src/lib/understanding/to-search-spec.ts
- src/routes/_authenticated/discover.tsx (dev log only)
- scripts/v1-initial-acceptance.mts (abort reason only)
- src/lib/search/__tests__/candidate-survival.test.ts (new)
