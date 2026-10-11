# MVP Source Map — canonical pipeline ownership

Canonical orchestrator: `runSpecSearchBody` in `src/lib/spec-search.functions.ts`
(entry server fn `runSpecSearch` :3737, core wrapper `runSpecSearchCore`). Verified live as the only end-to-end path (e2e drives it; logs `[spec-run]`, `[stage2-funnel]`, `[candidate-ledger]`).

| Subsystem | Canonical file(s) | Status | Notes |
|---|---|---|---|
| Understanding (deterministic) | `src/lib/understanding/fallback.ts` (`extractFrameDeterministic`) | KEEP | Head-phrase parser, constraints, places |
| Understanding (LLM) | `src/lib/understanding/extract.server.ts` (`extractFrameLLM`, prompt v u1-v18) | KEEP | 24 h Supabase `ai_cache` keyed by prompt version; bump version to invalidate |
| Frame → spec | `src/lib/understanding/to-search-spec.ts` (`frameToSearchSpec`, `normalizeSearchFrame`) | KEEP | Trade-modifier restoration lives here |
| Readiness authority | `src/lib/understanding/clarify-state.ts` (`resolveStage`, `blockers`) + `src/lib/stage1/stage1-adapter.ts` | FIX (done) | Deterministic-readiness override at `spec-search.functions.ts` (~:1496) downgrades nothing complete |
| Search spec | `src/lib/search/search-spec.ts` (`buildSpec`) | KEEP | |
| Source planning | `src/lib/search/source-plan.ts`, `source-yield.server.ts` | KEEP | |
| Indexed retrieval | `src/lib/canonical/{businesses,companies,people,investors}.server.ts`, `read-parquet.server.ts` | KEEP | S3 parquet primary; pg-index optional |
| Live discovery | `src/lib/search/live-gapfill.ts` (`runLiveGapfill`) | KEEP | Widening passes owned by orchestrator |
| Browser engine | `src/lib/search/browser-live.server.ts` (`discoverWithBrowser`, extraction Modes 1/2.5/2, `browserEntitiesToRows`, `structuredBusinessRows`) | FIX (active) | Page-geo guard, block-trade rules, staged page allocation (6 direct + 2 directory) |
| Browser worker | `src/browser-worker/{session-manager,routes,network-guard,egress-proxy}.ts` | KEEP | Token-authed HTTP worker, max 2 sessions |
| Entity identity | `src/lib/search/entity-resolve.ts`, `entity-name-quality.ts` | FIX (active) | Junk-name gate: furniture, slogans, form labels, bare place names |
| Normalization/dedup | `src/lib/canonical/*` + `candidate-merge.ts` | KEEP | |
| Candidate ledger | `src/lib/search/candidate-ledger.ts` | FIX (done) | 9 fates + accounting invariant; cancel-proof zero summary |
| Relevance judge | `spec-search.functions.ts` (`rowSatisfiesSpec`, `rowSatisfyRejectReason`, `postResearchRejectReason`, `specCategoryMatches`) | FIX (active) | Evidence-aware (subject-bound excerpts); craft/trade-family matching via `craftMatches` |
| Software-activity gate | `src/lib/search/service-boundary.ts` | KEEP | Category credit for metadata-only stored rows |
| Investor scope | `entity-resolve.ts` (`investorScopeState`) | KEEP | |
| Signals | `src/lib/signals/{deep-pass.server,custom-compiler,relevance}.ts` | KEEP | |
| Verification | `src/lib/search/{verification,evidence,claim-binding}.ts` | KEEP | |
| Enrichment | `enrichment-run.ts`, `enrich-incomplete.ts`, `enrichment-merge.ts` | KEEP | Subject-bound merge verified |
| Qualification | `src/lib/search/qualify.ts` + `canonical-contract.ts` (outcome codes, reject codes) | KEEP | |
| Run lifecycle/cancel | `src/lib/search/search-run.ts`, `search-run.server.ts`, `search-run.functions.ts` | FIX (done) | Cancel proof: terminal ledger + funnel `returned` fallback |
| Delivery/views | `qualified-lead-view.ts`, `applyPage` | KEEP | |
| Persistence | `src/lib/canonical/persist-live.server.ts` | KEEP | Verified write-back |
| UI (frozen) | `src/routes/_authenticated/discover.tsx` + `src/components/*` | KEEP | No redesign; stop/clarify wiring verified live |
| E2E | `e2e/stage2-acceptance.spec.ts`, `e2e/chaos-battery.spec.ts`, fixtures | KEEP | `S2_SERVER_LOG` gates the cancel proof |
| Legacy/other | `src/lib/scoring.ts` (`scoreLead`, legacy path) | RETIRE-LATER | Not the spec-pipeline gate; untouched |

Non-pipeline: `freehire/` (jobs source, referenced via `src/lib/jobs/freehire-source.ts`), SearXNG via `SEARXNG_URL` (:8888), AI ladder via `src/lib/ai/router.server.ts` (Groq).
