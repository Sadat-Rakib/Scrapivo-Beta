# Universal pipeline implementation

## Continuation: shared branch enrichment budget

`runSpecSearchCore()` now creates enrichment spending counters before recursive location/compound branches and passes the same internal `enrichmentBudget` object to each child. Contact/adapter/paid counters and the first batch absolute deadline persist across branches; existing root remaining-clock cap still bounds the first deadline. Actual two-location recursion with only one adapter call remaining exhausts at64 total, rather than resetting in each branch. Separate batch regression proves one contact allowance and an unchanged deadline across batches.

Legacy `enrichIncompleteRows()` now reserves contacts/adapter calls from this same root budget and cancels active operations at the absolute shared deadline. DB/live callers pre-screen and merge candidates before legacy work, preserving rejected rows and duplicate ledger accounting. Ordinary contact-only gaps are already marked complete by existing sanitization, so that legacy branch does not spend contacts on those rows; its bounded function is separately tested. A supported-evidence-only root cache shares verified signal research between branches using entity+signal mode/types+parameters+recency/custom/current-role signature; final verification still checks each branch and unsignaled/budget-skipped candidates remain researchable.

## Continuation: arbitrary custom claim verification

Added additive `custom_signal` evidence type in `evidence.ts`, `claim-binding.ts` and the existing deep engine. `custom-compiler.ts` exports the existing deterministic compiler for shared verification. `verifyClaimEvidence()` requires exact requested custom-text binding, a deterministic observable indicator present in the actual excerpt, and a specific multiword indicator when available; unrelated hiring/service signals cannot satisfy custom intent. Existing subject/provenance/recency gates remain mandatory.

The custom hunter binds candidate name and indicator in the same sentence, uses a literal singleYYYY-MM-DD date only with an actual event verb in that sentence, and retains unknown event time for footers/publication-only dates. Candidate naming accepts the full entity name when snippets omit its known domain; individual words of multiword names are not added as loose aliases. Custom no-website requests retain dedicated absence claim types and verifier. No new engine or paid compilation introduced.

`frameToSearchSpec()` now emits custom_signal for a true custom relation rather than an unrelated service_request alias, and keeps both the user's predicate wording and its object/topic. The existing deterministic possession grammar in `fallback.ts` retains arbitrary non-field properties only at an immediate target-tail masked/relative span with a known head; existing assets, contacts, numeric constraints, later objective clauses and unreadable relations retain their prior owners. Production raw queries for manual onboarding and ISO27001 certification are tested through extraction/conversion and final unrelated-service rejection. Five `social-topic-modal.test.ts` assertions migrate old custom-as-service labels to the additive custom vocabulary; topic/output/mandatory behavior remains asserted.

Continuation source freeze validated with1353PASS4SKIP broad deterministic cases, including job engine/store. Real-provider Q5/Q11 now running in isolated free-only helper; results not yet known.

File-map gate satisfied before production/test edits. Existing changes preserved.

## Phase 1

- `src/lib/search/search-spec.ts`: `SearchSpec`, `buildSpec()` carry optional `signal_mode: all|any`; absent retains legacy alias behavior.
- `src/lib/understanding/to-search-spec.ts`: `frameToSearchSpec()` uses existing `detectRelation()` grammar to recover explicit additional signal clauses; conjunctions in sector/location lists do not set signal OR. Investment relations request investment evidence. Custom relation labels reach the existing custom compiler through `custom_signal_text`.
- `src/lib/search/verification.ts`: `deriveRequiredClaimParameters()` scopes requirements to the evidence claim; `verifyCandidateClaims()` verifies every requested claim for explicit AND.
- `src/lib/understanding/universal-signals.test.ts`: funding AND/OR, directory without intent, distinct investment evidence, independent claim parameters.

Before fixes: 5/6 new tests failed. After fixes: 6/6 new tests pass; existing investor preference and M9 verification tests pass (49 total). Checkpoint copies temporarily interfered with Vitest discovery; excluded docs for verification pending checkpoint correction.

## Ordered continuation

Phase 2 discovery next; Phase 3 cheap eligibility; Phase 4 strict signal research; Phase 5 selective enrichment; Phase 6 qualification/output; Phase 7 reliability; Phase 8 broader proof.

## Phase 2

- `source-pipeline.ts`: `runCanonicalSourcePipeline()` stops only at requested unique theorem-qualified volume, deduplicates provider rows with the existing merge, and requires explicit opt-in for paid escalation.
- `live-gapfill.ts`: `runSourceGapfill()` keeps collecting free sources until qualified target or bounded plan exhaustion instead of stopping on the first raw rows.
- Source routing, source registry, M9, and universal signals: 81 tests pass. Final OR branches tested through row constraints and final qualification.

