# Universal pipeline test report
## Latest continuation checkpoint - 2026-10-10

- Q11 semantic boundary fix is locally verified in four files: `src/lib/search/service-boundary.ts`, `src/lib/spec-search.functions.ts`, `src/lib/understanding/service-boundary.test.ts`, and `src/lib/search/__tests__/chaos-pipeline-contract.test.ts`.
- Q11 local freeze gate passed before the later Q5 routing edit: `109 files passed | 1 skipped`, `1438 tests passed | 4 skipped`; typecheck and production build also passed for that source freeze.
- Q5 routing fix is separately verified after the Q11 freeze. Evidence: `reports/continuation-2026-10-10/q11-semantic-gates/Q5_QUERY_CHECKPOINT.md`. Focused Q5/Q11 suites passed `57` tests; nearest planner/routing/people/jobs/adversarial/yield/investor parser gate passed `153` tests; Q5 frozen-source typecheck and production build passed. Earlier broad `1438` gate predates this Q5 edit and is not claimed as Q5 proof.
- Fresh Q5 live retry completed naturally but failed quality: `SEARCH_FAILED`, `0` qualified/delivered rows, root settlement `599980` ms for a `600000` ms budget, ledger accounting `98` retrieved / `98` fated / `0` unaccounted. Evidence: `reports/continuation-2026-10-10/Q5_QUERY_FIX_RETRY.json`.
- Current Q5 unresolved scope: decoded target/criteria still lack explicit funds/angels identity restriction; staff seeds were researched. Claim-type rejects do not prove investment extractor failure, and no investment should be inferred from employer text.
- 682-file source manifest and gate logs for the Q11 freeze are saved under `reports/continuation-2026-10-10/q11-semantic-gates/`. Q5 source hashes are saved as `reports/continuation-2026-10-10/q11-semantic-gates/q5-source-hashes.json`.
- Real Postgres durable search-job resume/cancel proof passes with actual app store/engine and controlled sentinel pass runner. Evidence: `reports/postgres-proof-2026-10-09/SEARCH_JOBS_POSTGRES_PROOF.md`. Limit: not live provider acquisition quality/cancellation proof.
- Q11 strict live run settled as acceptance FAIL: 398790 ms, NO_QUALIFIED_RESULTS, 0 qualified/delivered rows, ledger accounting 34 retrieved / 34 fated / 0 unaccounted. All 34 candidates failed UNPROVEN_CRITERION on product_company=UNKNOWN. No bad rows were delivered, but coverage cannot be certified exhausted because S3 availability was degraded; reporter finalization is still pending.
- Q11 S3 degraded cause is bounded broad-scan deadline, not missing credentials: the decisive branch scanned 151155 S3 rows and returned 0 before coverageIncomplete/deadline; S3 was reachable and returned rows on other branches. No credential repair is indicated, and no truthful exhaustion can be certified from that run.
- Final Q5 scope + Q11 navigation freeze is saved at reports/continuation-2026-10-10/q11-semantic-gates/scope-source-hashes.json with 685 source files. Q11 navigation exact-label proof passed 70 focused tests; final combined scope + navigation proof passed 154 tests across 8 files plus the 4-case fixture. Typecheck passed exit 0 and production build passed exit 0 with hashes unchanged. Scope + navigation are accepted for live rerun, but live quality is not certified.
- Prior Q5 scope live run settled but failed quality: core 425203 ms, 0 rows, ledger 100 retrieved / 100 fated / 0 unaccounted, 63 investor_type=UNKNOWN, and 6 acquisition pages irrelevant; queue was held before Q11. Root cause fixed was deferred unknown-seed starvation, not the extractor. New freeze: reports/continuation-2026-10-10/q11-semantic-gates/deferred-source-hashes.json, 685 files; checkpoint: reports/continuation-2026-10-10/q11-semantic-gates/DEFERRED_SEED_CHECKPOINT.md. Focused proof passed 125 tests across 6 files, including AV8 zero-attempt fail-before and greater-than-zero after, plus broad controls. Typecheck and build passed exit 0 with hashes unchanged.
- Final deferred-Q5 live run settled as SEARCH_FAILED with 0 rows: core 600006 ms against root budget 600000 ms, ledger 102 retrieved / 102 fated / 0 unaccounted, and truthful run-deadline SOURCE_ERROR. Scope OR is present and actual deferred identity queries prove fallback; Visible identity queries remained Canada staff; research on US fund seeds was not observed before deadline. No Q5 quality certification and no further Q5 retry. Deferred freeze remains immutable at 7e81ce... over 685 files.
- Q11 deferred live rerun settled with 0 rows: core 324473 ms, ledger 33 retrieved / 33 fated / 0 unaccounted. No Q11 quality or coverage certification is claimed; the earlier navigation fake-positive is gone.
- Production 10 breadth run exposed fatal SEARCH_CANCELLED from an actual product bounded-promise leak; that leak is now proven and fixed. UI V10 exposed count coupling: requested 10, plan 50, delivered 50. V50 matched plan 50 and delivered 50 with core 291731 ms. V100 ended ERR_NETWORK_IO_SUSPENDED -> SEARCH_CANCELLED at 151509 ms, classified as environment interruption.
- Combined count/abort freeze saved reports/continuation-2026-10-10/q11-semantic-gates/count-abort-source-hashes.json, 687 files, SHA-256 36f452cdec640d0d6ab23745ee076735f8c04c013938a204f9c59c6e2f4f2040. Proof: 106 nearest tests plus count 10/10 passed; fatal-before 1 / after 0 is fixed, while caught cancellation remains caught. Typecheck exit 0 and build exit 0; whole hash set unchanged.
- Final production breadth 10/50/100 each exited 0 with real provider execution and exact plan counts 10/50/100, but quality failed: the same GoodFirms country heading United States qualified as a company, verified 0, and no full reject ledger exists, so coverage is uncertified. Evidence: reports/continuation-2026-10-10/q11-semantic-gates/FINAL_PRODUCTION_BREADTH_AUDIT.json.
- Strict UI V10/V50/V100 target checks all passed: desired 10/50/100, delivered 10/50/50, API page size stayed 50. Fate accounting passed: 61/61, 61/61, 62/62. V100 core 217297 ms. UI process exited naturally with exit 0 at 18:52:52. Semantic quality still failed: S&E Appliance Repair carried Hardware/Software category tags but description was Home/Commercial Appliance Repair; S&S Valid offers POS software and should be preserved.
- Weekly usage reached 99 percent while full23 battery remains active with PID 26660 and child 28744 on source 36f452687. Cancel Stop returned ERR_ABORTED, but zero raw backend events for the original run means backend cancellation is unproven, likely stopped before core entry. A distinct new run returned status 200 with 50 rows and core 66952 ms, proving new-run isolation only. Future proof needs an entry-barrier stop after backend progress; follow-up is prepared, with no active queue test edit. First query core settled NO_QUALIFIED_RESULTS in 234693 ms; artifact audit pending. Directory-heading and software-activity fixes remain prepared outside src, not applied. Goal remains incomplete.

