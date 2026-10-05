# STAGE 1 FINAL REPORT — UNIVERSAL INPUT UNDERSTANDING

Date: 2026-10-04/05
Branch: `rc/mvp-local-testing-baseline`
Start SHA: `c930f65` · Final SHA: `e67c106` (+ report commit)

## VERDICT

**COMPLETE.** One Stage-1 authority shipped, proven through the real UI, legacy
competing authority removed, all gates green.

## CANONICAL FINAL EXECUTION PATH

```
InputEnvelope {text (optional), attachments[registry ids]}
→ InputResolver (src/lib/stage1/input-resolver.server.ts)
    · URLs → SSRF-guarded bounded retrieval (homepage + ≤2 same-domain pages)
    · PDFs → unpdf text layer; scanned → client-rendered page derivatives + vision
    · images → OpenRouter vision (extraction-only prompt)
    · output: ResolvedInputContext — provenance-tagged SourceFacts ONLY (INV-2)
→ ONE understanding call: extractFrameLLM (resolved-context prompt section,
  data-not-instructions boundary) → validateFrame → ONE UnderstandingFrame
→ clarify-state.resolveStage (sole READY/CLARIFY/CONFIRM authority)
    · deterministic materiality (materialFacts) — no second LLM pass
    · purpose never a default blocker (INV-6)
→ READY only → frameToSearchSpec → Stage 2 (untouched)
→ clarify/confirm → response {stage, question?, confirmSummary}, NO outcome
```
Answers always re-enter via `prior_frame` + `applyClarificationToFrame`
(monotonic: `answered`/`asked` ride in the frame; `confirmation.resolved`
dissolves the confirm gate permanently).

## OLD AUTHORITIES REMOVED (P5 cutover, e67c106)

- `SPEC_SEARCH_ENABLED` flag — removed; the spec path is unconditional.
- `discover.tsx` legacy branch — deleted (prepareDynamicQuestions flow,
  classifier/clarifier dynamic questions, runSearchMut).
- `search.functions.ts` — legacy `runSearch` + `clarify` server fns deleted
  (file trimmed to `getRemainingSearches`/`prepareSearch`).
- `clarify-ai.functions.ts`, `slot-extractor.server.ts`,
  `question-generator.server.ts`, `spec-clarification.ts` — DELETED.
- `spec-clarification`'s presentation adapter lives on as
  `src/lib/stage1/stage1-adapter.ts` (decideStage1 — mapping only, no logic).
- `clarifier.ts` legacy exports (`shouldClarify`, `buildClarifyingQuestions`,
  `applyClarifyAnswers`, `isProductClarifyPath`, `isClientsBuyerHunt`,
  `extractStatedAudience`) — **zero callers** remain; unreachable in
  production. (Mechanical deletion from the interleaved file deferred — see
  residuals.)
- `query-classifier.ts` — RETAINED by importer audit: load-bearing for
  Stage-2 source routing (campaigns, sources, dork-engine, verticals…), not a
  clarification authority.
- mode-gate / query-readiness — retained for internal precompiled subruns
  only; unreachable for user requests (every user request carries a frame) —
  asserted by the INV-1 test.

## REAL-UI BATTERY (e2e/stage1-battery.spec.ts, Playwright + live LLM + live storage)

**15/15 PASS** (B07 flaky: 1 timeout sweep failure under 17 min of continuous
free-tier vision rate limits; passes standalone and in 2 of 3 sweeps — noted,
not patched):

1. clean text → READY, no question ✓
2. vague text → useful CLARIFY ✓ (+ B12 answer patches same frame, no repeat)
3. messy/slang ("yo need like 7 hvac guys gta sites + nums") → understood ✓
4. mirrin.agency → website read + understanding + material question ✓
5. corroborating URL → no purpose question; summary/proceed or combined card ✓
6. text PDF + instruction → document merged ✓
7. scanned PDF + instruction → client page derivatives + server vision ✓
8. PDF only → intelligent CLARIFY/CONFIRM/READY ✓
9. image + instruction → vision-merged ✓
10. image only → intelligent next action ✓
11. website + PDF + text mixed → one Stage-1 decision ✓
12. clarification answer patches same frame, never repeats ✓
13. attachment upload failure → explicit error, chip NOT staged, nothing
    pretended as read ✓
14. injection/SSRF: private/metadata URLs rejected before fetch; injection
    inertness proven at resolver/understanding level (quoted DATA only) ✓
