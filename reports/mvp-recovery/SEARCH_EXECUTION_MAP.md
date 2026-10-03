# SEARCH_EXECUTION_MAP — Scrapivo read-only forensic audit (2026-10-02)

Scope: real UI query submission → lead rendered OR terminal zero/cancel/error.
Method: code-read at HEAD `a547842` + replay evidence from the 2026-10-02 acceptance battery (`evidence/runs/{W2,T2,C2,B2,D2,N2}.json`, funnel lines in `logs/dev-live.log`). No code was modified. Where runtime evidence is insufficient, the missing instrumentation is named explicitly — nothing is guessed.

Legend per transition: **file · function · lines · input → output · state mutated · signal? · failures · telemetry · caller↔callee**

---

## 1. EXECUTION PATH

### 1.1 Composer submission
- `src/routes/_authenticated/discover.tsx` · `UnifiedComposer` (component) + `onSubmit` → `beginSearch(q)` · :1800 `runSearchMut.mutate` (legacy tab path), :1412-1415 chat path defers `beginSearch` 200 ms · input: query string → output: turn added, `activeQuery` set.
- State mutated: `runInFlight=true` (synchronous, :680 in `beginSearch`; :1422 chat-scheduled), `zeroNarrative=null`, `streamedMissing=[]` (:688-691).
- Signal: none yet (client). Failures: none. Telemetry: none. Callee: `beginSearch` (:675).

### 1.2 Session/run creation (client)
- `src/lib/search/search-run-client.ts` · `ActiveSearchSession.begin` :35-160 · input: conversation/turn ids → output: `{run:{search_run_id,...}, signal}`; mints run ids via `createSearchRun`; stores `controller` (AbortController).
- State: `active`, `pending`, `controller`. Signal: the controller's signal IS the fetch signal. Failures: supersession (newer begin aborts prior — `supersededIds`). Telemetry: `[ui-projection]` console line.
- `cancel()` :168-179 aborts the fetch + clears active (see §P1-E).

### 1.3 Server entry + deadline creation
- `src/lib/spec-search.functions.ts` · `runSpecSearch` (createServerFn) :3075-3130 · input: `{query, limit?, offset, answers, prior_frame, force, search_run_id, conversation_id, turn_id, request_id}` → output: SSE/result payload.
- Deadline: :3103-3116 `beginRegisteredSearchRun({..., maxRunMs: scaledRunBudgetMs(requested)})` → `src/lib/search/search-run.server.ts:87-110` — `setTimeout(abort(controller, SEARCH_DEADLINE_REASON), budgetMs)`; budget = clamp(120s + 20s×requested + WIDEN_RESERVE 120s, 5s..600s) (`scaledRunBudgetMs` :129-131). **The deadline lives ONLY in this controller; everything downstream must observe `deps.signal`.** UI-typed queries: `data.limit` undefined → `requested=25` → 600s.
- Failures: budget abort (`SEARCH_DEADLINE`), request-disconnect (hosting-dependent — discover.tsx:679-680 calls `cancelRun` explicitly because propagation is not guaranteed).
- Telemetry: `[spec-run] forced live discovery` (force only); run registry (`runs` Map, TTL).

### 1.4 Core orchestration
- `runSpecSearchCore` spec-search.functions.ts:1087+ · input: query + deps (liveGapfill, browserProgress, ownerId, signal) → output: `SpecSearchResult` (rows, outcome, candidateLedger, retrievalTrace, widening…).
- Sub-steps (all signal-aware via `deps.signal` unless noted):
  - ids + `createCandidateLedger` :1120-1128 (ledger: every entrant gets exactly one fate; `unaccounted` counts streamed-never-returned).
  - understanding → spec (§1.4a) → stored retrieval :2064-2081 (`applyWhyMatchGate` → `qualifiedDbCount`; POOL_OVERFETCH business×3/min30, person×7/50 :2068-2081).
  - live gate :2149: `liveOpt !== null && (forceLiveDiscovery || signal_required || needs_live || qualifiedDbCount < requestedTarget)`.
  - `runLiveGapfill` (§1.6) → pre-research gate :2213-2221 `rowSatisfyRejectReason` :538-604 (drops hard contradictions WITH reasons since 0406d24) → enrichment → widen loop :2296-2470 (bounded 3 passes; budget mirror `scaledRunBudgetMs(requestedTarget)`; first-pass floor 60s; per-pass re-gate + ledger) → post-research strict gate :2609-2657 (deep-signal pass for signal runs; `disposition === "qualified"` filter) → delivery :2766-2779 (`ledger.delivered(page, rest)`).
