# PIPELINE_MAP — Scrapivo MVP recovery

The REAL implementation path (query submission → delivery), verified against the working tree at HEAD `2d73279`, branch `rc/mvp-local-testing-baseline` (Oct 2026). Every stage cites current `file:line`. Supersedes the pre-fix conceptual maps in `reports/core-forensic/02-full-execution-map.md` (many entries there were "inferred"; all are resolved here) and `reports/core-pipeline-audit/EXECUTION_MAP.md`.

Legend: **[ledger]** = the transition is recorded in the candidate ledger (`src/lib/search/candidate-ledger.ts`).

---

## 1. Client submission

| Step | Where |
|---|---|
| Composer submit | `src/routes/_authenticated/discover.tsx:1644` `beginSearch(q)` — mints turn id into `pendingTurnIdRef` (`:1678`), clears `pendingTurnAnswersRef` (`:1679`) |
| Run identity / session | `src/lib/search/search-run-client.ts:35` `ActiveSearchSession.begin()` (`:82`) — creates `search_run_id`, `conversation_id`, `turn_id`, AbortSignal; stale runs aborted via `accept()` (`:114`) |
| Server call | `discover.tsx:1704` → `runSpecBranch` (`:662`) → `runSpecSearch` server fn |
| Answer round-trip | clarify panel answers → `specAnswersFromPanel` (`discover.tsx:1023`) → `runSpecBranch(query, turnId, answers, force)` (`:2487-2512`); answers accumulate in `pendingTurnAnswersRef` (`:671`) |
| Stop / cancel | `discover.tsx:1493` `stopSearch()` — viewport-anchored floating Stop button (`:2378-2386`, fix `f255750`/`C14`) → `cancelSearchRun` (`src/lib/search/search-run.functions.ts`) → `cancelRegisteredSearchRun` (`src/lib/search/search-run.server.ts:39`) |

## 2. Server entry + run budget

| Step | Where |
|---|---|
| Server fn | `src/lib/spec-search.functions.ts:2828` `runSpecSearch = createServerFn(...)` → handler `:2846`: `requireMyAuth`, deps assembly |
| Cancellation + deadline | `src/lib/search/search-run.server.ts:54` `beginRegisteredSearchRun` — per-owner run registry; flat `MAX_RUN_MS = 120_000` (`:19`) or adaptive budget `120s + 20s × requested target`, capped 10 min (`:22`, `:87-91`; fix `29cab9e`); stale-conversation runs aborted (`:69-77`); deadline abort reason `SEARCH_DEADLINE` (`:91`) |
| Progress registry | `src/lib/spec-search.functions.ts` → `beginSearchBrowserProgress` (`src/lib/search/search-browser-progress.server.ts:58`); events published via `publishSearchBrowserProgress` (`:68`), read by client poll `getSearchBrowserProgress` (`spec-search.functions.ts:2881`, handler `:2884`; polled at `discover.tsx:143`) |
| Core orchestration | `spec-search.functions.ts:1071` `runSpecSearchCore()` — the whole pipeline below lives inside this one function |

## 3. Understanding (query → frame)

| Step | Where |
|---|---|
| Gazetteer warm-up | `spec-search.functions.ts:1189` (`gazetteer.server` `ensureCityGazetteer`) |
| LLM understanding | `spec-search.functions.ts:1190-1192` → `understandSearchSpec` (`src/lib/understanding/to-search-spec.ts`) — 12 s LLM budget → `extractFrameDeterministic` fallback (`src/lib/understanding/fallback.ts`); intent-signal survival fixed in `66bf2c5` (C11/C13: `corpus.ts`, `fallback.ts`, `lexicon.ts`, `vocab.ts`, `to-search-spec.ts`) |
| Prior-frame continuation | `spec-search.functions.ts:1190-1192` `frameToSearchSpec(applyClarificationToFrame(opts.priorFrame, answers))` for pending-clarify rounds |
| Frame → spec | `spec-search.functions.ts:1196-1228` — prior answers merged as stated criteria; entity answer aliases (`:1210-1223`) type an unknown entity; `buildSpec` (`src/lib/search/search-spec.ts`) |
| Off-topic router | `spec-search.functions.ts:1232-1252` — `OFF_TOPIC_RE` + `DOMAIN_NOUN_RE` → `UNSUPPORTED_CAPABILITY` boundary message, no retrieval |

## 4. Clarification (BEFORE any searching)

