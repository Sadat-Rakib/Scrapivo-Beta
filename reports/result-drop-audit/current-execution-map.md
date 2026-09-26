# Current execution map

This traces the `SPEC_SEARCH_ENABLED` path used by the V1 probes. The route has a separate legacy branch when that flag is off (`discover.tsx:1545-1580`). Counts and conclusions elsewhere in this bundle refer to this active Spec path.

| Stage | File and function | Input → output | Called by → calls next |
|---|---|---|---|
| Submit and run identity | `src/routes/_authenticated/discover.tsx:1525` `beginSearch`; `:647` `runSpecBranch` | Search text and turn ID → authenticated server call with abort signal and run ID | Submit handler → `runSpecSearch` |
| Server entry | `src/lib/spec-search.functions.ts:2070` `runSpecSearch` | Validated query/limit/answers/run ID → `SpecSearchResult`; registers cancellation and progress | `runSpecBranch` → `runSpecSearchCore` |
| Understanding | `src/lib/spec-search.functions.ts:868` `runSpecSearchCore` | Text/answers → `SearchSpec` from `understandSearchSpec`, clarification/mode gates | Server entry → retrieval; `src/lib/understanding/to-search-spec.ts`, `search-spec.ts` |
| DB/index first | `src/lib/spec-search.functions.ts:1158-1630`; `src/lib/indexed/search-index.server.ts:312` `queryIndexForSpec` | Spec → indexed and/or S3 `SpecRow[]`, `DbHitMeta[]`; coverage-planned tiers can time out/early-stop | Core → `rowSatisfiesSpec` |
| Coarse DB filter | `src/lib/spec-search.functions.ts:362` `rowSatisfiesSpec`; core tail around `:1630` | Retrieved rows → category/role/industry/location matches; opportunity filter removes site-bearing rows for `no_website` | Retrieval → sanitize/completeness |
| Sanitize/completeness | `src/lib/spec-search.functions.ts:177` `sanitizeSpecRow`; `src/lib/search/completeness.ts:29` | Row → URL semantics, `missingFields`, `complete`; split complete/incomplete | Coarse DB filter → incomplete enrichment |
| Initial incomplete enrichment | `src/lib/search/enrich-incomplete.ts:89` `enrichIncompleteRows` | First capped slice of incomplete rows → `complete` and `stillIncomplete`; contact harvesting requires an entity site | Core → query-aware DB enrichment |
| Query-aware DB enrichment | `src/lib/search/enrichment-run.ts:282` `enrichCandidatesForSpec` | Merged complete **and** incomplete DB rows → enriched rows plus diagnostics | Core → DB qualified count/live decision |
| Live decision | Core around `src/lib/spec-search.functions.ts:1690` | If forced, signal required, needs-live, or qualified DB count below target → live gapfill | Core → `runLiveGapfill` |
| Source plan/discovery | `src/lib/search/live-gapfill.ts:435` `runSourceGapfill`; `:673` `runLiveGapfill` | Spec → OSM/SearXNG source rows and provider diagnostics | Core → `source-plan.ts`; OSM `osm-local-businesses.server.ts`; SearXNG `provider-ladder.ts`/`searxng.server.ts` |
| Candidate creation | `src/lib/search/live-gapfill.ts:93` `defaultOsm`; `:198` `defaultWeb`; `src/lib/search/browser-live.server.ts:119` `browserEntitiesToRows` | Source artifacts → resolved structured POIs or provisional web rows; browser extraction yields entity rows | Source adapters/browser → seed selection and memory |
| Seed selection | `src/lib/search/live-gapfill.ts:673-737` `runLiveGapfill` | DB candidates plus source rows → 15–20 ranked structured-absence seeds for no-site searches, otherwise first six; qualified count can skip browser | Source gapfill → `discoverWithBrowser` |
| Browser research | `src/lib/search/browser-live.server.ts:402` `discoverWithBrowser`; `:441` `refresh`; `:~595` `research` | Seeds/search results → bounded candidate memory with needs/status, observed fields/evidence; source pages can fan out | `runLiveGapfill` → `computeResearchNeeds`, source searches, browser actions, extraction |
| Live merge | `src/lib/search/live-gapfill.ts:764` | Source rows plus browser rows → `mergeDuplicateCandidates` output | Browser → core live-row filter |
| Live coarse filter | Core around `src/lib/spec-search.functions.ts:1730` | Sanitized live rows → only `rowSatisfiesSpec` matches; complete rows enter main pool, incomplete rows remain separate | Live gapfill → limited incomplete enrichment |
| Live incomplete enrichment | `src/lib/search/enrich-incomplete.ts:89` | Incomplete live rows → complete/still-incomplete | Core → complete-row merge |
| Main enrichment | `src/lib/search/enrichment-run.ts:282` | **Only complete rows** not already enriched as DB rows → plan/adapters/merge; incomplete leftovers do not enter this pass | Core → qualification |
| Qualification and why | `src/lib/search/live-gapfill.ts:405` `applyWhyMatchGate`; `src/lib/search/qualify.ts:130` `qualifyLead`; `canonical-contract.ts:288` theorem | Complete rows → qualified only (`keepPotential:false`), scores, evidence-derived or directory why-match | Core → verified stamp/rank/page |
| Dedupe/page/delivery | Core around `src/lib/spec-search.functions.ts:1950-2060`; `:561` `applyPage` | Qualified rows → soft duplicate mark, offset/limit slice, `SpecSearchResult.rows` and trace | Core → server response |
| UI projection | `src/routes/_authenticated/discover.tsx:697-760`; `src/lib/search/qualified-lead-view.ts:184` | Active response rows → rechecked `QualifiedLeadViewRow[]`, then legacy lead/local row shapes | `runSpecBranch` → turn state |
| Render | `src/routes/_authenticated/discover.tsx:1690-1800` `renderResultSections`; `src/components/discover/result-tabs.tsx` | Turn rows → PostsGrid/List for non-business Spec rows or LocalBusinessesGrid/BusinessTable for business rows | React state → visible cards/table |

The browser returns its candidate memory even when many rows remain incomplete; the core then applies another Spec filter and completeness split. The main post-live enrichment sees only the complete side of that split.