- Failure modes: `SEARCH_CANCELLED` rethrow path returns empty honestly (:2670-2680); deadline finalizes accumulated rows (`deadlineHit`).
- Telemetry: `[candidate-ledger]` dev dump :2881+ (funnel/counts/rejectReasons/incompleteReasons/perSource/widening/timings — fires when retrieved > 0).

### 1.4a Understanding → parser → spec
- `src/lib/understanding/to-search-spec.ts` · LLM ladder + `extractFrameDeterministic` fallback (12 s budget :513-514) → `frameToSearchSpec` :295 → SearchSpec (+`applyClarificationToFrame` :425 for resume).
- Parser internals (fallback.ts, ~2800 lines): `classifyHead` (extract.server.ts) → head noun + entity type; place spans (`takePlace` :2299); verb-split block :2310-2332 (ACTIVITY_VERB_TOKENS — **shared with place-span + peeling logic, lexicon.ts:1116/:1129**); relation reader `detectRelation` (extract.server.ts:1074) → `relType`; constraints `detectConstraints` :1659; category descriptor finalize :2488-2510 (generic heads name no category).
- Clarify evaluation :2840-2884: `missing_target` / `unreadable_relation` / `underspecified_scope` → `frame.clarification`.
- State: frame.target.{entity_type,role,category,industry}, frame.location, relation, constraints. Signal: none (pure, 12 s self-budget on the LLM ladder only).
- Telemetry: frame.meta.notes.

### 1.5 Clarification / resume
- Blocking clarify: payload `clarification.needed` → UI clarifier → answer → `beginSearch` again with `answers` → `applyClarificationToFrame` (to-search-spec.ts:425) → second `runSpecSearchCore`. **Each submit creates a NEW registered run with a FRESH budget** (relevant to P1-A: the hang was in the post-answer phase, which had its own 540 s).
- `syncClarification` (clarify-state.ts:613) re-evaluates after validation — the site that re-fired clarification in the Phase 9 experiments.

### 1.6 Provider scheduling / acquisition
- `src/lib/search/live-gapfill.ts` · `runLiveGapfill(spec, {searchRunId, signal, onBrowserProgress, ownerId, desiredCount, initialCandidates, widen, widenPass})` — runs providers: osm-local (osm-local-businesses.server.ts:406, specific tags then `office=company` fallback :369-398; widen passes skip fallback since e474494), direct-http + searxng (SearXNG_UNREACHABLE when Docker down), html-parser, sitemap-jsonld, paid-serp (skipped_free_first), browser-live.
- Provider diagnostics: `ProviderDiagnostic` (source-plan.ts:95, `queryFunnel?` added) — attempted/succeeded/degraded/artifacts/qualified/latency/queries/pages/challenge/retries.
- Signal: passed through to providers. Failures: per-provider `SOURCE_UNAVAILABLE/ERROR` (routeDiagnostics). Telemetry: perSource in the ledger dump; `[browser-funnel]` per query.

