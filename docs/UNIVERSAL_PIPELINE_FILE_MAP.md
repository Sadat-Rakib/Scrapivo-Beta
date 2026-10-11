# Universal Pipeline File Map

Generated: 2026-10-09
Branch: `codex/universal-pipeline-map`
Base HEAD: `324f5459f3abf40d3b1b495b613b284b63e8af19`

## Preservation

- Full git status: `docs/universal-pipeline-checkpoint/git-status-full.txt`
- Tracked diff patch: `docs/universal-pipeline-checkpoint/tracked-changes.patch`
- Tracked diff stat: `docs/universal-pipeline-checkpoint/tracked-diff-stat.txt`
- Branch/head records: `docs/universal-pipeline-checkpoint/branch.txt`, `docs/universal-pipeline-checkpoint/head.txt`
- Relevant untracked inventory/copy attempt: `docs/universal-pipeline-checkpoint/relevant-untracked-files.txt`, `docs/universal-pipeline-checkpoint/untracked-relevant-copy/`
- Copied test/spec files under checkpoint were renamed with `.checkpoint` suffix so Vitest will not discover checkpoint copies. Restore names from `docs/universal-pipeline-checkpoint/renamed-test-copies-manifest.tsv` if using the copied checkpoint as source.
- Excluded from copy by scope: large provider/browser evidence, binary media, archives, `test-results/`, browser-session artifact trees, copied handoff directories, and secret-like environment data. Existing files remain in place.
- Existing `docs/UNIVERSAL_PIPELINE_FILE_MAP.md`: none found before this write.
- `i-have-adhd` skill: not found under project or user skill roots.

## Production Execution Path

Interactive production path:

1. `src/lib/spec-search.functions.ts:1235-3588` `runSpecSearchCore()` is main orchestrator.
2. `src/lib/understanding/to-search-spec.ts:782-EOF` `understandSearchSpec()` converts natural language to `SearchSpec`.
3. `src/lib/search/search-spec.ts:217-EOF` `buildSpec()` builds normalized spec data.
4. `src/lib/spec-search.functions.ts:1292-1293` creates candidate ledger through `createCandidateLedger()`.
5. `src/lib/spec-search.functions.ts:2468-2469` builds discovery plan through `buildSourcePlan()`.
6. `src/lib/spec-search.functions.ts:2514-2516` and `2738-2740` call `runLiveGapfill()`.
7. `src/lib/search/live-gapfill.ts:754-EOF` calls `runSourceGapfill()` and optional gates.
8. `src/lib/search/source-pipeline.ts:106-300` runs canonical provider pipeline.
9. `src/lib/spec-search.functions.ts:2380-2418`, `2853-2905` run incomplete/query-aware enrichment.
10. `src/lib/spec-search.functions.ts:3039-3065` runs deep signal pass when `spec.signal_required`.
11. `src/lib/spec-search.functions.ts:3000`, `3141+` call qualification/output stages.

Background jobs path:

1. `src/lib/search-jobs.functions.ts:112-116` starts job worker for batch/background modes.
2. `src/lib/jobs/worker.server.ts:19-28` starts in-process worker and imports pass runner.
3. `src/lib/jobs/pass-runner.server.ts:22-38` imports and calls `runSpecSearchCore()` for bounded job pass.

Research-agent path:

- `src/lib/research-agent/orchestrator.server.ts:302` calls `runSpecSearchCore()`.
- `src/lib/research-agent/orchestrator.server.ts:328-329` calls `runLiveGapfill()` directly for live research.

Outreach/contact path:

- `src/lib/search/qualify.ts:136-305` returns final qualification and outreach-relevant disposition.
- `src/lib/contact/discover-contacts.server.ts:122-EOF` discovers public contact channels used by enrichment.
- `src/lib/search/enrichment-run.ts:286-437` calls contact/site adapters and merges enrichment.

## PRD Files And Anchors

Ranges use current line starts and approximate end before next top-level declaration.

### Query Understanding

- `src/lib/search/search-spec.ts`
  - Types/interfaces: `SearchSpec` area `46-80` per PRD anchor; custom signal comment at `77`.
  - `getField()` `102-119`; callers include claim binding, verification, enrichment, qualify.
  - `investorSectorTokens()` `120-125`; `investorSectorMatches()` `126-133`.
  - `hasField()` `134-176`; `computeMissing()` `184-216`.
  - `buildSpec()` `217-EOF`; depends on criteria fields and entity-specific defaults.
