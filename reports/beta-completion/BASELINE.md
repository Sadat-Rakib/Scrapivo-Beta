# Beta Completion Pass — Baseline (2026-09-27)

## Git checkpoint
- Branch `main`, HEAD `dc7a9f2` (docs(data-asset): FINAL_STATUS).
- Working tree: `freehire` (submodule, modified), `src/routeTree.gen.ts` (generated). No user work reset.

## What already shipped (DO NOT BREAK)
- Search Job engine: durable jobs, atomic leases + heartbeat, pause/stop, completion reasons, widening (`src/lib/jobs/*`), pass-runner wired to `runSpecSearchCore`.
- Projects / ICPs / lists / context resolver (query > project > global) with context snapshots.
- Canonical-facts-only write-back, field freshness, decayed source-yield learning (`source_yield_stats`).
- Watch v2 on job engine (idempotent, fingerprints), notification outbox (email/in-app/slack; Telegram CUT).
- WS7A deep-signal pass in final gate. WS7B custom-signal compiler CUT (injection point = `SignalHunter` option of `runDeepSignalPass`).
- No-silent-zero machinery: `resolveSourcePlanOutcome`, `finalizeSearchOutcome`, `retrievalTrace.zeroReason`, `outcome-ui` copy.
- HTTP-first acquisition + research-agent stack behind `USE_RESEARCH_AGENT_DISCOVER`; persistent Playwright browser; per-domain serialization; friction detection; activity presenter with internal-name filtering; Scrapy browser panel (minimized/expanded).
- Tests: Vitest (112 files), `scripts/acceptance-data-asset.mts`, full-v1 acceptance, ship-it Playwright. No CI.

## Audit at baseline (from code map)
- Job ATS adapters: Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters SUPPORTED; Workday PARTIAL; **Personio, Teamtailor, Gem MISSING**.
- Board catalog (`data/job_boards_catalog.json`) covers only greenhouse/ashby/lever/smartrecruiters/workable/recruitee; no Personio/Teamtailor/Gem keys.
- No unified Source Intelligence Registry (capability catalog + jobs registry exist separately; intelligence-layer provider registry unwired).
- No URL/source recognition module.
- Browser: no pre-open relevance verdict per page (post-hoc extraction only); no Retry-After parsing; no global per-host pacer for browser path; take-control button disabled.
- CandidateReservoir class does not exist (durable `search_job_candidates` + in-run arrays).
- `reports/beta-completion/` did not exist.

## New inputs staged this pass
- `seeds/board-directory-2026-09-25.json` — jobleft board directory, format `jobleft-board-directory/1`, 3,581 rows (ashby 1,859 / lever 1,151 / greenhouse 571), status live 1,029 / unverified 2,552, MIT-licensed JobSync lists. Treated as DISCOVERY SEEDS, not truth; unverified rows are not advertised as live.

## Pass objective
Freeze features. Close core gaps: Source Intelligence Registry + ATS coverage + board seeds, URL recognition, browser relevance/recovery/pacing, Custom Signal Compiler V1, entity-class source strategies, batteries, FINAL_STATUS.