No live certification is claimed from offline Q11 or Q5 gates.

## Latest continuation checkpoint — 2026-10-09

- Stable saved gates remain: broad `1375 passed | 4 skipped`, typecheck PASS, and build PASS.
- The earlier dirty snapshot value `483B07B4062969AA011ABF0D1F10E9BB5416217F414AECD7A944A021AA5E39CD` hashes the dirty-path list only; it does not establish source-content identity.
- Current content manifest: `reports/continuation-2026-10-09/live-whole-src-content-hashes.json` (682 files; manifest SHA-256 `c8743683729b1bb54d42fac32a7c24a89292be36c73c260a226e20fba9a2a10f`). No claim currently binds this manifest to the saved gates.
- Prepared Q5 failed after 660 seconds without a decoded backend result (`req_537cc775`, `run_5d87e5ea`); saved artifact: `reports/.tmp/live-acceptance-20261009-165408/chaos/Q5-initial.json`.
- Q11 remains active; progress report: `reports/continuation-2026-10-09/LIVE_ACCEPTANCE_PROGRESS.md`.
- Real Postgres durable search-job resume/cancel proof passes with actual app store/engine and controlled sentinel pass runner: `reports/postgres-proof-2026-10-09/SEARCH_JOBS_POSTGRES_PROOF.md`. Limit: not live provider acquisition quality/cancellation proof.
- Lead-segments focused lint now passes after fixing the task-owned finding; 8 baseline non-format findings remain.