### 1.7 Browser-live (the Windhoek-class path)
- `src/lib/search/browser-live.server.ts` · `discoverWithBrowser(spec, deps)`:
  - per-pass funnel open :1561 (`passNumber`), close/flush :1610/:1647.
  - `search()` :840-993: engines duckduckgo → bing (searxng first when healthy); SERP gate `serpResultShares` (C8) + starvation fallback :840-848; challenge regex :386.
  - staged allocation :1611-1618 (post-1bcb6f8): direct sites ×3 + directory ×1 (`isDirectoryHost` :389-403 + DIRECTORY_HOSTS list), cap reason preserved.
  - `readPage` :1004-1013 (pageTrace: read/http_read/cached/nav_failed/blocked/unsupported/budget).
  - `extract()` :1209-1240: `structuredBusinessRows` (JSON-LD) first; then `extractEntities` (§1.8) on ranked modelPages; funnel counters at every boundary (entitiesExtracted/normalizedRows/normalizationRejections/emittedRows).
  - `browserEntitiesToRows` :397-470: identity/quote provenance checks, LIST_PAGE_AS_ENTITY, `kindSupported` :388-402 (**entity-kind gate** — see P1-B), field quote-subject-binding; org-field fallback for business kind (360fef6).
  - `remember` + two-stage streaming :686-725 (`rowEvent` provisional → verified; `streamedKeys` first-once).
  - candidate research loop :1255+: first-party domain probes, contact reads (`readPage(..., "candidate_research")`), per-candidate `visitedUrls` cap 4, research slice cap 2 :1409-1416.
  - worker adapter: `src/lib/research-agent/worker-browser.server.ts:57-80` — CANCELLED -> SEARCH_CANCELLED / SEARCH_DEADLINE / SEARCH_STALE_RUN by abort reason (33b2e91); worker `session-manager.ts` (gotoGuarded :219-243, agentOnly/HUMAN_CONTROL :210-211, cancel :93).
- Signal: `deps.signal` threaded into adapter calls; the worker maps aborts to CANCELLED (reason preserved since 33b2e91).


### 1.8 Extraction providers (P1-C site)
- `extractEntities` browser-live.server.ts:582-660. Input: ranked modelPages (term-scored, top 2, ~12k chars/page) -> output: `BrowserExtractedEntity[]`.
- Stage 1 — `observedFallback()` (:594-637): deterministic regexes. **Person branch**: founder cards ("Name / Founder / Company / View Bio") + founder sentences. **Company branch**: SaaS/software card+sentence patterns only. **No business/local branch** — for local-business queries the deterministic stage always returns [].
- Stage 2 — LLM `aiComplete` (ai/router.server): task "extract", json, temperature 0, maxTokens 2400, timeoutMs 15000, cacheSalt "browser-live-subject-research-v6"; returns up to 10 entities.
- Circuit breaker: `extractionModelUnavailableUntil` cooldown -> report("deterministic","breaker").
- **Collapse point:** empty model output, unparsed JSON, breaker, thrown extractor errors (catch :1236-1238), and genuinely-zero entities ALL surface as `entities.length === 0` -> funnel `extractionEmpty++` (:1229/:1237). The discriminator exists in the trace (`report(extractor, llm, entities, detail)` -> "ok" / "empty" + "unparsed_or_empty(N chars)" / "breaker" / extract-failed log) but the funnel does not aggregate it.
- Signal: NO AbortSignal reaches `aiComplete` (timeoutMs only) — a stalled provider slot burns <=15s per call but cannot hang the run.
- Telemetry: `kind:"extract"` trace events (extractor, llm, entities, detail); funnel counters.

