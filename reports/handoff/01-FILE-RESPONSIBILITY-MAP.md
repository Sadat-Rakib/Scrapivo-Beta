# File responsibility map

| Subsystem | Path | Owns | Called by / calls | Tests / gotcha |
|---|---|---|---|---|
| Discover UI | `src/routes/_authenticated/discover.tsx` | query submission, qualified-row presentation | calls `runSpecSearch`; uses `qualified-lead-view` | `m11-ui-run.test.ts`; does not call Gate 2C sessions yet |
| Gate 1 + retrieval | `src/lib/spec-search.functions.ts` | SearchSpec, row matching, core retrieval server function | Discover; calls coverage/readers/live/qualification | `src/lib/__tests__/spec-search.test.ts`; preserve SearchSpec semantics |
| Retrieval plan | `src/lib/research-agent/plan.ts` | SearchSpec/UnderstandingFrame adapter | research server functions/orchestrator | `research-agent.test.ts`; no Gate 1 reinterpretation |
| Orchestrator | `src/lib/research-agent/orchestrator.server.ts` | target quantity, stored/enrich/live/browser merge, rank | session registry; calls `runSpecSearchCore`, live gapfill, browser | `research-agent.test.ts`, `zero-ai.test.ts`; source facts only |
| Sessions | `src/lib/research-agent/session.server.ts` | in-memory session, SSE events, cancel, continuation | research functions/SSE route | `research-agent.test.ts`; lost on restart/multi-instance |
| Research API | `src/lib/research-agent.functions.ts` | authenticated start/get/continue/cancel | clients; calls registry | route not wired into Discover |
| SSE | `src/routes/api/research/$sessionId/events.ts` | authenticated event response | browser/client; calls registry stream | route must receive authenticated bearer token |
| Browser contract | `src/lib/research-agent/browser.ts` | browser/session interfaces | adapter and verifier | keep provider-independent |
| Browser adapter | `src/lib/research-agent/agent-browser-cli.server.ts` | Agent Browser CLI actions/snapshots/screenshots | orchestrator browser path | `research-agent.test.ts`; `AGENT_BROWSER_BIN` optional |
| Browser verification | `src/lib/research-agent/browser-research.server.ts` | contact, signal, no-website, status checks | orchestrator; browser adapter | no CAPTCHA bypass; public facts only |
| Status | `src/lib/research-agent/operational-status.ts` | active/closed classification | browser/orchestrator | closure fixtures |
| Events | `src/lib/research-agent/events.ts` | internal event to truthful copy | orchestrator/session | never fabricate activity |
| Live ladder | `src/lib/search/live-gapfill.ts` | provider selection and qualification bridge | spec core/orchestrator | `m1-m3-runtime.test.ts` |
| Jobs | `src/lib/search/jobs-provider.ts` | structured postings to theorem-ready rows | spec core/live gapfill | `jobs-provider.test.ts`; source board is not employer |
| OSM | `src/lib/search/provider-ladder.ts`, `src/lib/search/live-gapfill.ts` | Overpass discovery | live gapfill | `provider-osm.test.ts`; exact city requires exact city evidence |
| Evidence | `src/lib/search/evidence.ts` | evidence schema/why-match source data | providers, qualification | no LLM facts |
| Qualification | `src/lib/search/qualify.ts`, `canonical-contract.ts` | theorem and lead disposition | spec/live/orchestrator | milestone and M1-M15 tests; fail closed |
| Views | `src/lib/search/qualified-lead-view.ts` | qualified rows to UI models | Discover | unresolved rows never display |
| Persistence | `src/lib/canonical/persist-live.server.ts` | qualified live upsert | spec core currently | optional pg import; Supabase primary |
| Object index | `src/lib/indexed/search-index.server.ts` | compact index reads | spec core | `search-index.server.test.ts` |
| Canonical reads | `src/lib/canonical/read-parquet.server.ts` | S3 Parquet reads | spec core | avoid global scans |
| Index build | `scripts/pipeline/build_search_index.py` | resumable derived-index builder | watchdog | never mutate canonical S3 |
| Watchdog | `scripts/pipeline/run_search_index_watchdog.ps1` | disk guard/retry/resume | detached process | no activation or Supabase cleanup |
| Config | `.env.example`, `src/lib/search/flag.ts` | feature flags/environment | all | never commit secrets |

Safe edits: use the owning row only, run its tests, then adjacent contract tests. Do not edit Gate 1 for UI/browser bugs; do not edit qualification to hide provider defects.

