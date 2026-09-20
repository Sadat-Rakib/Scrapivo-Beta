# Gate 2C Research Orchestrator MVP

Date: 2026-09-20  
Branch: `gate2c/research-agent`

## Outcome

One stored-first research vertical slice now connects the existing deterministic retrieval stack to targeted enrichment, free live discovery, browser verification, deterministic qualification, continuation, cancellation, and truthful event streaming.

The orchestrator does not replace Gate 1. It consumes `SearchSpec` plus an optional `UnderstandingFrame` and creates a lossless Gate-2 `RetrievalPlan`.

## Reuse audit

| Component | Existing implementation | Status | Decision |
|---|---|---:|---|
| Stored retrieval | `spec-search.functions.ts`, object-index search | Working | Reuse through injected stored-search seam |
| Live gapfill | `search/live-gapfill.ts` | Working | Reuse as default live provider path |
| SearXNG | `search/searxng.server.ts`, `provider-ladder.ts` | Config-dependent | Reuse; no paid SERP auto-escalation |
| OSM / Overpass | `search/osm-local-businesses.server.ts` | Working | Reuse; real smoke returned 142 Toronto HVAC candidates |
| Social / Reddit | `search/reddit-rss.server.ts`, social signal modules | Working adapters | Leave behind existing provider plan |
| Jobs | `search/jobs-provider.ts`, ATS and remote fetchers | Working adapters | Jobs start at live |
| Enrichment | `enrichment-plan.ts`, `enrichment-run.ts` | Working | Reuse only for missing required fields |
| Verification / qualification | `verification.ts`, `qualify.ts`, `rowSatisfiesSpec` | Working | Reuse deterministic gates |
| Evidence | `search/evidence.ts` | Working | Extend with field and signal evidence models |
| Persistence | `canonical/persist-live.server.ts` | Existing | Not duplicated; durable orchestration persistence deferred |
| Cancellation | `search-run.ts` | Working primitive | Extend with session `AbortController` |
| Browser | None suitable in product path | Missing | Add Agent Browser CLI adapter |

## Flow

1. Convert Gate-1 output to `RetrievalPlan`.
2. Start stored discovery.
3. Start live discovery concurrently when freshness, signal, or jobs require it.
4. Measure candidate readiness.
5. Enrich only missing required fields.
6. Continue live when ready supply is below target.
7. Apply exact source/spec and excluded-location validation.
8. Browser-check unresolved status, contact, or current signal claims.
9. Reject closed, stale, mismatched, incomplete, or unsupported candidates.
10. Exact-key dedupe and deterministic ranking.
11. Emit qualified results, continuation token, metrics, and events.

## Quantity policy

- No explicit quantity: initial target is 10.
- More than 10 ready static rows: return strongest 10; do not launch browser; expose continuation.
- Fewer than 10 ready rows: run free live research automatically.
- Explicit quantity: target the requested count, bounded by session budget and legitimate source exhaustion.
- Continuation stores returned IDs, source offset, attempted query, and exhausted sources. It does not repeat returned entities.

Verified tests:

- 15 stored rows return 10 without live/browser work.
- 6 stored rows trigger live work and reach 10.
- Explicit 50 returns 50.
- Continuation returns the remaining five without duplicates.

## Candidate lifecycle

`DISCOVERED`, `MATCHED`, `NEEDS_ENRICHMENT`, `ENRICHING`, `READY_FOR_VERIFICATION`, `VERIFIED`, `QUALIFIED`, `REJECTED`, and `UNRESOLVED` remain distinct.

Only `QUALIFIED` candidates are delivered. Valid candidates lacking an optional field remain valid. Missing explicit required fields remain unresolved and are not delivered.

## Enrichment

The orchestrator passes only `missingFields` to the existing enrichment planner. Default budgets allow no paid calls, one contact-harvest attempt per candidate, and four steps.

Supported MVP fields follow existing adapters: email, phone, URL/domain, location, employer, salary, and claim evidence. No email pattern guessing or private-contact inference exists.

## Signals and freshness

`SignalEvidence` stores type, claim, source, observation time, event time when known, freshness, confidence, grade, and observation snippet.

Supported MVP types:

- HIRING
- SEEKING_JOB
- SEEKING_SERVICE
- FUNDRAISING
- RECENTLY_FUNDED
- EXPANDING
- PRODUCT_LAUNCH
- RECENT_ACTIVITY
- NO_WEBSITE
- WEAK_WEBSITE
- TECHNOLOGY_USAGE
- ROLE_CHANGE
- USER_DEFINED

Signal queries run live verification even when stored supply is high. Exact windows such as `7d` use event time when present. Observation time never substitutes for event time.

## Evidence and truth boundary

Canonical facts may enter from stored values, structured provider rows, browser-observed text, or deterministic transformations. Model output is never evidence.

Delivered rows include field evidence and signal evidence. `whyMatch` is derived from those values. Deterministic validation rechecks role/category/location constraints and negative locations before delivery.

## Operational status

Deterministic statuses:

- ACTIVE
- TEMPORARILY_CLOSED
- PERMANENTLY_CLOSED
- INACTIVE
- UNKNOWN

Temporary, permanent, and inactive statuses are rejected by default. Unknown local-business status remains unresolved until additional verification. Loading a website alone never establishes ACTIVE.

## Events, cancellation, and continuation

`ResearchSessionRegistry` provides scoped sessions, replaces an older active search in the same user/chat scope, preserves verified work on cancellation, and exposes an authenticated SSE route:

`GET /api/research/$sessionId/events`

Events carry internal metadata separately from truthful user copy. Screenshot references attach only to actual captures. `continueResearchSession` resumes from continuation state; `cancelResearchSession` aborts provider and browser work.

## Certification

Focused automated suite: 38 PASS, 0 FAIL.

Adjacent retrieval regression certification: 42 PASS, 0 FAIL. This covers the
shared OSM exact-city path and structured job-posting qualification changed by
the MVP. The earlier broad run exposed three failures; all three root causes
were fixed and their owning test files now pass.

Covered:

- people
- intent people
- companies
- local businesses
- no-website opportunity
- jobs
- investors
- default 10
- explicit 50
- targeted enrichment
- continuation without duplicates
- cancellation
- SSE event stream
- wrong role, country, and category
- excluded location
- missing required contact
- temporary/permanent closure
- CAPTCHA handoff
- zero-AI deterministic path

Real free-provider smoke:

- Query: active HVAC contractors in Toronto with phone.
- Provider: OSM / Overpass.
- Result: 142 candidates.
- Elapsed: 5,178 ms.
- Paid provider calls: 0.

## AI use

- Understanding AI: outside this orchestrator and unchanged.
- Stored retrieval AI: 0.
- Structured provider AI: 0.
- Enrichment AI: 0 in certified path.
- Browser reasoning AI: 0 in certified path.

An automated test replaces the AI router with throwing functions and runs representative person, company, business, and investor searches.

## Build status

Production route generation succeeded. Full production build remains blocked by pre-existing missing `pg` dependency imported from `canonical/persist-live.server.ts`. The new research tests pass independently. Global TypeScript also retains unrelated existing search-test/type debt; task-specific serialization errors were fixed.

## Terra continuation

Mechanical expansion only:

- durable session/event storage for multi-instance deployment
- verified live persistence hook after qualification
- additional jobs and directory adapters
- more browser fixture pages and site workflow cache entries
- second browser adapter
- load and cancellation stress tests
- minimal internal event/screenshot viewer
- broader event copy localization

No Gate-1 rewrite, stored retrieval rewrite, paid SERP, outreach, or CAPTCHA bypass belongs in this continuation.