## Continuation gates — 2026-10-09

- Last production parser/custom/M9 gate PASS431/17files2.79s. New HAS property initially caused8failures; JSON evidence `reports/universal-custom-parser-failures.json` saved. Three real regressions fixed by limiting unknown property to immediate target-tail masked/relative prefix, known head and non-output/non-numeric object. Five old custom→service aliases migrated to truthful custom_signal assertions without changing topic/output/mandatory semantics. Intermediate gate399PASS2FAIL diagnosed masked spans; final431PASS.
- Job engine/store plus custom/noWebsite regression PASS46/3files1.48s; injected stores prove existing lease/cancel/pause/resume mechanics, not live Postgres or production verified provider volume.
- Task-owned formatting applied, excluding initial dirty `spec-search.functions.ts` and `browser-research.ts`. Initial formatting command had2missing paths; corrected actual generate-modal/lead-segments paths subsequently formatted.
- Frozen broad after custom vocabulary/parser freeze started; results pending. Live controlled Q5/Q11 pending this gate.
- Frozen final broad command includes prior search/understanding/signals/outreach plus `src/lib/jobs/__tests__/job-engine.test.ts` and `search-jobs-store.test.ts`: PASS1353,SKIP4;102filesPASS/1SKIP;11.59s exit0. Parser/custom vocabulary, final no-window wrong-certification assertion, formatting and all shared-budget changes included.
- Controlled live `rtk node reports/universal-free-service-runner.mjs gates --log` RUNNING session15892; log `reports/app-readiness/gates-2026-10-09T17-38-48-006Z.log`. Local app200, browser worker healthy8788 and SearXNG200 confirmed by parent/grunt before run. Provider keys explicitly empty and persistence disabled by proved helper. No live qualification result claimed until evidence is audited. Final typecheck/build deferred until live completes to avoid prior contention.
- Live source freeze hashes saved `reports/universal-live-source-hashes.json` (captured after launch while unchanged). Q5 authenticated raw investor prompt and active Stop UI confirmed in Playwright trace; initial visible progress available records48/web14/publicwebsites14, no delivered qualification counted yet.
- Formatted task-file focused ESLint28files (excluding initial dirty spec/browser): FAIL9errors3warnings. Remaining lead-segments duplicate branch1, live-gapfill preferconst1, fallback preferconst2, Discover constant-binary5; attribution pending original checkpoint comparison. No source edits during active live run.
- Review-only pending fix: supported-evidence cache replay concatenates original and cached evidence, potentially duplicating provenance items; use existing evidence merge after live run, then affected tests/frozen gates. Qualification correctness is still rechecked.

- Frozen broad `rtk npm run test -- src/lib/search src/lib/understanding src/lib/signals src/lib/__tests__/outreach-draft.test.ts --testTimeout=20000`: PASS1321, SKIP4;100files PASS/1SKIP;87.09s, exit0. Includes all prior geography/browser/future corrections.
- Previous final build handle39723 lost across compaction. Verified orphan Vite build31596/npm35492 and stopped only these task-owned processes; old final build classified ABORTED/unproven. New final build must run after continuation fixes.
- Verified root branch budget defect: enrichment counters were instantiated after recursive fanout, resetting each child. Root-owned shared budget is being threaded through existing internal branch options; focused recursion proof pending.
- Shared root budget fix: `rtk npm run test -- src/lib/search/__tests__/or-location-execution.test.ts src/lib/search/__tests__/universal-pipeline-regressions.test.ts --testTimeout=20000` PASS24,2files,15.49s. Includes actual recursive two-location adapter cap and two-batch contact/deadline cap.
- New legacy site-recursion fixture initially FAIL (65PASS1FAIL): existing sanitization marks optional contact-only gaps complete, so legacy site function is not invoked for ordinary named candidates. Corrected fixture verifies no spend; separate actual function proof verifies two-batch cap and active abort.
- Custom verification initial59PASS2FAIL exposed domain-only snippet binding; fixed full entity-name matching. Subsequent84PASS1FAIL was a test passing an explicit empty evidence override to final qualification; corrected it to pass the hunted evidence.
- Final affected custom/budget/deep/ORlocation/M9/absence suite: PASS96/6files,1.67s. Proves correct ISO27001 custom final qualification, wrong subject/request, unrelated certification/date/subject, missing/stale/future/recent events, active legacy deadline abort, and unchanged structured absence suite. One additional noWebsite custom claim-routing regression added after this run; pending next gate.
- Intermediate continuation typecheck exit0 PASS, but sources changed during run; frozen final typecheck/build pending.

