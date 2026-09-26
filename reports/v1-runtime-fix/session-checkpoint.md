# Scrapivo V1 Runtime Completion Checkpoint

Date: 2026-09-24
Status: Main restored with authorization; P0 edits saved; DB deadline/cancellation fixed; real localhost acceptance still failing because SaaS browser candidates are not yet becoming final UI rows.

## Completed

- Read repository AGENTS.md, RTK instructions, investigate-first and caveman skills.
- Created the active V1 completion goal.
- Checked branch, working tree, latest commit, divergence and overlapping edits.
- Confirmed `main` is an ancestor of HEAD using `git merge-base --is-ancestor main HEAD` (exit 0).

## Git Evidence

- Current branch: `main`. The user explicitly approved advancing local main and switching; completed without changing HEAD or discarding local work.
- HEAD: `b8d238c655beb11273f885d34994cf664f114a12`.
- Local main now: `b8d238c655beb11273f885d34994cf664f114a12`; previously `f41ebdacb7b7ef38914d5a3f4febc7b248e33723`.
- Current branch is `main`; local `main` is 4 commits ahead of `origin/main` and not ahead of itself. Earlier main-ancestor prerequisite is satisfied.
- Previously confirmed feature commits now included on local main:
  - `f3e67bb feat(research): add initial agentic research pipeline`
  - `b8d238c feat(research): finalize testable MVP and developer handoff`
- Committed difference: 33 files, 4412 insertions, 16 deletions.
- Existing uncommitted tracked difference: 46 files, 3768 insertions, 1263 deletions; many additional untracked files.
- Committed/uncommitted overlap includes package.json, package-lock.json and src/lib/research-agent.functions.ts.

## Saved Files And Confirmed P0 Findings

- `src/routes/_authenticated/discover.tsx`: removed optional research run that replaced canonical results. The configured `USE_RESEARCH_AGENT_DISCOVER=true` made this branch relevant. Added stale-turn/cancellation guards; canonical pagination remains.
- `src/lib/search/search-spec.ts`: business category is optional; broad businesses with a location can search.
- `src/lib/search/browser-live.server.ts` and its test: existing agent-browser adapter now searches public pages and extracts entities supported by observed quotations. Fatal failures propagate, source failures stay isolated.
- `src/lib/research-agent/agent-browser-cli.server.ts`: cleanup can run after caller cancellation.
- `src/lib/search/live-gapfill.ts`: browser runs alongside existing structured providers on every production live invocation; merge preserves distinct entities sharing source URLs.
- `src/lib/spec-search.functions.ts`: qualified DB sufficiency, requested batch target, browser run ID and request cancellation, incomplete live enrichment, entity deduplication, dev-only forced live, noun-only founder mode.
- `src/lib/search/read-parquet.server.ts` and `src/lib/search/people.server.ts`: DB reader deadline/cancellation implemented. Observed scan of 387,515 rows now stops at 15 seconds with `coverageIncomplete`; live enrichment follows.
- Browser real path now uses DDG/Bing selectors, actual body text and source isolation. SearXNG remains unreachable but nonfatal.
- Focused regression files updated/added under `src/lib/search/__tests__` and `src/lib/__tests__`.
- `e2e/v1-runtime.spec.ts`: real Playwright capture probe; no provider/result mocks. Captures API payload, rendered text and screenshot under reports/v1-runtime-fix.
- Important acceptance nuance: `e2e/v1-runtime.spec.ts` can pass as a capture probe even when returned rows are zero. Capture PASS is not V1 acceptance PASS.
- These files already had substantial user work; git diff against HEAD includes pre-existing changes, not only this task.

## Not Completed

- Focused suites reported: UI/spec 65 passed; initial browser/research 45 passed; updated browser failure suite 15 passed; integration focused 17 passed; complete mode-gate 14 passed after fixing incomplete test fixtures; DB deadline/cancellation 9 passed; latest browser+integration 22 passed.
- Full typecheck remains failing (77 errors across 18 files reported). Workers found none in their newly changed files; full-tree status remains unresolved.
- Earlier real Playwright login and `saas founders` submit on http://127.0.0.1:8082 timed out before canonical response; that stale blocker was DB retrieval without deadline/cancellation.
- Current real SaaS runtime reaches browser extraction and observes 1-8 people candidates but still returns 0 final rows. Role/company fields and filtering root issue were fixed; employment bindings observed. Active work is extraction missing industry/company.
- Canada broad business UI returned 1 DB card with no category clarification/dentists/wrong-zero regression. Browser yielded 0 because of earlier LLM input budget failure; that path is now bounded.
- User-authorized local main fast-forward and switch completed. No commit, push, stash, reset, merge, clean or discard performed.
- The main-only prerequisite is satisfied.
- P1 result quality, P2 social/registry, P3 coverage and actual browser-candidate-to-UI proof remain pending.

## Next Action

