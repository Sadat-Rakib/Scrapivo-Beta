# Current status

## Production-capable now

Gate 1/Spec retrieval, qualification, OSM smoke, structured jobs, and existing Discover results path.

## Testable MVP

ResearchOrchestrator, enrichment, evidence/signals, Agent Browser adapter, session API, SSE endpoint, cancel, continuation. Focused certification: 38 research-agent and 42 adjacent regressions passed at Gate 2C completion.

## Partial / needs hardening

- Discover does not call `startResearchSession`; impact: normal UI does not show Gate 2C SSE/session flow. Owner: `discover.tsx`, `research-agent.functions.ts`. Priority P0 before public deployment.
- Sessions are in memory; impact: restart/multi-instance loses state. Owner: `session.server.ts`. Local MVP workaround: single instance.
- Verified live persistence is not orchestrator-connected. Owner: `orchestrator.server.ts`, `persist-live.server.ts`. Priority P1.
- Optional direct pg path now avoids bundler dependency; Supabase fallback remains primary. Owner: `persist-live.server.ts`.

## Deferred

Second browser engine, more providers, workflow cache, browser viewer, stress tests, full compact-index rollout, Supabase cleanup.

