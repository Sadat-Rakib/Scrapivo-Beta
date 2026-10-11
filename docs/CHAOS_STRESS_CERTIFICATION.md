# Chaos stress certification

**Status: NOT CERTIFIED — Q5 failed without a decoded backend result, Q11 remains active, and the full live battery and impacted acceptance gates remain pending.**
Checkpoint: 2026-10-09. This document records available evidence; it does not certify the current product.

## Latest continuation checkpoint — 2026-10-09

- Stable saved deterministic gates remain `1375 passed | 4 skipped`, with typecheck and build PASS.
- Q5 prepared run failed after 660 seconds without a decoded backend result (`req_537cc775`, `run_5d87e5ea`); artifact: `reports/.tmp/live-acceptance-20261009-165408/chaos/Q5-initial.json`.
- Q11 remains active; current progress is in `reports/continuation-2026-10-09/LIVE_ACCEPTANCE_PROGRESS.md`.
- Postgres migration/lease/dedup/terminal SQL proof passes, but real engine restart and downstream cancellation are still pending: `reports/postgres-proof-2026-10-09/SEARCH_JOBS_POSTGRES_PROOF.md`.
- The 682-file content manifest at `reports/continuation-2026-10-09/live-whole-src-content-hashes.json` has SHA-256 `c8743683729b1bb54d42fac32a7c24a89292be36c73c260a226e20fba9a2a10f`; it is recorded as evidence only and is not tied to prior gate snapshots.
- Actual 10/50/100 breadth, the full 19-query battery, and cancellation/new-run isolation remain outstanding.

## Scope and evidence boundaries

The required flow is raw request → validated understanding/spec → source/research plan → DB and live providers → candidates → merge/canonicalization → relevance/filtering → enrichment → claim verification → final UI output. Approximate counts and preferences must not become mandatory filters. Missing evidence remains unknown; required claims need subject-bound observations. No synthetic rows may be used to avoid zero.

Existing services were verified reachable by the orchestrator: app `localhost:8080`, browser worker `localhost:8788`, and SERP `localhost:8888` (Docker/WSL). Reuse these services. Do not restart them automatically or execute certification while source fixes remain in flight.

## GLM work already present

The starting head was `9bfdc777`. The preceding four chaos changes were:

| Commit | Completed change |
| --- | --- |
| `d4b6b0e7` | Chaos understanding hardening: navigation regex, slash compounds, approximate ranges, hallucinated locations. |
| `a3ea1ed5` | Multi-category matching and no-website requests without a mandatory website. |
| `9f428268` | Verifiability-hedged contact channels treated as enrichment targets. |
| `9bfdc777` | Multi-place splitting for chaotic location lists. |

The old twelve-query artifacts in `reports/chaos/` are historical diagnostics, not passing certification. Only Q12 delivered rows (8). Q5 and Q11 were captured after all four GLM changes and remain authoritative failures for that baseline. Other recordings predate later GLM fixes and must be rerun before drawing conclusions about the final GLM head.

## Codex changes and proof so far

| Commit / work | Change | Verification |
| --- | --- | --- |
| `050e9200` | Preserve hard versus optional contact requirements and requested location scope; exclude irrelevant sender-country mentions and excluded places from targets. | 196/196 focused tests passed across six files; scope suite includes original, paraphrase, industry and geography variations. |
| `753dda8` | Replace report-only chaos harness with independent real UI tests, full backend capture, identity correlation, explicit failure/zero/provenance/UI assertions, progress and cancellation/isolation checks. Add Q13–Q19. | Offline harness proof: 2 passed. Playwright discovery: 22 tests. No live certification run yet. |
| In development | Investment-type claim mapping; OR contact groups; counted subgoal buckets with shared geography; soft preference representation. | Investment pipeline focused gate 90/90 passed; semantic extension 15/15 regressions passed. Final integrated gates and source freeze pending. |

Harness regressions corrected: errors and decoding failures were swallowed; Stop timeout was ignored; a mutable resolver and substring matching could correlate the wrong response; no final assertion could fail the battery. Each query now fails independently and retains its failure evidence. Clarification must proceed to a real search. The harness checks response run/conversation/turn/request IDs, exact UI row titles/counts, visible progress, and cancellation followed by a fresh conversation.

