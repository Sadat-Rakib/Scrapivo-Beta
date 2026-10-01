# Scrapivo MVP local checkpoint — 2026-09-29

**Verdict: not ready for release.** The canonical interpretation and clarification path is implemented and focused checks pass. End-to-end row delivery and repository gates remain unproven or failing.

## Finished

- `UnderstandingFrame` now carries purpose, OR locations, unresolved values, exclusions, and requested outputs into `SearchSpec` without a second legacy raw-query extraction. Explicit purpose and D2C facts omitted by live providers receive narrow, recorded repairs.
- One SPEC clarification decision handles critical ambiguity, missing purpose, and continuation from the prior frame. Typed and panel answers patch that frame. Guided chips start category-specific clarification rather than invented example queries.
- OR location retrieval branches and merges rows. Exclusions, required website/social fields, social research needs, and social freshness checks reach execution and qualification.
- Public activity labels hide infrastructure names while retaining the allowlisted progressive result row. The browser panel remains visible from session start, and the clarification panel scrolls on mobile.
- Added focused tests for semantic conversion, clarification continuation, OR geography, exclusions, requested fields, activity presentation, and mobile panel behavior.

Saved implementation files: `src/lib/understanding/{frame,fallback,lexicon,vocab,validate,clarify-state,extract.server,to-search-spec,purpose}.ts`; `src/lib/search/{search-spec,spec-clarification,canonical-contract,qualified-lead-view,browser-research,source-plan,activity-presenter,clarifier}.ts`; `src/lib/spec-search.functions.ts`; `src/lib/research-agent/orchestrator.server.ts`; `src/routes/_authenticated/discover.tsx`; `src/components/discover/{clarify-panel,discover-welcome-hero,entity-detail-panel,result-tabs,scrapy-browser}.tsx`; `src/components/lead-card.tsx`; corresponding new focused test files under `src/lib/understanding`, `src/lib/search`, and `src/components/discover`.

## Evidence

| Check | Result |
| --- | --- |
| Focused new tests | 25 passed, 0 failed. |
| Frozen semantic stress, seed 27491 | 78/100 fully correct; extraction 100/100, negation 9/9, requested fields 11/11. Five genuine misses involve misspelled place names. The scorer also has string-vs-array entity and OR-location comparison defects, and older purpose expectations conflict with the new purpose policy. See `../understanding-forensic/STRESS_RESULTS.json`. |
| Real understanding providers | 17/17 queries returned provider frames, 0 fallback. Saved raw outcomes in `LIVE_PROVIDER_RESULTS.json`; `LIVE_PROVIDER_REPROCESSED.json` applies current deterministic frame repairs to those same saved frames without new provider calls. |
| Local Playwright browser | Two searches completed, each visiting 11 real pages with 26 progress events and a screenshot. Both returned 0 candidate rows, so qualification and streaming never began. See `BROWSER_SMOKE_FOUNDERS.json`, `BROWSER_SMOKE_BUSINESSES.json`, and the copied JPGs. |
| Full tests, excluding unrelated `.kilo` worktree | 1,317 passed, 59 failed, 11 skipped. Failures span older clarification expectations and retrieval/qualification tests; see `FULL_TEST_RESULTS.json`. Exact `npm run test` also includes the unrelated duplicate worktree. |
| `npm run typecheck` | Fails with 43 errors in files outside this implementation set. See `TYPECHECK_LOG.txt`. |
| `npm run build` | Client assets compile. SSR/Nitro build fails with Windows virtual-memory exhaustion; a 1.5 GB Node heap retry fails at its heap limit. See `BUILD_SERIAL_LOG.txt` and `BUILD_CAPPED_LOG.txt`. |
| `git diff --check` | Passes. |

## Remaining work

1. Trace browser search result relevance and entity extraction until a candidate is produced, then verify at least one relevant row streams through the authenticated UI. The browser screenshots and progress alone do not prove row delivery.
2. Review the 59 full-test failures individually, update obsolete expectations only where the new contract requires it, and fix real retrieval or qualification regressions.
3. Re-run typecheck and build after the existing type errors are resolved and with enough build memory; verify an authenticated desktop and mobile Discover session.
4. Recheck the five typo-place cases without weakening location precision.

No commit, push, deployment, or production Supabase/S3 write was made. Existing `freehire`, `.kilo`, and other pre-existing untracked reports were left alone. Only the two browser-session directories created for this checkpoint were removed after their screenshots were copied here.
