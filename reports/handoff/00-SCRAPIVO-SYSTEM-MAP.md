# Scrapivo system map

## Product

Scrapivo understands lead-research requests, searches known data, qualifies rows with evidence, and can add live/provider/browser research. Discover currently renders the established `runSpecSearch` path. Gate 2C research sessions exist as authenticated APIs but are not yet connected to Discover.

## Flow

`Discover route` (`src/routes/_authenticated/discover.tsx`) calls `runSpecSearch` (`src/lib/spec-search.functions.ts`). Gate 1 creates a `SearchSpec`; `runSpecSearchCore` selects indexed/Postgres/S3 sources, enrichment, live gapfill, qualification, and rows projected by `qualified-lead-view.ts`.

Gate 2C parallel path: `research-agent.functions.ts` creates a `RetrievalPlan`, `session.server.ts` runs `ResearchOrchestrator`, and `/api/research/$sessionId/events` streams truthful SSE. Orchestrator calls stored retrieval, minimal enrichment, live providers, browser verification, ranking, and continuation.

```
Discover.tsx
  -> runSpecSearch / runSpecSearchCore
  -> SearchSpec + coverage/index/S3 + qualify -> qualified-lead-view -> UI

research-agent.functions.ts
  -> retrievalPlanFromInputs -> ResearchSessionRegistry
  -> ResearchOrchestrator -> stored/enrich/live/browser -> ResearchResult
  -> routes/api/research/$sessionId/events.ts
```

## Stores

- AWS S3: canonical corpus and versioned derived index.
- Supabase: auth, application data, legacy/small indexes, verified persistence path.
- `C:\ScrapivoGate2`: temporary index/checkpoint workspace only.
- Research sessions: in-memory, single process only.

## AI boundary

Gate 1 may interpret user language. Stored index/retrieval, normalization, qualification, provider calls, browser actions, and persistence must not use AI. Evidence values are source-observed or deterministic only.

## Status

- Done: Gate 1, Spec retrieval, qualification, Gate 2C orchestrator APIs, OSM/jobs, Agent Browser adapter, evidence, cancellation, continuation.
- Partial: Discover-to-ResearchSession/SSE wiring; verified-live orchestration persistence.
- Deferred: durable sessions, second browser backend, load testing, browser viewer, full compact-index completion.