| Step | Where |
|---|---|
| Missing-field computation | `spec-search.functions.ts:1253-1255` `computeMissing` (`src/lib/search/search-spec.ts`) → `spec.status` |
| Clarify decision | `spec-search.functions.ts:1256-1270` → `decideSpecClarification(spec, force)` (`src/lib/search/spec-clarification.ts:25`; state machine fixed by `ec85bb9`, `01d2b68`, force/amount contract by `f9c83eb`). Returns a question payload — retrieval never starts while `needs_clarification` |
| Bare-query readiness | `spec-search.functions.ts:1279-1290` `evaluateQueryReadiness` (`src/lib/search/query-readiness.ts`) — one highest-information question for bare asks; `force` ("Search" button) bypasses except unknown entity (`:1273-1274`) |
| Client answer mapping | `discover.tsx:1023` `specAnswersFromPanel` + thin-ask handling `:726-738` (thin-ask-on-outcome renders zero chrome, fix `f9c83eb`) |

## 5. Stored retrieval (DB-first)

| Step | Where |
|---|---|
| Injectable readers | `spec-search.functions.ts:1516-1527` — `searchPeopleDB/searchCompaniesDB/searchBusinessesDB/searchInvestorsDB` (`src/lib/canonical/*.server.ts`), `queryIndexForSpec` (`src/lib/indexed/search-index.server.ts`) |
| Coverage plan | `spec-search.functions.ts:1627` `selectCoverageSources` (`src/lib/search/coverage-selector.ts`) — tier steps with per-tier `timeoutMs` (`DEFAULT_TIMEOUTS` `coverage-selector.ts:72-79`: hot-index 4 s, s3-parquet 60 s, provider 20 s) |
| Hot-index tier | `spec-search.functions.ts:1785-1810` `withTierTimeout(indexer(...))` (`:350`) |
| S3 parquet tier | `spec-search.functions.ts:813` `fetchS3Tier`, called at `:1809-1815` with internal scan deadline (`Math.min(15_000, ...)`) |
| OSM local tier | `spec-search.functions.ts:1671` `searchOsmLocalBusinesses` (`src/lib/search/osm-local-businesses.server.ts`) |
| Jobs tier | `spec-search.functions.ts:1571-1595` `fetchSpecJobs` (`src/lib/search/jobs-provider.ts`) — 60 s tier budget |
| Completeness enrich | `spec-search.functions.ts:2014-2015` `enrichIncompleteRows` (`src/lib/search/enrich-incomplete.ts`) |
| DB pre-count | `spec-search.functions.ts:2058-2059` `applyWhyMatchGate` (`src/lib/search/live-gapfill.ts:411`) → `qualifiedDbCount`; drives the live trigger |
| Sanitize / row gates | `spec-search.functions.ts:192` `stampSpecOpportunity`, `:199` `sanitizeSpecRow`, `:404` `rowSatisfiesSpec` (strict), `:538` `rowCouldSatisfySpec` (pre-research, hard contradictions only) |
| Merge + **[ledger]** | `spec-search.functions.ts:2037-2042` `mergeDuplicateCandidates`/`mergeReportPairs` (`src/lib/search/candidate-merge.ts`) → `ledger.merged(absorbed, survivor)` + `ledger.retrieved(row)` for every funnel entrant (fixes `7bfc657`, `e22d44f`, `f9c83eb`) |

## 6. Source plan / acquisition routing

| Step | Where |
|---|---|
| Execution plan | `spec-search.functions.ts:2084-2085` `buildSourcePlan` (`src/lib/search/source-plan.ts`) |
| Yield reorder | `spec-search.functions.ts:2088-2107` `reorderByYield` (`src/lib/search/source-yield.server.ts`) — decayed historical yield reorders plan steps |
| Registry policy gate | `src/lib/search/source-plan.ts:122-133` — registry decision `disabled` blocks the mapped plan provider (`needs_key` stays plannable) |
| Substantive discovery queries | `src/lib/search/source-plan.ts:381` `keepSubstantive` (filler `"startup"` ban, fix `df383d1`); discovery-only SERP-gate starvation fallback (`f9c83eb` post-mortem in `reports/final-stabilization/DEFECT_STATUS.md` C8 row) |
| Live trigger | `spec-search.functions.ts:2127` — live gapfill runs when `forceLiveDiscovery || spec.signal_required || needs_live || qualifiedDbCount < requestedTarget` |
| Deadline semantics | `spec-search.functions.ts:2111-2114` — `SEARCH_DEADLINE` finalizes accumulated candidates; only user cancel / stale run discards work |

## 7. SearXNG / public path