### 1.9 Enrichment -> qualification -> verification -> merge -> delivery
- Enrichment: `src/lib/search/enrichment-run.ts` (rethrows SEARCH_CANCELLED at :228/:271/:357 — signal-checked); contact enrichment inside browser-live candidate research (first-party probes :1255+, per-candidate visitedUrls cap 4, readPage "candidate_research").
- Qualification: pre-research gate `rowSatisfyRejectReason` (spec-search:538-604, books the failing dimension since 0406d24) at :2213-2221/:2445-2461; post-research strict gate :2609-2657 (`finalQualify`/deep-signal for signal_required; `disposition === "qualified"` filter — theorem-qualified rows only).
- Verification: m9/m11 theorem callers; two-stage streaming (browser-live :686-725) — `rowEvent` emits `rowStatus: provisional` at remember(), `verified` exactly once when the strict gate passes (C10 contract).
- Merge/dedupe: `mergeDuplicateCandidates` (spec-search :2032+) + `mergeReportPairs` -> `ledger.merged` (absorbed fate; visible in accounting).
- Delivery: :2766-2779 `ledger.delivered(page, rest)`; `moreAvailableMessage` only when delivered > 0.
- Settlement: `finalizeSearchOutcome` (search-run.ts:85) at :1131/:2632 -> outcome -> payload -> ledger dev dump :2881+.
- Conservation verified on every settled battery run: `retrieved = fated`, `unaccounted: 0`.

### 1.10 Zero-state UI / cancellation / cleanup
- Zero chrome gate: discover.tsx:2280-2295 — `!runSearchMut.isPending && !specPending && !runInFlight && clarifyQs.length === 0 && all row arrays empty`; terminal toast :892-898 guarded by `turnId === pendingTurnIdRef.current`.
- Submit -> Stop: composer button becomes Stop when `pending && onStop` (unified-composer.tsx, e3f7fdd) -> `stopSearch` discover.tsx:1494-1502.
- `stopSearch` -> `ActiveSearchSession.cancel({clearActive:true})` (search-run-client.ts:168-179: aborts the fetch controller) + `cancelRun({search_run_id})` server call (wired :681-684 on the abort listener, because request-disconnect propagation is hosting-dependent) -> registry aborts the controller with SEARCH_CANCELLED -> core check-points throw -> honest partial return.
- Late-event safety: `session.accept(res).ok` + `pendingTurnIdRef.current !== turnId` (:717); stale projection guard (m11-ui-run.test.ts:387-413); supersession tracking (`wasSuperseded`).
- Fire-and-forget work that continues by design: source-yield drains (`void import(...)` spec-search:2192-2199), telemetry — none can mutate run state.
- Takeover (WS6 evidence): session-manager.ts:210-211 (agentOnly / HUMAN_CONTROL 409), exclusive hand-off + fresh-snapshot resume + person-keeps-control tests (session-manager.test.ts 16/16); worker-adapter takeover/give-back/close (7/7); scrapy-challenge state machine (4/4); scrapy-browser banner/poll component (8/8).

---

## 2. THE FIVE DEFECTS — root-cause locations

### P1-A — T2/N2 outlive the 540-second deadline after clarification
Verified: each clarify answer starts a NEW registered run with its own budget (sections 1.3/1.5) — the hang is inside the post-answer run, not one budget spanning both. Every core check-point observes `deps.signal`; T2's case-level wait reached 4853s with `settled=false` (the SSE outcome never arrived), N2 672s.
Ruled out by code-read: source-yield drain (fire-and-forget), aiComplete (15s timeout), overpass (own timeouts), readPage (navTimeoutMs), enrichment-run (signal rethrows), widening loop (budget mirror + abort checks).
**Insufficient evidence to name the exact await.** Required instrumentation: (1) a registry watchdog emitting `{stage, elapsedMs}` when `elapsed > budgetMs` (stage tracked at each top-level await of `runSpecSearchCore` — live-gapfill internals, enrichment, finalize); (2) per-await signal wrapping on the post-clarify path. Repro beds: T2 and N2.

### P1-B — C2 person-kind normalization rejections
Path: extraction emits `kind:"person"` photographers -> browserEntitiesToRows:397 -> identity/quote checks pass -> :457 `kindSupported("person", quotes)` — person regex :391 (founder|ceo|...|she|he|his|her) matches none of the "wedding photographer Cebu" quotes -> ENTITY_TYPE_MISMATCH, continue. The org-field fallback (360fef6) covers kind==="business" only.
Exact rejection condition: person-kind + no person-token in identityQuote/field quotes + no business fallback.
Smallest safe change: at :457 extend the fallback to person-kind entities carrying role/company fields (structural person-card proof), mirroring the business fix; keep vague/missing-identity rejections.
Regression test: browser-trace.test.ts — photographer person-card fixture normalizes to a person row; a no-signal person entity is still rejected.