- `src/lib/search/search-spec-extract.ts`
  - `extractTemporal()` `153-187`; `extractSalaryMin()` `188-216`.
  - `extractInvestorSlots()` `388-401`.
  - `extractSearchSpec()` `402-EOF`; text-to-spec parser fallback.
- `src/lib/understanding/to-search-spec.ts`
  - `normalizeSearchFrame()` `110-430`.
  - `entityFromFrame()` `431-443`; `lightSpecFromFrame()` `444-464`.
  - `frameToSearchSpec()` `465-651`; production frame-to-`SearchSpec`.
  - `understandFrame()` `750-781`; `understandSearchSpec()` `782-EOF`.
- `src/lib/search/claim-binding.ts`
  - `requestedClaimTypes()` `46-68`; maps requested fields/signals to evidence types.
  - `evidenceClaimType()` `69-73`; `asClaimEvidence()` `81-108`.
  - `isClaimAligned()` `109-117`; `isSubjectBound()` `118-EOF`.
- `src/lib/search/verification.ts`
  - `deriveTemporalConstraint()` `111-141`; `evaluateTemporalValidity()` `142-252`.
  - `deriveRequiredClaimParameters()` `253-292`; includes investment parameters at `255`.
  - `claimParametersMatch()` `320-372`.
  - `verifyClaimEvidence()` `485-562`; `verifyCandidateClaims()` `563-EOF`.

### Discovery And Volume

- `src/lib/spec-search.functions.ts`
  - `rowSatisfiesSpec()` `442-584`; strict post-research gate.
  - `rowSatisfyRejectReason()` `635-731`; strict reject reason.
  - `rowCouldSatisfySpec()` `732-896`; researchable pre-gate.
  - `runSpecSearchCore()` `1235-3588`; orchestrator.
  - Existing enrichment calls: incomplete DB `2380-2388`, DB query-aware `2401-2418`, live incomplete `2853-2860`, live query-aware `2889-2905`, deep-signal `3039-3065`.
- `src/lib/search/live-gapfill.ts`
  - `runSourceGapfill()` `467-753`; source discovery.
  - `runLiveGapfill()` `754-EOF`; live gapfill entry; imports spec gates at `780-786`.
- `src/lib/search/source-pipeline.ts`
  - `artifactToRow()` `69-105`.
  - `runCanonicalSourcePipeline()` `106-300`; provider loop/stopping/enrichment area includes PRD anchors `219-274`.
- `src/lib/search/source-plan.ts`
  - `deriveCoverageRequirements()` `98-137`.
  - `buildSourcePlan()` `211-309`.
  - `buildResearchPlan()` `401-526`.
  - `buildCandidateResearchQueries()` `527-577`.
  - `shouldInvokePaidSerp()` `578-599`; `resolveSourcePlanOutcome()` `600-EOF`.
- `src/lib/search/source-capabilities.ts`
  - Provider capabilities table before `199`.
  - `providerById()` `199-EOF`.
- `src/lib/search-jobs.functions.ts`
  - `toWireJob()` `31-35`; `jobNotFound()` `36+`.
  - Worker start path around `112-116`.
- `src/lib/jobs/worker.server.ts`
  - Job worker imports pass runner at `19`; owner/start at `23-28`.
- `src/lib/jobs/pass-runner.server.ts`
  - Imports `runSpecSearchCore()` at `22`; calls it at `38`.

### Cheap Pre-Screen

- `src/lib/spec-search.functions.ts`
  - `rowSatisfiesSpec()` `442-584`.
  - `rowSatisfyRejectReason()` `635-731`.
  - `rowCouldSatisfySpec()` `732-896`.
- `src/lib/search/qualify.ts`
  - `scoreRelevance()` `48-75`; `scoreIntent()` `76-95`.
  - `theoremCandidateFromRow()` `96-135`.
  - `qualifyLead()` `136-305`.
  - `applyQualificationGate()` `306-EOF`.
- `src/lib/search/candidate-ledger.ts`
  - `createCandidateLedger()` `98-222`.
  - `mergeCandidateLedgers()` `223-271`.
  - `streamedFateLabel()` `272-EOF`.

