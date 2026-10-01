# Relevant files at baseline `7805e75e452d925a6d88e3db880622fdb2f35207`

Scope: files on the active Discover intake, understanding, clarification, SearchSpec, planner, progress, and browser paths. Working tree already had a modified `freehire` entry and unrelated untracked reports/session artifacts; none were touched. `*` marks a hot semantic-loss or presentation boundary.

| Path | Role and key symbols | Upstream caller | Downstream consumer; why it matters |
| --- | --- | --- | --- |
| `src/routes/_authenticated/discover.tsx` * | Composer `beginSearch`, `runSpecBranch`, clarification answers, activity render | User input, quick chips | `runSpecSearch` or legacy `runSearch`; new composer turn resets pending query and answers; progress shown here |
| `src/components/discover/unified-composer.tsx` | Search composer and example text | Discover page | `beginSearch`; raw text intake |
| `src/components/discover/discover-welcome-hero.tsx` * | `QUICK_CHIPS`, `onQuickSearch` | Discover page | `beginSearch`; pills inject executable demo queries |
| `src/lib/spec-search.functions.ts` * | `runSpecSearchCore`, `runSpecSearch`, `getSearchBrowserProgress`, `getScrapyBrowserState` | Discover spec branch | Understanding, readiness, source tiers, progress; merges answers as flat criteria and ignores frame-native clarification |
| `src/lib/understanding/extract.server.ts` * | `extractFrameLLM`, prompt `u1-v15` | `understandSearchSpec`, inspector | Provider router then frame validator; first model semantic boundary |
| `src/lib/ai/router.server.ts` | `aiCompleteDetailed` | LLM extractor | Provider ladder/circuit breaker; provider failure triggers fallback |
| `src/lib/ai/providers.ts` | Provider/model registry and ladder | AI router | Model selection and configuration |
| `src/lib/understanding/fallback.ts` * | `extractFrameDeterministic`, `detectLocation`, `detectConstraints` | LLM fallback, test harness | Validator/bridge; location, contacts, signals, negation, placeholder extraction |
| `src/lib/understanding/lexicon.ts` | Token repair/phrase lexicon | Fallback extractor | Deterministic spelling and phrase recognition |
| `src/lib/understanding/vocab.ts` | Task/entity/relation/mode labels | Frame, fallback, validator | Canonical terms; open descriptors remain allowed |
| `src/lib/understanding/frame.ts` | `UnderstandingFrameSchema`, target/relation/location/constraints/evidence/output schemas | LLM and fallback | Validator, clarification, bridge; richest semantic object |
| `src/lib/understanding/validate.ts` * | `validateFrame` | Extractor | Clarification and bridge; repairs can change extracted meaning |
| `src/lib/understanding/clarify-state.ts` * | `BLOCKING_FIELDS`, `blockers`, `patchFrame`, `syncClarification` | Inspector server functions | Frame-native clarification; separate from active spec search gates |
| `src/lib/understanding/understanding.functions.ts` | `understandQuery`, `answerClarification` | Understanding inspector | Frame-native extraction and monotonic answer patch; diagnostic path, not Discover search execution |
| `src/components/discover/understanding-inspector.tsx` | Frame/debug viewer | Discover UI | Inspector server functions; helps inspect extraction but does not control search |
| `src/lib/understanding/to-search-spec.ts` * | `normalizeSearchFrame`, `frameToSearchSpec`, `understandSearchSpec`, `isActionableFrame` | `runSpecSearchCore` | SearchSpec; reuses legacy parser and selectively overlays frame, dropping many deliverables/signals |
| `src/lib/search/search-spec.ts` * | `SearchSpec`, `computeMissing`, `buildSpec` | Bridge and legacy extractor | Readiness, planners, qualification; flat criteria omit first-class goal/output requirements |
| `src/lib/search/search-spec-extract.ts` * | `extractSearchSpec`, `extractGeo`, `extractSalaryMin`, `extractBusinessModel` | Bridge and legacy callers | SearchSpec; independently re-parses raw text and seeds criteria |
| `src/lib/search/location-resolver.ts` * | `resolveCanonicalLocation`, provisional location resolution | Fallback, legacy extractor, bridge | SearchSpec geography; unfamiliar spans can be accepted as stated locations |
| `src/lib/search/query-readiness.ts` * | `evaluateQueryReadiness` | `runSpecSearchCore` | Clarification for selected bare queries; no general goal requirement |
| `src/lib/search/mode-gate.ts` * | `detectModeFromQuery`, `interpretModeAnswer`, `isDirectoryEntity` | `runSpecSearchCore` | Browse/sell question; regex treats `find me`/`need` as looking and actionable frames bypass gate |
| `src/lib/search/clarifier.ts` * | `shouldClarify`, `buildClarifyingQuestions`, `applyClarifyAnswers` | Legacy search/UI preview | Legacy dialog; can ask unrelated business-model questions |
| `src/lib/search/query-classifier.ts` | `classifyQuery`, `inferGoalFromQuery` | Legacy `runSearch`, UI preview | Legacy clarifier/planner; second understanding system |
| `src/lib/search.functions.ts` * | `runSearch`, `prepareSearch` | Discover legacy branch | Classified-query plan and source fanout; may diverge from spec path |
| `src/lib/search/playbook-planner.ts` | `buildSearchPlan`, `sourcesFor` | Legacy `runSearch` | Legacy source plan; provider IDs originate here |
| `src/lib/search/source-plan.ts` | `buildSourcePlan`, coverage requirements | Spec search | Source tiers; consumes executable SearchSpec fields |
| `src/lib/search/coverage-selector.ts` | `selectCoverageSources` | Spec search | Index/S3/live tier selection |
| `src/lib/indexed/search-index.server.ts` | `queryIndexForSpec` | Spec search | Indexed candidates; sees flat criteria |
| `src/lib/object-index/retrieval-plan.ts` | `retrievalPlanFromSpec` | Spec search | Object index; sees flat criteria |
| `src/lib/research-agent/plan.ts` | `buildResearchPlan` | Live browser gapfill | Browser tasks; reads some attached frame fields, but not all requested contacts/enrichment |
| `src/lib/search/browser-research.ts` | `researchNeedsForCandidate` | Live/browser research | Candidate evidence requests derived mainly from criteria and qualification |
| `src/lib/search/live-gapfill.ts` * | `runLiveGapfill`, `shouldBrowse` | `runSpecSearchCore` | Structured sources then browser when verified count below target |
| `src/lib/search/activity-presenter.ts` * | `presentActivityEvent`, `SOURCE_LABELS`, `INTERNAL_RE` | Progress registry | Public event fields; unredacted provider strings demonstrably pass |
| `src/lib/search/search-browser-progress.server.ts` * | `publishSearchBrowserProgress`, `readSearchBrowserProgress` | Spec search | Process-local event registry polled by Discover |
| `src/components/discover/result-tabs.tsx` | Raw source/platform label render | Result data | User-facing provider leak surface outside activity presenter |
| `src/components/discover/entity-detail-panel.tsx` | Raw evidence `source` render | Result data | User-facing provider leak surface outside activity presenter |
| `src/components/discover/clarify-panel.tsx` * | Inline `ClarifyPanel` | Discover question state | Mobile question/options/footer layout; no height cap or internal scroll |
| `src/components/app-shell.tsx` * | `AppShell` viewport and main-column wrappers | Authenticated route shell | Discover layout; `100dvh`/hidden overflow bounds the mobile clarifier and composer |
| `src/components/discover/scrapy-browser.tsx` * | `ScrapyBrowser` | Discover progress region | Polls browser state; hides unless run, state, and visited page exist |
| `src/lib/search/scrapy-browser.server.ts` * | Session registry, `scrapySessionStarted`, `readScrapyBrowserState` | Playwright adapter | Process-local, owner-scoped browser state/screenshots |
| `src/lib/search/browser-live.server.ts` * | `buildDefaultAgentBrowser`, `discoverWithBrowser` | Live gapfill | Defaults to in-process Playwright adapter |
| `src/lib/research-agent/playwright-browser.server.ts` * | `getBrowser`, `PlaywrightBrowserAdapter` | Browser-live | Dynamic `playwright-core` Chromium launch and screenshots |
| `src/lib/research-agent/agent-browser-cli.server.ts` | CLI adapter | Browser-live when flagged | Alternate local browser execution |
| `src/lib/research-agent.functions.ts` * | `researchWorker`, worker server functions | No Discover import found | External worker needs URL/token; not wired into current Discover page |
| `vercel.json` | Production build/install config | Vercel | No Chromium install/runtime declaration |
| `package.json` | Runtime and dev dependencies | Build | `@playwright/test` dev dependency; no direct runtime `playwright-core` declaration |

## Diagnostic files

`reports/understanding-forensic/stress.mts`, `CORPUS.json`, and `STRESS_RESULTS.json` contain the frozen 100-case deterministic run. `trace.mts` and `TRACE.jsonl` contain boundary snapshots and one live provider sample. Existing `scripts/verify-understanding.mts` and `src/lib/understanding/corpus.ts` supplied the 80 seeded holdout/chaos cases.