Delivered rows must be qualified resolved entities with observed provenance. Internal authority URLs (`db://`, `osm://`, `registry://`, `overture:`) require matching identity evidence from an authority source, bound to the row's entity ID. A random DB key alone does not prove provenance. Legitimate authority rows need neither site nor contacts. The offline proof rejects wrong subjects, provisional IDs, unqualified rows and web evidence using internal schemes.

## Representative historical outcomes and zero investigation

| Case | Observed baseline outcome | Interpretation / next action |
| --- | --- | --- |
| Q5: AI seed/preseed investors | Historical baseline: `151 raw → 102 post-spec-filter → 51 ledger candidates → 0 delivered`; `FAILED_QUALIFICATION`, 51 `NO_CLAIM_EVIDENCE`. | Root cause and counters remain historical baseline evidence. The focused current rerun is recorded below; its all-row evidence audit remains pending. |
| Q11: cybersecurity plus AI infrastructure/devtools | 3 raw candidates, 1 post-spec-filter, 0 delivered; `FAILED_QUALIFICATION`. | Mixed group/type handling and qualification require current-run evidence. Rerun after fixes. |
| Q12: recent worldwide junior frontend jobs | 8 delivered in historical recording. | Positive baseline only; rerun for final UI/provenance and regression proof. |
| Other original cases | Historical zeros: qualification, role matching or spec filtering. | Most precede later GLM changes. They cannot establish current failure or success. |

Current focused Q5 evidence (2026-10-08): the real UI test completed with Playwright exit 0 (`1 passed`, 11.7 minutes; run `run_9768e7bf`). The initial phase returned 50 rows with candidate accounting `106 retrieved = 106 fated`, `unaccounted=0`, and `ok=true`; artifact: `C:\Users\mirsa\AppData\Local\Temp\scrapivo-chaos-q5-20261008-194413\Q5-initial.json`. This is focused-case evidence only. The all-row investment-evidence and subject-binding audit, focused Q11 rerun, impacted gates, cancellation test, and 19-query battery remain pending.

A terminal zero is uncertified if sources failed, source-health warnings remain, enrichment is unfinished, or candidate accounting does not reconcile. Empty acquisition requires completed alternate-query coverage with genuinely empty searches, no blocked/error responses and no observed links. Discovered candidates require explicit fate/rejection or required-field gate reasons. A `COVERAGE_EXHAUSTED` label alone is insufficient. Unexpected collapse still requires diagnosis, generalized repair and original/paraphrase/industry/geography reruns.

## Files and pipeline entry points

| Purpose | Files and useful functions |
| --- | --- |
| Understanding and criteria | `src/lib/understanding/fallback.ts`: `extractFrameDeterministic`, `detectConstraints`, `fieldRequirements`; `validate.ts`: `validateFrame`; `to-search-spec.ts`: `understandSearchSpec`, `frameToSearchSpec`. |
| Requested geography | `src/lib/search/location-resolver.ts`: `splitTargetLocationList`, `resolveCanonicalLocation`, `locationSatisfies`. |
| Main pipeline and DB dispatch | `src/lib/spec-search.functions.ts`: `runSpecSearchCore`, `rowSatisfiesSpec`, `rowCouldSatisfySpec`, `postResearchRejectReason`, `sanitizeSpecRow`; DB readers under `src/lib/canonical/`. |
| Planning and broad acquisition | `src/lib/search/source-plan.ts`: `deriveCoverageRequirements`, `buildSourcePlan`, `buildResearchPlan`, `buildCandidateResearchQueries`; `live-gapfill.ts`: `runLiveGapfill`; `browser-live.server.ts`: `discoverWithBrowser`, structured extraction and observation evidence. |
| Qualification and evidence | `src/lib/search/qualify.ts`: `qualifyLead`, `applyQualificationGate`; `canonical-contract.ts`: `queryRequiredFields`, `isQualificationBlockingField`, `evaluateQualifiedLeadTheorem`; `claim-binding.ts`: `isSubjectBound`, `isClaimAligned`. |
| Enrichment and verification | `src/lib/search/enrichment-run.ts`: `enrichCandidateForSpec`, `enrichCandidatesForSpec`; `verification.ts`: `verifyCandidateClaims`, `verifyClaimEvidence`, `mergeEvidencePreservingEventAt`; `evidence.ts`: observed evidence schema. |
| Accounting, truthful outcomes | `src/lib/search/candidate-ledger.ts`: `createCandidateLedger`, `mergeCandidateLedgers`; `source-health.ts`: source completeness; `outcome-ui.ts`: `zeroResultsNarrative`, `enrichZeroNarrative`. |
| UI certification | `e2e/chaos-battery.spec.ts`: decoded POST/response correlation, complete phase artifacts, qualification/provenance helper, real UI settlement and cancellation; `e2e/fixtures/chaos-queries.json`: original 12 plus 7 variants. Existing `e2e/stage2-acceptance.spec.ts` supplies the proven wire-decoding and UI correlation style. |
| Focused scope regression | `src/lib/understanding/chaos-scope-regression.test.ts`: contact tiers and target-location scope. |