### Signal Verification

- `src/lib/signals/deep-pass.server.ts`
  - `splitBaseEligibility()` `119-149`; depends on `rowSatisfiesSpec()`.
  - `isVerifiedSignalEvidence()` `172-186`.
  - `rowHasVerifiedSignal()` `187-198`.
  - `runDeepSignalPass()` `309-513`.
  - `finalQualify()` `525-586`; calls `qualifyLead()`.
  - `createDefaultSignalHunter()` `659-730`.
  - `createCustomSignalHunter()` `778-EOF`.
- `src/lib/search/verification.ts`
  - `verifyClaimEvidence()` `485-562`.
  - `verifyCandidateClaims()` `563-EOF`.
- `src/lib/signals/custom-compiler.ts`
  - `compileCustomSignal()` `299-EOF`.
  - Deterministic fallback helpers `203-298`.

### Selective Enrichment

- `src/lib/search/enrichment-plan.ts`
  - `deriveEnrichmentRequirements()` `176-246`.
  - `buildEnrichmentPlan()` `247-380`.
  - `needsEnrichmentBeforeQualify()` `381-EOF`.
- `src/lib/search/enrichment-run.ts`
  - `defaultEnrichmentAdapters()` `120-285`.
  - `enrichCandidateForSpec()` `286-379`.
  - `enrichCandidatesForSpec()` `380-437`.
  - `enrichmentAdapter()` `438-EOF`.
- `src/lib/search/enrich-incomplete.ts`
  - `enrichSpecRowFromSite()` `46-91`.
  - `enrichIncompleteRows()` `92-EOF`.
- `src/lib/search/enrichment-merge.ts`
  - `mergeEnrichmentIntoRow()` `135-253`.
  - `preserveNoWebsiteOpportunity()` `254-EOF`.
- `src/lib/contact/discover-contacts.server.ts`
  - `discoverContacts()` `122-EOF`.
- `src/lib/search/canonical-contract.ts`
  - `queryRequiredFields()` `171-218`.
  - `fieldTiersFor()` `219-254`.
  - `isQualificationBlockingField()` `255-259`.
  - `resolveFinalOutcome()` `279-296`.
  - `evaluateQualifiedLeadTheorem()` `297-488`; calls `requestedClaimTypes()` around `452`, `verifyCandidateClaims()` around `472`.

### Final Qualification And Output

- `src/lib/search/qualify.ts:136-305` `qualifyLead()`.
- `src/lib/search/canonical-contract.ts:297-488` `evaluateQualifiedLeadTheorem()`.
- `src/lib/spec-search.functions.ts:3000` inline `qualifyLead()` decision mapping.
- `src/lib/spec-search.functions.ts:3141+` late result/persistence/output shaping.

### Candidate Ledger And Reliability

- `src/lib/search/candidate-ledger.ts:98-222` `createCandidateLedger()`.
- `src/lib/search/candidate-ledger.ts:223-271` `mergeCandidateLedgers()`.
- `src/lib/search/candidate-ledger.ts:272-EOF` streamed fate label.
- `src/lib/spec-search.functions.ts:1292-1293` ledger creation.
- `src/lib/jobs/job-engine.server.ts:167-333` job claim/lease/release worker loop.

## Main Dependencies

- `runSpecSearchCore()` depends on understanding/spec conversion, canonical data sources, source planning, live gapfill, enrichment, deep signal pass, qualification, ledger, persistence.
- `runLiveGapfill()` depends on source pipeline, OSM/jobs/web/browser adapters, and optional imported spec gates.
- `runCanonicalSourcePipeline()` depends on source adapters from plan/capability selection.
- `runDeepSignalPass()` depends on `rowSatisfiesSpec()`, `qualifyLead()`, signal hunters, and claim/evidence structures.
- `qualifyLead()` depends on `evaluateQualifiedLeadTheorem()` and verification/canonical contract.
- Background jobs depend on job worker/engine plus `runSpecSearchCore()` through pass runner.

## Baseline Status

- No baseline tests run in this Phase 0 map-only pass.
- Existing dirty tree was preserved before this file was created.
- Existing defects not classified here; implementation agents should use checkpoint files before edits.
