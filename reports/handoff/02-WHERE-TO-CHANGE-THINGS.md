# Where to change things

- Intent misunderstood: `src/lib/understanding/`, `src/lib/spec-search.functions.ts`; run `rtk npm test -- src/lib/understanding`.
- People zero: `spec-search.functions.ts`, `indexed/search-index.server.ts`, canonical readers; run `src/lib/__tests__/spec-search.test.ts`.
- Company contact missing: canonical mapper and `persist-live.server.ts`; run company/live tests.
- Business geography wrong: `rowSatisfiesSpec` in `spec-search.functions.ts`, location resolver, OSM adapter; run `provider-osm.test.ts` and `m1-m3-runtime.test.ts`.
- Need More duplicates: `research-agent/session.server.ts`, continuation in orchestrator; run `research-agent.test.ts`.
- Live does not run: `ResearchOrchestrator.run`, `live-gapfill.ts`; test quantity shortfall fixture.
- Bad OSM: `live-gapfill.ts`, provider normalization, qualification; never weaken theorem.
- Stale jobs: `jobs-provider.ts`, `job-qualify.ts`; run `jobs-provider.test.ts`.
- Browser action/scroll: `agent-browser-cli.server.ts`, `browser-research.server.ts`; re-observe after every action.
- Closed business returned: `operational-status.ts`, browser verifier; run research-agent closure fixture.
- Signal/evidence missing: `evidence.ts`, browser verifier, qualification; no generated values.
- SSE/cancel/new chat: `session.server.ts`, research functions, SSE route; current registry is process-local.
- Results table UI: `discover.tsx`, `result-tabs.tsx`, `lead-detail-panel.tsx`; preserve qualified views.
- Homepage: `src/routes/index.tsx` and homepage components; do not touch retrieval.