| Step | Where |
|---|---|
| Live gapfill entry | `src/lib/search/live-gapfill.ts:689` `runLiveGapfill` |
| SearXNG plan step | `live-gapfill.ts:585` (providerId `searxng` / `direct-http` steps) |
| SearXNG client | `src/lib/search/searxng.server.ts` — engine pools (`:39-83`), cache (`:150-170`), circuit breaker `SEARXNG_CIRCUIT_BREAK = 2` (`:35`), rate pacing (`:184`) |
| Provider ladder | `src/lib/search/provider-ladder.ts:83-131` — `SEARXNG_URL` unset → `SEARXNG_UNCONFIGURED`; probe fail → `SEARXNG_UNREACHABLE`; fallback providers per `.env.example:26-31` |
| Web-hit evidence | `live-gapfill.ts:261` `evidenceFromWebHit` (`extraction_method: "searxng_snippet"`), `:334` `deriveWhyMatch` |
| Diagnostics **[ledger]**-adjacent | `spec-search.functions.ts:2152-2177` — provider attempts drained to yield learning; `SOURCE_UNAVAILABLE`/`SOURCE_ERROR` pushed into `routeDiagnostics` (feeds `sourceHealth` on the zero screen) |
| Social signal step | `spec-search.functions.ts:2206-2244` `runSocialSignalGapfill` (`src/lib/search/social-signal.ts`) when `signal_required` |
| **Widening passes: IN FLIGHT** — an agent is concurrently adding widening to `src/lib/search/spec-search.functions.ts` (widen-on-thin pool growth). The job-engine widening primitive already exists: `b7dd6b3` WS1 ("durable search-job engine … widening, pause/stop checkpoints"). Do not treat widening call sites in `spec-search.functions.ts` as final until that work lands. | |

## 8. Browser worker

| Step | Where |
|---|---|
| Adapter | `live-gapfill.ts:695-697` → `discoverWithBrowser` (`src/lib/search/browser-live.server.ts:628`) |
| Browser acquisition | `browser-live.server.ts:10` `buildDefaultAgentBrowser` — in-process Playwright or worker (`src/lib/research-agent/playwright-browser.server.ts`, `worker-browser.server.ts`) |
| Navigation policy | `src/lib/search/browser-policy.server.ts:40-56` `resolveNavigationPolicy` (pacing, per-domain/per-candidate/per-run budgets, cooldowns; Workstream E `1fcd28d`, run-level page budget `5cd3629`) |
| SERP acquisition + triage | `browser-live.server.ts:293-318` `serpResultShares`/gate + triage score `> -50` hard-negative filter (`09b3d58`, Workstream G) |
| Entity extraction | `browser-live.server.ts:467` `extractEntities` (LLM extract 15 s, `:538`; observed-fallback `:477`) → `browserEntitiesToRows` (`:319`, with reject reasons) |
| Structured rows | `browser-live.server.ts:238` `structuredBusinessRows` (JSON-LD), `:596` `structuredSnippetRows` |
| Contact observation | `browser-live.server.ts:80` `observedContactDetail` — contact-page excerpts with `source_url ≠ identity source` (fix `a29d4b8`, C5); `:56` `withProvenance` |
| Two-stage streaming **[ledger]** | `browser-live.server.ts:694-715` `rowEvent` (`provisional` vs `verified`) + `announceVerified` — verified announced exactly once (fix `7bfc657`, C10); `spec-search.functions.ts:1112-1117` books `ledger.streamed(row)` per streamed row |
| Deadline finalize | `browser-live.server.ts:1439-1461` — on deadline hands back researched candidates with `status: "deadline"`; only user cancel is a cancellation |
| Challenge / HITL | `src/lib/search/scrapy-browser.server.ts:19-37` — `FRICTION_CHALLENGES` (CAPTCHA/LOGIN_WALL/ACCESS_BLOCK/RATE_LIMIT) set session `challenge`; detection feeds human takeover (`21e0284`, Workstream F), status projection to UI (`a045f57`); takeover UI `src/components/discover/scrapy-browser.tsx` (pause/resume/give-back) |

## 9. Live rows → funnel

| Step | Where |
|---|---|
| Pre-research gate **[ledger]** | `spec-search.functions.ts:2192-2199` — `rowCouldSatisfySpec` else `ledger.filtered(r)` |
| Researchable pool **[ledger]** | `spec-search.functions.ts:2319-2326` — pool merge + `ledger.retrieved` per pool entrant |
| Enrichment | `spec-search.functions.ts:2281-2282` `enrichIncompleteRows` for live-incomplete rows |
| Final merge **[ledger]** | `spec-search.functions.ts:2293-2298` |
| Contact resolution | `src/lib/contact.functions.ts` `resolveLeadContact` (on demand from UI) + browser-observed contacts in §8 |

## 10. Qualification + verification + delivery