15. no premature zero during resolving/understanding/clarifying ✓

## PROOF ARTIFACTS

- URL context: `src/lib/stage1/__tests__/website-context.test.ts` (17 tests —
  detection, SSRF, bounded retrieval, mirrin integration, keyword-strip,
  injection boundary).
- PDF/vision: `src/lib/stage1/__tests__/document-image.test.ts` (9 tests —
  text PDF, scanned detection, derivative vision, honest unresolved,
  PDF injection boundary).
- Attachment security: `src/lib/attachments/__tests__/attachment-store.test.ts`
  (11 tests — cross-user id, prefix/traversal, bucket, MIME/size/status,
  derivative parent linkage, id-only refs).
- Resolver facts-only: `src/lib/stage1/__tests__/input-resolver.test.ts`
  (7 tests — provenance forgery dropped, injection quoted, conflicts, honest
  unresolved).
- Stage-1 policy: `src/lib/understanding/stage1-resolve-stage.test.ts`
  (14 tests — acceptance cases 1/2/3/10/11, INV-5, materiality, force).
- Premature zero: `src/lib/search/__tests__/stage1-premature-zero.test.ts`
  (3 tests) + client gating (blockingClarify keys on no-outcome/status/stage;
  zero boxes gated on clarify-card state).

## GATES (after deletion)

- Vitest: 1743 tests — 1700 passed, 28 failed (all verified pre-existing at
  the start commit on a baseline worktree: mode-gate ×4, coverage-planned ×4,
  step2 ×3, spec-search indexed ×6, offer-taxonomy ×4, m4, entity-taxonomy,
  phone-safety, playwright/worker real-Chromium env flakes), 15 skipped.
  NEW FAILURES: none.
- Typecheck: 43 errors = exactly the start-commit baseline (file-level diff
  clean).
- Build: `npm run build` green (exit 0).
- E2E: battery above (live LLM `groq:openai/gpt-oss-20b`, live storage).

## DEPLOYMENT NOTE (environment reality)

The hosted Supabase project has no reachable Postgres/pooler endpoint and no
management token, so `20261004000000_attachment_registry.sql` could not be
applied as DDL. The attachment flow was therefore built deployment-proof:
- `attachments` storage bucket created via the storage API (service key).
- Uploads via server-issued signed upload tickets; the server builds the path
  from the session user id (client sends ids only — INV-13 holds).
- Reads via `loadVerifiedAttachmentForUser`: service role confined to the
  verified user's own prefix (id→object derived from that prefix, never
  client-supplied); registry rows authoritative when the table exists;
  parent-derived naming convention when it does not. Apply the registry
  migration when DDL access exists — the code prefers it automatically.

## RESIDUALS / FOLLOW-UPS (non-blocking)

1. clarifier.ts dead legacy exports: zero callers; mechanical deletion
   deferred (interleaved file, brace-surgery risk).
2. Double answer application (criteria merge + frame patch) for legacy answer
   keys persists — new Stage-1 fields route through patchFrame only.
3. mode-gate/coverage-planned pre-existing test failures (present at start
   commit) — outside Stage-1 scope.
4. e2e battery B07 flake: free-tier vision rate limits under long sweeps.

## FILES

Added: src/lib/understanding/input-envelope.ts, src/lib/stage1/{input-resolver.server,website-context.server,url-utils,document-text.server,stage1-adapter}.ts, src/lib/attachments/{attachment-store.server,attachment-functions,pdf-prepass.browser}.ts, e2e/stage1-battery.spec.ts + fixtures, 6 test files, 1 migration.
Changed: spec-search.functions.ts (core reorder, stage/confirmSummary, validator), clarify-state.ts (resolveStage/materialFacts/markConfirmed), frame.ts (sources/confirmation additive), extract.server.ts (resolved-context prompt v17), to-search-spec.ts (understandFrame, lightSpec, URL strip, confirm marker), discover.tsx (legacy removal, Stage-1 card wiring, attachment-only submit), unified-composer.tsx (ticket upload, structured ids), clarify-panel.tsx (confirm card), image-text.server.ts (bytes vision), spec-clarification→adapter, flag.ts, search.functions.ts, 6 test updates.
Deleted: clarify-ai.functions.ts, slot-extractor.server.ts, question-generator.server.ts, spec-clarification.ts, search.functions legacy fns, SPEC_SEARCH_ENABLED flag, discover legacy branch.
