# Universal Audit — Legacy Recovery Map

## What the earlier system was

Pre–spec-search Discover used **`runSearch` → `searchAllSources`** (`sources.server.ts`): concurrent fan-out across social, web boolean (SearXNG), jobs boards, gov, news, stealth worker, etc. Local businesses also used Overture files + OSM/Geoapify/Foursquare.

Cross-app intelligence (`docs/CROSS_APP_INTELLIGENCE_REPORT.md`) absorbed **Scout** and **Outreach Engine** *patterns* (profile harvest, playbook planner, evidence claims) without vendoring those repos.

## Cutover

| Flag | Default | Effect |
|------|---------|--------|
| `SPEC_SEARCH_ENABLED` | ON (prod) | Discover uses `runSpecSearchCore` |
| `USE_COVERAGE_SELECTOR` | ON (prod) | Planned hot→S3→provider tiers |
| `USE_INDEXED_SEARCH` | often ON | Postgres index before S3 |

When spec path is ON, **most of `searchAllSources` is not invoked** for directory hunts. Live gapfill only covers business→OSM and job→fleet.

## Still present but under-wired

- `sources.server.ts` (entire live social/web surface)
- `searxng.server.ts`, `serp-providers.server.ts`
- `social-dorks`, reddit-rss, fediverse, youtube-transcript, startup-sources, dealroom-sources, …
- `workers/stealth-worker`, `workers/scrape-worker`
- `playbook-planner.ts`, `intelligence/*`, `contact/*`

## Removed / never present in this workspace

| Name | Status |
|------|--------|
| Scout CLI repo | Never cloned — patterns only |
| OpenMagpie | Absent |
| Harken | Absent |
| Scoutpost | Absent |
| browser-use agent | Explicitly deferred (`LATER_WORK.md`) |
| JobSpy vendored | Adapter only |

## Broken during integration (hypothesis → confirmed by battery)

1. Spec path assumed S3/hot coverage ≈ universe → thin geos toast empty.
2. Company/person `declaredProviders: []` + `live-none` → no fallback to SearXNG/social.
3. Completeness “name enough” for business undid enrich-before-show product rule.
4. Legacy clarifier (`geographyQuestion`) still reachable via `clarify-ai.functions` for some verticals → re-asks worldwide.

## Restore vs redesign

| Capability | Recommendation |
|------------|----------------|
| Live web for company/person | **Restore** via SearXNG/webboolean adapter into `live-gapfill` (reuse, don’t clone sources.server wholesale) |
| Social signal → lead | **Redesign** thin transform using `intelligence/evidence` |
| Agentic browser | **Defer** until SearXNG+OSM+stealth prove insufficient |
| Scout OSS | Research only; in-tree contact harvest already covers bio/email patterns |