| Step | Where |
|---|---|
| Strict gates | `spec-search.functions.ts:404` `rowSatisfiesSpec` (location `locationSatisfies`, role, industry, contact, signal); unproven → `ledger.filtered(row, "UNPROVEN_CRITERION")` (`:2383`) |
| Theorem qualification **[ledger]** | `spec-search.functions.ts:2390-2392` `qualifyLead` (`src/lib/search/qualify.ts:136`) → `ledger.decided(row, decision)`; why-match theorem gate `applyWhyMatchGate` at `:2419-2498` (fail → `ledger.gated(row, "SIGNAL_NOT_VERIFIED"|"WHY_MATCH_GATE")` `:2498`) |
| Verification | `SpecRow.verification_status` (`spec-search.functions.ts:167`), website-absence research `SpecRow.no_website_verification` (`:116`, honest-zero note `:2628-2629`), observed contact evidence (§8) |
| Finalize | `spec-search.functions.ts:1126-1155` `withRun` → `finalizeSearchOutcome` (`src/lib/search/search-run.ts`) — outcome codes SUCCESS / NO_QUALIFIED_RESULTS / SEARCH_CANCELLED / UNSUPPORTED_CAPABILITY; `qualified_count` = theorem-qualified only (`:700`, `:727`) |
| hasMore honesty | `spec-search.functions.ts:2565-2604` — `hasMore`/`moreAvailableMessage` require delivered rows (`f9c83eb`) |
| Ledger close-out **[ledger]** | `src/lib/search/candidate-ledger.ts:63` fates `returned|qualified_more|rejected|gated|filtered|incomplete|excluded|absorbed|unaccounted`; `:135` `streamed`, `:144` `merged`, `:171-193` `summary()` with `accounting {retrieved, fated, unaccounted, ok}` and `streamedNotReturned`; `:227` `streamedFateLabel`; `:199` `mergeCandidateLedgers`. L05 proof: `{retrieved:148, fated:148, unaccounted:0, ok:true}` (`reports/full-e2e-validation/DEFECTS.md` FINAL STATUS table) |

## 11. Frontend rendering

| Step | Where |
|---|---|
| Response handling | `discover.tsx:717` `session.accept(res)`; thin-ask/zero-chrome branching `:726-770`; zero narrative `:767` `enrichZeroNarrative(zeroResultsNarrative(res.retrievalTrace), res.candidateLedger)` (`src/lib/search/outcome-ui.ts:32,71`) |
| Streaming rows | `discover.tsx:2419` — poll events filter `rowStatus !== "provisional"` (two-stage streaming, `e22d44f`) |
| Zero screen | `discover.tsx:2207-2209`, `:2293-2295` — enriched zero narrative incl. `streamedNotReturned` reconciliation |
| Projections | `src/lib/search/qualified-lead-view.ts` → result cards/tables `src/components/discover/result-tabs.tsx`; detail `entity-detail-panel.tsx`; lead card a11y `lead-card.tsx` (C7 `a6dc035`) |
| Browser panel | `src/components/discover/scrapy-browser.tsx` — activity, mini-browser, takeover, challenge banner |
| A11y sheets | sr-only DialogTitles on the three untitled sheets (`7097bf8`: `src/components/app-shell.tsx`, `discover.tsx`); scroll/a11y hardening rerun evidence `2d73279` — **scroll fix polish in flight** |

---

## Candidate ledger transition map (compact)

```
retrieved(row) ── merged(absorbed,survivor) ── filtered(row,reason)
      │                                            │
      ├── streamed(row) [provisional|verified] ────┤
      │                                            │
      └── decided(row, qualifyLead) ── returned / qualified_more / gated /
                                      rejected / incomplete / excluded
summary(): { counts per fate, rejectReasons, streamedNotReturned[],
             accounting{retrieved, fated, unaccounted, ok} }
```
File: `src/lib/search/candidate-ledger.ts` (`createCandidateLedger` `:93`, fate list `:63`, accounting `:171-193`).

## Known map gaps / in-flight

- **Widening passes** in `spec-search.functions.ts`: **in flight** (concurrent agent). Primitive exists in job engine (`b7dd6b3`).
- **SearXNG startup health check**: **in flight**; today health is only probed per-call (`provider-ladder.ts:83-131`) and reported per-search via `routeDiagnostics` → `sourceHealth` (`spec-search.functions.ts:2167-2177`).
- `BrowserNavigationPolicy` pacing fields are not consulted by `browser-live` (only worker run budget) — ledgered deferral in `reports/final-stabilization/DEFECT_STATUS.md` §DEFERRED.
- C12 claim-aware evidence beyond contact: deferred with reason (`reports/final-stabilization/DEFECT_STATUS.md` row C12).