## Baseline — 2026-10-09, before implementation

- `rtk npm run test -- src/lib/understanding/understanding.test.ts src/lib/understanding/investor-check-preference.test.ts src/lib/search/__tests__/search-spec.test.ts src/lib/search/__tests__/m9-verification.test.ts src/lib/signals/__tests__/deep-pass.test.ts src/lib/search/__tests__/phase1-acceptance.test.ts` — PASS, 6 files / 262 tests, 15.34 seconds.
- `rtk npm run typecheck` — PASS.
- `rtk npm run build` — PASS. Existing dependency module-directive and bundler timing warnings; local Vercel output generated, no deployment performed.
- Existing test runner warnings: Vite tsconfig-path plugin deprecation and parse errors for unrelated `freehire/extension/tsconfig.json` and `freehire/web/tsconfig.json`. These did not fail focused tests.
- No live providers used. No mock results claimed as production verification.

## Verified baseline defects from active production code

- `frameToSearchSpec()` produces one signal type from its primary relation, losing compound funding/hiring requirements; `SearchSpec` lacks explicit AND/OR semantics.
- `verifyCandidateClaims()` accepts the first verified evidence item, so it cannot enforce multiple mandatory signals.
- `deriveRequiredClaimParameters()` combines parameters across requested claim types, potentially demanding hiring-role text from funding evidence.
- `rowHasVerifiedSignal()` checks evidence structure only, so wrong requested claim type or stale evidence suppresses further deep research.
- Deep-pass probes use a timed Promise race without aborting timed-out work.

## Implementation verification

File map saved before production edits. Ordered implementation is active.

- New `universal-signals.test.ts`: before fixes FAIL 5/6; after fixes PASS 8/8 including final OR qualification branches.
- `rtk npm run test -- src/lib/understanding src/lib/search/__tests__/m9-verification.test.ts --exclude "docs/**"`: 386 PASS / 1 FAIL (service-boundary product research). Baseline status of this broader failure unproven; no unrelated fix attempted.
- `rtk npm run test -- src/lib/search/__tests__/m7-source-routing.test.ts src/lib/search/__tests__/source-plan-registry.test.ts src/lib/search/__tests__/m9-verification.test.ts src/lib/understanding/universal-signals.test.ts --exclude "docs/**"`: PASS 81.
- `rtk npm run test -- src/lib/signals/__tests__/deep-pass.test.ts src/lib/signals/__tests__/custom-signal-injection.test.ts src/lib/search/__tests__/candidate-survival.test.ts`: PASS 45 after stricter stale/deadline expectations and service/hiring extraction correction.
- `rtk npm run test -- src/lib/search/__tests__/pipeline-phases.test.ts src/lib/search/__tests__/research-candidate-semantics.test.ts src/lib/search/__tests__/m8-enrichment.test.ts src/lib/search/__tests__/m9-verification.test.ts src/lib/understanding/universal-signals.test.ts src/lib/signals/__tests__/deep-pass.test.ts`: PASS 87.
- `rtk npm run test -- src/lib/search/__tests__/m8-enrichment.test.ts src/lib/search/__tests__/m9-verification.test.ts src/lib/search/__tests__/absence-verification.test.ts src/lib/search/__tests__/osm-no-website-seed.test.ts src/lib/search/__tests__/candidate-ledger.test.ts src/lib/search/__tests__/v1-cancellation.test.ts src/lib/search/__tests__/requested-output-execution.test.ts`: PASS 84.
- `rtk npm run test -- src/lib/search/__tests__/universal-pipeline-regressions.test.ts`: PASS 7. Proves advertised investor/job web adapter invocation, AND accumulation, active hunter AbortSignal propagation, pre-signal contact skip, empty claim authorization denial.
- `rtk npm run test -- src/lib/search/__tests__/universal-pipeline-regressions.test.ts src/lib/signals/__tests__/custom-compiler.test.ts src/lib/signals/__tests__/deep-pass.test.ts src/lib/search/__tests__/pipeline-phases.test.ts`: PASS 61.
- Intermediate typecheck found implementation-only missing type import/predicate/callback/test fixture typing problems; fixed, final rerun pending.
- Checkpoint test copies initially caused additional Vitest discovery/import failures. Copies now have `.checkpoint` suffix; resolved without test-config changes.