User explicitly authorized installed Playwright for real UI testing after computer-use browsers were unavailable. Existing app on port 8080 remains. Task-owned server is on 127.0.0.1:8082, PID 38112, logs runtime.log/runtime.err here. Prior task-owned npm server also exists on 8081 (parent PID 44336), but RTK buffers its logs. Do not restart a live process merely because observation expires.

Next: root is running real SaaS on the unchanged 8082 server. Do not touch code while that run is active. Inspect response, screenshot and actual browser logs after the run completes. No V1 completion claim until real localhost browser candidates produce UI rows.

## Continuation update — 2026-09-24

- The active `saas founders` run completed: browser discovery returned three candidates, but the final UI response contained zero rows. The evidence is in `reports/v1-runtime-fix/saas-founders/result.json` and `runtime.log`.
- The saved browser probe confirms candidates had grounded founder roles and companies, but no industry value; the source page explicitly labels the list as SaaS founders. `browser-live.server.ts` now retains the page introduction and instructs extraction to use explicitly scoped list headings as quoted industry evidence.
- `spec-search.functions.ts` now includes live-browser candidates in raw/post-filter counts and reports `FILTERED_BY_SPEC` when candidates exist but fail the spec filter, instead of reporting zero raw candidates or masking the drop as a source outage.
- No tests or build were run in this continuation. Manual acceptance remains outstanding: rerun `saas founders` in Discover and confirm evidence-backed rows appear. Canada business regression and full typecheck also remain outstanding.
- Started the local Vite server on `127.0.0.1:8082`; `/discover` returned HTTP 200 after initial compilation. Manual test URL: `http://127.0.0.1:8082/discover`.
- Files changed in this continuation: `src/lib/search/browser-live.server.ts`, `src/lib/spec-search.functions.ts`, and this checkpoint.
- No commit, push, or destructive git action was performed.

## Clarifier fix — 2026-09-24

- Root cause confirmed from the saved Discover response: `SaaS founders` finished a long search with zero rows, then thin-result clarification added both location and seniority. The seniority option was also not forwarded by the panel mapper, allowing it to repeat.
- Directory searches with unresolved mode now ask browsing vs selling before retrieval, including bare founder searches. Selling asks for an offer; after mode/offer, an unstated location is asked before launching search. Worldwide is an explicit option and is retained as `geo_scope`.
- Person thin-result follow-ups no longer ask seniority, and do not repeat location after a worldwide selection.
- The browser search query now includes the selected location and business model alongside role/category/industry terms.
- Files changed: `src/lib/spec-search.functions.ts`, `src/lib/search/clarifier.ts`, `src/lib/search/browser-live.server.ts`, `src/routes/_authenticated/discover.tsx`, focused existing regression tests, and this checkpoint.
- `git diff --check` passes. No test/build was run. The existing dev server serves `/discover` with HTTP 200 at `http://127.0.0.1:8082/discover`; manual testing remains the next step.

## Retrieval and browser progress fix — 2026-09-24

- Confirmed global people searches were explicitly skipped by the Postgres index guard, then fell into a broad S3 scan. Worldwide people queries with a role or industry now use selective indexed filters; SaaS includes the explicit `software as a service` industry spelling.
- Browser search now builds the web query from extracted entity/criteria rather than replaying conversational wording. Extractor input likewise receives structured intent.
- The existing live browser path now clicks search results when possible, falls back to a verified public URL navigation, scrolls actual pages, and publishes actual search/click/navigation/scroll/read/extraction steps to the active Discover run. Progress reads are authenticated, owner-scoped, bounded, and expire after ten minutes.
- Focused tests pass: 5 files, 51 tests (`search-index`, browser discovery, live gapfill, thin clarification, and mode gate). `git diff --check` passes. The filtered TypeScript check reports no errors in changed search/UI files; full `tsc --noEmit` still reports unrelated existing errors in other files/tests.
- `/discover` returns HTTP 200 at `http://127.0.0.1:8082/discover`. The saved runtime log/results are from 6:45 AM, before these changes; a fresh authenticated SaaS founders/global run is still needed to verify live DB rows and visible progress end-to-end.
- Files changed: `src/lib/indexed/search-index.server.ts`, `src/lib/indexed/search-index.server.test.ts`, `src/lib/search/browser-live.server.ts`, `src/lib/search/browser-live.server.test.ts`, `src/lib/search/live-gapfill.ts`, `src/lib/search/__tests__/thin-ask.test.ts`, `src/lib/search/search-browser-progress.server.ts`, `src/lib/spec-search.functions.ts`, `src/routes/_authenticated/discover.tsx`, and this checkpoint.
- Next manual test: open Discover at the URL above, enter `SaaS founders`, choose the intent, select worldwide, and confirm the activity list shows real search/result/click/scroll/read steps while indexed results load. Check rows and inspect the new server log if zero remains.