Broader understanding run: 386 pass, one observed failure in service-boundary product research. Original baseline did not include this suite; pre-existing status unproven. No unrelated location changes made.

## Phase 3 / 4 in progress

- `spec-search.functions.ts`: `preliminaryEligibility()` exposes cheap four-state decision using existing matching. Investor pre-screen preserves missing fields as researchable, rejects observed constraints only.
- `deep-pass.server.ts`: `splitBaseEligibility()` uses existing permissive pre-research gate; `rowHasVerifiedSignal(row,spec)` verifies actual requested claim/subject/window; investment evidence supported. Probes accumulate required AND evidence and use child abort signals on timeout/deadline/cancellation.
- Phase 2 additional fixes: gapfill merges before volume count/return; advertised investor/job web source now reachable, rows retain requested entity type.
- Validation pending: existing deep tests encoded structural-only stale evidence and post-deadline completion expectations; failures are under review against stricter requested behavior. No phase marked fully complete yet.

## Phase 4 / 5 verified changes

- Deep/custom/candidate-survival focused suites: 45 PASS. Stale-evidence and post-deadline expectations updated to require fresh research and real abort. New regressions assert the active hunter observes the abort signal, AND evidence accumulates across probes, and wrong claims cannot authorize contacts.
- `runSpecSearchCore()` now screens deduplicated DB/live candidates, including incomplete candidates, before batch enrichment. All research buckets remain in the pool; no final theorem rejects missing contacts before enrichment. Mandatory signal searches bypass early generic incomplete-contact enrichment.
- `enrichCandidatesForSpec()` skips contradicted or mandatory-signal-unsupported rows. Shared DB/live run budget bounds adapter count, contacts, paid calls and deadline; child signal aborts timed-out active adapters.
- `mergeEnrichmentIntoRow()` treats empty `allowedClaims` as deny-all.
- `compileCustomSignal()` supports `allowAI:false`, using existing deterministic fallback for free-only pipeline callers. Root `runStartedAt + rootRunBudgetMs` bounds signal research; already researched candidates do not repeat probes.
- Phase/order/enrichment/M9/new signals: 87 PASS. Absence/no-website/ledger/cancellation/requested-output: 84 PASS. New provider/AND/abort/contact/claim-authority regressions: 7 PASS. Custom compiler/deep/order combined: 61 PASS.

## Live status

Q5/Q11 BLOCKED: local Docker engine pipe unavailable; required local services on 8080, 8788, 8888 are down. No live-provider verification claimed. Resume with controlled `reports/continuation-2026-10-08-gates/run-live-final-gates.ps1` after services are healthy.

## Phase 6 / 7

- `outreach-draft.ts`: existing deterministic email/DM builders support grounded facts-only drafts, without implied hiring/customer claims or AI.
- `runSpecSearchCore()` creates optional `outreach_drafts` only on final qualified page rows, selecting a subject/type/parameter/time-verified evidence hook and the user's offer.
- `generate-modal.tsx`: draft textarea editable; copied/mailto content respects edits. No automatic send.
- `candidate-ledger.ts`: stage metadata records cheap eligibility and SUPPORTED/UNVERIFIED/CONTRADICTED/NOT_RESEARCHED_BUDGET/NOT_REQUIRED with reasons. Production screening invokes it; fate/duplicate accounting unchanged.
- `browser-research.ts`: mandatory unsupported signals suppress dedicated contact-page research; identity/fit and signal research remain available, dedicated no-website absence path retained.
- Outreach/ledger/order/new regressions: 43 PASS. Latest typecheck PASS before Phase6/7 additions; final gates pending.

## Final review corrections

- `canonical-contract.ts`: final location requirements honor every requested alternative and country normalization, repairing Q11 Toronto/Canada rejection without widening geography.
- `verification.ts`: current-window/current-calendar event evidence dated in the future fails; observed_at never substitutes for event_at.
- `source-pipeline.ts`: explicit requested/minimum count or plan desiredCount controls stopping; callers may supply desiredCount. Tests10/50/100 preserve target without numeric query wording.
- `enrichment-run.ts`: stable relevance/identity priority precedes spending shared budget.
- `qualified-lead.ts`, `qualified-lead-view.ts`, `scoring.ts`, `lead-segments.ts`, Discover targets and GenerateModal retain prepared grounded drafts through production projection and UI. Recipient/kind changes remount the editor; copied/manual-mailto content respects edits.
- `mergeCandidateLedgers()` preserves stage records through branches. Late screening uses the same budgeted helper, avoiding a second late compiler/research path.

Local commands and gate status are in TEST_REPORT. Task-only diff must be exported relative to the initial dirty checkpoint, not treated as the whole branch diff.