### P1-C — B2/D2 EXTRACTION_EMPTY
The zero collapses four distinct causes at browser-live.server.ts:1229 (the :1237 catch) — empty result and thrown extractor error both `extractionEmpty++` — with the true cause recorded only in trace detail ("breaker" / "empty" + "unparsed_or_empty(N)" / failed-log). Underlying for B2/D2: `observedFallback` has NO business/local patterns (always [] for these queries), so everything rides on the LLM ladder, whose providers were quota-exhausted during the battery.
Smallest safe change: aggregate `report()` reasons into `f.extractionCauses` (additive funnel field) — no behavior change — then rerun B2/D2; if the cause is provider quota, that is an environmental dependency, not a code defect.

### P1-D — Phase 9 do-verb tail capture
Traced: the tail is consumed BEFORE the verb-split block — phrase is already the bare head when :2310 runs (probe: phrase="companies", verbAt=-1); the relation reader then marks "doing ..." unknown and drops the object (:2882). Adding do-verbs to the shared ACTIVITY_VERB_TOKENS (lexicon:239) regressed 16 corpus tests because the same set drives place-span (:1116) and phrase-peeling (:1129) decisions globally.
Correct capture point (code-proven): the relation-evaluation block fallback.ts:2812-2846 — when relType is unknown/offers_service/none, category+industry empty, entity business-class: read the do-verb object from `frame.input.normalized`, set `frame.target.category` via openValue, upgrade entity_type unknown->business with a literal-shaped value, reset relation to "none" ONLY when it was "unknown". Vague objects stay unreadable (they are worth a question — understanding.test.ts:617).
Status: implemented and verified on all four directive shapes (entity + activity + location + ready_to_search), but reverted bundled with the token-set change before a corpus re-run isolated it. Landing requires `npx vitest --run src/lib/understanding` back at the 16-KNOWN_RED baseline with the fix in place.

### P1-E — Composer Stop continue-after-cancel risks
Chain verified: click -> stopSearch:1494-1502 -> client abort + cancelRun -> registry abort -> core throws SEARCH_CANCELLED -> honest partial return; late events dropped (session.accept + turnId); worker sessions close (tests); fire-and-forget drains continue harmlessly; intent enrichment covered by intentAbortRef.
Risks that could continue: (1) the P1-A class of un-signal-checked awaits (a hung await ignores cancel AND deadline — T2 is the live repro); (2) the auto-resolve contact loop :1456-1481 — guarded, runs post-search; (3) retained browser sessions are view-only by design.
Evidence gap: no live cancel-during-browsing run against the NEW composer Stop yet (X01) — required for the release gate.

### Shared architectural causes across the five failures
1. **Keyword lists acting as semantics.** The same pattern produced P1-B (person-kind regex missing trade words), P1-D (do-verbs missing from a shared token set whose other consumers made the change unsafe), and the original craftTags gap. Trade knowledge is scattered across independent regexes/sets with no single source of truth, so each new trade silently fails at a different layer.
2. **Signal/timeout coverage is per-call-site, not structural.** Every await must opt in to the run signal; one omission (P1-A/P1-E) detaches a stage from cancellation and the deadline with no telemetry saying so.
3. **Cause-collapsing telemetry.** Distinct failure modes share one counter (P1-C extractionEmpty; earlier the ledger rejectReasons {}) — the system knows the cause but does not surface it, which is why every defect surfaced as "zero, reason unknown" first.
4. **Single-run single-owner invariant is sound** — the takeover/cancel failures were NOT architectural; the handshake tests and the abort-reason preservation hold.

---

## 3. ONE COMPLETE CHRONOLOGICAL CHAIN — W2 ("Find 12 solar panel installers in Windhoek, Namibia with public phone numbers")

