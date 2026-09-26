# Scrapivo `/discover` search execution map

Traced from the route's `runSpec` call and server imports/call sites. This is the active spec-search branch; the route also imports a legacy `runSearch` path, which is bundled for comparison. Source paths below are relative to the repository root.

```text
/discover UnifiedComposer.onSubmit
  → discover.tsx:onSubmit → runSpecBranch → runSpecSearch (server function)
  → spec-search.functions.ts:runSpecSearchCore
  → understandSearchSpec → extractSearchSpec / frameToSearchSpec
  → stored index/canonical retrieval → spec matching + DB enrichment
  → buildSourcePlan → runLiveGapfill when coverage or live need requires it
      → runSourceGapfill → free provider ladder / OSM / jobs
      → discoverWithBrowser → AgentBrowserCliAdapter
          → search → navigate/click/scroll/extract → browserEntitiesToRows
          → isVerified callback from runSpecSearchCore
      → source pipeline + entity resolution + qualification
  → enrichIncompleteRows / enrichCandidatesForSpec
  → applyWhyMatchGate → applyQualificationGate → qualifyLead
  → merge/dedupe/rank/page → SpecSearchResult.rows
  → discover.tsx:projectSpecRowsToQualifiedViews → result sections/cards
```

| Stage | File / function | Called by | Calls / purpose |
| --- | --- | --- | --- |
| UI input | `src/routes/_authenticated/discover.tsx` `onSubmit`, `runSpecBranch` | `UnifiedComposer` | Starts `ActiveSearchSession`, submits `runSpecSearch`, polls browser progress, rejects stale replies. |
| Server entry | `src/lib/spec-search.functions.ts` `runSpecSearch` | `runSpecBranch` | Authenticates, registers run/cancellation, calls `runSpecSearchCore`, closes progress in `finally`. |
| Understanding | `src/lib/spec-search.functions.ts` `runSpecSearchCore` | `runSpecSearch` | Calls `understandSearchSpec`; uses deterministic `extractSearchSpec` and `buildSpec`/clarifier paths. |
| Understanding adapter | `src/lib/understanding/to-search-spec.ts` `understandSearchSpec`, `frameToSearchSpec` | `runSpecSearchCore` | Converts the understanding frame into the executable `SearchSpec`; `src/lib/search/search-spec-extract.ts` handles deterministic extraction. |
| Stored retrieval | `src/lib/spec-search.functions.ts` `runSpecSearchCore` | Same orchestration | Calls `queryIndexForSpec`, `queryObjectIndexForSpec`, and canonical `searchPeopleDB` / `searchCompaniesDB` / `searchBusinessesDB` / `searchInvestorsDB` according to coverage flags. Implementations are under `src/lib/indexed`, `src/lib/object-index`, and `src/lib/canonical`. |
| Coverage/live decision | `src/lib/spec-search.functions.ts` `runSpecSearchCore` | After stored rows are checked | Computes `qualifiedDbCount`; invokes `runLiveGapfill` if forced, signal/live required, or below target. Supplies the browser's `isVerified` callback: `rowSatisfiesSpec` + `sanitizeSpecRow(...).complete` + `applyWhyMatchGate`. |
| Query/source plan | `src/lib/search/source-plan.ts` `buildSourcePlan`, `buildResearchPlan`, `buildCandidateResearchQueries` | `runSpecSearchCore`, `runLiveGapfill`, browser | Selects source roles, derives discovery queries and per-candidate research queries. |
| Structured live sources | `src/lib/search/live-gapfill.ts` `runSourceGapfill` | `runLiveGapfill` | Runs source plan; `defaultWeb` calls `discoverWebFreeFirst` in `provider-ladder.ts`, which calls `searchSearxng` in `searxng.server.ts`. OSM and jobs have separate adapters. |
| Browser dispatch | `src/lib/search/live-gapfill.ts` `runLiveGapfill` | `runSpecSearchCore` | Runs source gapfill, measures verified sufficiency, and calls `discoverWithBrowser` if below target; combines diagnostics and candidates. |
| Browser navigation | `src/lib/search/browser-live.server.ts` `discoverWithBrowser` | `runLiveGapfill` | Uses `AgentBrowserCliAdapter` from `src/lib/research-agent/agent-browser-cli.server.ts` through `browser.ts`; bounded search, click/navigate, scroll, page read, extraction, candidate research. |
| Candidate creation | `src/lib/search/browser-live.server.ts` `extractEntities`, `browserEntitiesToRows`, `remember` | `discoverWithBrowser` | Converts observed pages into `SpecRow` candidates and attaches evidence. `refresh` asks the supplied `isVerified` callback whether each candidate is verified. |
| Page and identity checks | `src/lib/search/page-classify.ts`, `entity-resolve.ts`, `canonical-contract.ts` | Live/browser row normalization | Rejects non-entity pages or unresolved identity from delivery. |
| Qualification | `src/lib/search/qualify.ts` `qualifyLead`, `applyQualificationGate` | `applyWhyMatchGate` | Runs entity, evidence, relevance, role/location, person/job/social gates; returns rejection code and disposition. `runSpecSearchCore` logs the first eight rejected rows at `[qualification-rejected]`. |
| Completeness/enrichment | `src/lib/search/enrich-incomplete.ts` `enrichIncompleteRows`; `enrichment-run.ts` `enrichCandidatesForSpec` | `runSpecSearchCore` | Site and query-aware enrichment under cancellation/time budget. `discover-contacts.server.ts` performs public contact discovery. |
| Evidence/why match | `src/lib/search/evidence.ts` `makeEvidence`, `whyMatchFromEvidence`; `live-gapfill.ts` `deriveWhyMatch`, `applyWhyMatchGate` | Extraction and final delivery | Preserves source facts and gates final delivery on qualification. |
| Merge/output | `src/lib/search/candidate-merge.ts`, `src/lib/search/qualified-lead-view.ts` | `runSpecSearchCore`, then route | Merges duplicate rows; UI projection accepts qualified rows and maps them to result cards/tables in `result-tabs.tsx`. |

## The observed 9 → 0 boundary

`browser-live.server.ts` logs `Extracted candidates` immediately after `remember(browserEntitiesToRows(...))`. Its displayed `verifiedCount()` calls the `isVerified` callback supplied by `runSpecSearchCore` in `spec-search.functions.ts`. Thus **nine extracted objects** and **zero verified** means candidate creation succeeded but none satisfied that callback at that moment. The callback combines spec match, completeness, and `applyWhyMatchGate`; `applyWhyMatchGate` calls `applyQualificationGate` in `qualify.ts`. The precise per-row rejection is logged as `[qualification-rejected]` later in `runSpecSearchCore`. A thin/blocked page can also leave missing facts before that gate. No single rejection rule should be inferred from the progress counter alone.

See `runtime-observation.md` for the historical zero-result run and later contrasting run. No new search was executed for this audit.