## Commands and pending live evidence

Completed offline proof:

```powershell
rtk proxy node node_modules/vitest/vitest.mjs run src/lib/understanding/chaos-scope-regression.test.ts src/lib/understanding/llm-frame-repairs.test.ts src/lib/understanding/semantic-contract.test.ts src/lib/understanding/understanding.test.ts src/lib/search/__tests__/geo-names.test.ts src/lib/search/__tests__/or-location-execution.test.ts
rtk npx vitest run src/lib/search/__tests__/chaos-pipeline-contract.test.ts src/lib/__tests__/spec-search.test.ts src/lib/search/browser-live.server.test.ts src/lib/search/__tests__/full-v1-additions.test.ts --reporter=dot
rtk npx playwright test e2e/chaos-battery.spec.ts --grep "chaos provenance proof|chaos selection is valid" --workers=1
rtk npx playwright test e2e/chaos-battery.spec.ts --list
```

After all source owners confirm a freeze, reuse the existing services and run sequentially. Keep live evidence outside the repository to avoid development-server reloads cancelling searches:

```powershell
$env:E2E_BASE_URL = 'http://localhost:8080'
$env:CHAOS_REPORT_DIR = Join-Path $env:TEMP 'scrapivo-chaos-certification'
Remove-Item Env:CHAOS_IDS -ErrorAction SilentlyContinue
rtk npx playwright test e2e/chaos-battery.spec.ts --workers=1 --reporter=line --trace=on --output="$env:TEMP\scrapivo-chaos-playwright"
```

For a focused rerun, set `$env:CHAOS_IDS = 'Q5,Q11'` and use `--grep 'chaos Q5 |chaos Q11 '`. Clear it before the broad battery. Phase files are named by query ID and initial/forced phase; they retain exact request IDs, full decoded result, raw response wire, visible activity, UI text/rows/links and failures. Playwright retains screenshots/traces. Correlate server logs by those IDs for candidate stages not exposed by the response. Copy validated final artifacts into the repository only after the live run settles.

## Remaining blockers and checkpoint

- Final source fixes, Q5 all-row evidence audit, focused Q11 rerun, and impacted gates are pending.
- The nineteen-query real battery and cancellation/new-run test have not been certified live.
- Impacted existing acceptance/regression gates must pass before certification.
- Full response capture preserves all exposed evidence; unexposed rejected-candidate stages require server logs.
- No approximate-count minimum is imposed on valid positive results. Coverage and requested role/location combinations still require inspection.

Saved: this pending report, committed harness/fixtures, committed contact/location patch, and focused Q5 artifact reference. Historical Q5/Q11 failures remain historical; Q5 focused live execution now has a passing test result, subject to the all-row evidence audit. Next: audit Q5 → focused Q11 run → impacted acceptance gates → broad battery → reviewed report and final commit. **Final certification commit: pending.**