1. Submit -> runInFlight=true, session.begin mints ids (discover.tsx:675-697).
2. POST runSpecSearch -> beginRegisteredSearchRun budget 600s (UI default requested=25).
3. Understanding: extractFrameDeterministic 33ms -> spec: entity=business, category="solar panel installer", location=Windhoek, contact=phone; no clarify.
4. Stored retrieval 5.3s -> 0 rows -> live gate fires (:2149).
5. runLiveGapfill pass 1: osm-local 22.5s -> 149 artifacts (generic office=company fallback) -> pre-gate rejected_category x149; direct-http/searxng SOURCE_UNAVAILABLE; browser query 1: SERP ok, 10 links -> 2 accepted (cap 8, pre-Phase-3) -> 2 pages -> 9 entities -> ENTITY_TYPE_MISMATCH x8 -> 0 emitted.
6. Widen pass 2: OSM specific-only (e474494) + browser query 2 -> COVERAGE_EXHAUSTED (2 empty passes).
7. Finalize -> NO_QUALIFIED_RESULTS -> ledger dump unaccounted:0 -> zero chrome + terminal toast.
Post-fix state (77b9cb6/6bf6d31/360fef6/1bcb6f8): the same chain emits 1 candidate (Densys Renewable Energy) which passed the pre-gate via trade families; research/verification was not reached within the window in that run.

---

## 4. FILES THAT MUST NOT BE TOUCHED by the five fixes
- src/lib/understanding/lexicon.ts — shared ACTIVITY_VERB_TOKENS (the P1-D regression source).
- src/lib/understanding/corpus.ts and the 16-KNOWN_RED expectations.
- src/lib/search/candidate-ledger.ts conservation semantics (additive fields only).
- Two-stage streaming block browser-live.server.ts:686-725 (C10 contract).
- Post-research strict gate spec-search.functions.ts:2609-2657 and the C5 contact/evidence contracts.

## 5. FOCUSED REGRESSION TESTS required per fix
- P1-A: run-level watchdog unit test — a scripted await that ignores the signal must still produce a finalized outcome + watchdog event before 2x budget.
- P1-B: browser-trace.test.ts — photographer person-card fixture normalizes to a person row (no ENTITY_TYPE_MISMATCH); a no-signal person entity is still rejected.
- P1-C: browser-live funnel test — scripted extractor failure asserts extractionCauses.model_failed >= 1, distinct from deterministic_empty.
- P1-D: informal-activity.test.ts (already written, skipped) — unskip once the :2812-block fix lands WITH a green understanding corpus.
- P1-E: X01 cancel during browsing against the composer Stop — stop button clickable, <=30s settle, no post-cancel rows, session cleaned.

## 6. IMPLEMENTATION ORDER
1. P1-C funnel split (diagnostics only, zero risk) -> rerun B2/D2 -> names the extractor cause.
2. P1-B person-kind org/role fallback -> C2 rerun.
3. P1-A watchdog instrumentation -> T2/N2 rerun -> pin the exact await -> fix that await.
4. P1-D land the :2812-block capture + corpus baseline check -> N2 rerun.
5. P1-E live X01 cancel proof -> full six-query battery re-grade -> verdict flip decision.

## 7. EVIDENCE GAPS (instrumentation needed — do not guess)
- P1-A: per-await stage/elapsed telemetry on abort (the hung await is not observable today; T2/N2 are the repro beds).
- P1-C: extraction causes aggregated in the funnel (the discriminator exists in trace detail; not summed).
- P1-E: cancel-during-browsing proof with the new control (X01) — pending.

---

*Audit method note: every file:line above was read directly at HEAD a547842 (plus the five recovery commits) during this session; runtime claims come from the 2026-10-02 acceptance battery artifacts (evidence/runs/*.json + .response.txt, logs/dev-live.log funnel and ledger dumps) and the focused test suites cited. Nothing was modified; this file is intentionally uncommitted.*