## Live regression status

Q5/Q11 pending safe runtime isolation and app/worker startup. Docker engine recovered; SearXNG on8888 now responds200 (readiness check, not lead verification). No paid providers or deployment used. No live volume/latency results claimed. Controlled command after isolated free-only runtime is ready: `rtk proxy powershell -NoProfile -File reports/continuation-2026-10-08-gates/run-live-final-gates.ps1 focused`.

## Final regression fixes and gates

- Broad search/understanding/signals/outreach run initially1308 PASS4SKIP2FAIL: service-boundary research exposed a real final-theorem multi-location defect; offline browser test exceeded5s under concurrent build/lint load.
- Fixed `canonical-contract.ts` final location gate to evaluate all exact requested alternatives; Canada country normalization preserved. Original service-boundary test passes unchanged.
- New future-dated evidence regression initiallyFAIL: current event freshness accepted negative age. Fixed current-window future rejection, including current in-year future events.
- Geography/M9/ORlocation/UI/new regressions: `rtk npm run test -- src/lib/understanding/service-boundary.test.ts src/lib/search/__tests__/universal-pipeline-regressions.test.ts src/lib/search/__tests__/m9-verification.test.ts src/lib/search/__tests__/or-location-execution.test.ts src/lib/search/__tests__/m11-ui-run.test.ts --testTimeout=20000` PASS67.
- New final geographies and caller volumes10/50/100 plus unchanged service-boundary: PASS33.
- Isolated offline browser integration: PASS8 with20s test ceiling, runtime4.55s. This is deterministic injected-provider proof, not live verification.
- Latest completed typecheck PASS.
- Production build completed exit0; RTK summary falsely classified asset filenames containing `friendly-error` as errors. Final rebuild pending after last edits.
- Full `eslint .` stopped after12+minutes and severe CPU contention, without a result. Only this task's ESLint child process stopped. Focused changed-source ESLint running; no global config exclusions added.

## Usage-limit checkpoint — 2026-10-09

- Latest broad run:1320 PASS4SKIP1FAIL across101 files. The only failure was the newly added no-window future-event test while files were being transformed before its production fix. Latest isolated `universal-pipeline-regressions.test.ts` + `m9-verification.test.ts`:37 PASS after that fix. All prior service-boundary/browser failures passed after their corrections in focused runs. A clean frozen broad rerun remains necessary; do not combine these overlapping runs into a claimed clean broad PASS.
- Focused ESLint24 changed files: FAIL2203 errors3 warnings;2190 are prettier formatting, remaining rules include existing hook/constant/duplicate/const issues. Baseline attribution not completed; do not claim all are pre-existing. No mass formatting of original dirty files performed.
- Latest completed typecheck PASS; current final typecheck/build status will be appended by parent.
- Final typecheck completed PASS at handoff. Final rebuild remains active in session39723; parent must record completion/termination. No further tests started.
- No further broad or live scenarios started after usage-limit warning. Q5/Q11 remain unexecuted with this implementation.

