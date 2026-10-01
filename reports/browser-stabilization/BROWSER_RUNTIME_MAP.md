# BROWSER_RUNTIME_MAP — Scrapivo browser stack (stabilization input)

Generated during final stabilization. Line numbers approximate at sprint HEAD `d10892d`.

## Top-level layout
- `src/` single app (TanStack Start): routes `src/routes/`, server functions `*.functions.ts`.
- Browser worker libraries: `src/browser-worker/`, `src/research-worker/`.
- Domain core: `src/lib/research-agent/` (runtime+pacing+acquisition), `src/lib/search/` (SERP/gapfill/pacer/pipeline), `src/lib/contact/`.
- `scripts/` ops/e2e (incl. `local-browser-worker.mts`), `e2e/` Playwright, `workers/` legacy.

## 1. Worker entry + routes
- `scripts/local-browser-worker.mts` — local launcher (`npm run worker:local`), loopback only, sets `SCRAPIVO_LOCAL_NO_PERSIST=true`.
- `src/research-worker/server.ts` — node:http on 127.0.0.1; SessionManager + `/research/*` routes; hand-rolled regex dispatch.
- `src/browser-worker/routes.ts` — `createBrowserRoutes(manager, token)`: `/browser/status`, `/browser/sessions`, `:id/{observe,snapshot,act,extract,links,control,input,close,reopen}`, screenshot; bearer token; per-request AbortSignal from client disconnect.
- `src/routes/api/research/$sessionId/events.ts` — SSE run events to UI.
- `src/lib/research-agent/browser-worker-config.server.ts` — env: workerToken/workerUrl/requestedRuntime (playwright|cli|worker).

## 2. AgentBrowser interface + adapters
- `src/lib/research-agent/browser.ts` — canonical `AgentBrowser` (createSession/navigate/search/observe/click/type/select/scroll/waitFor/extract/extractLinks?/key?/back?/forward?/screenshot/close), `PageSnapshot` incl. `friction[]`, `BrowserCloseOutcome`.
- `src/lib/research-agent/playwright-browser.server.ts` — Chromium adapter. Weakness: hardcoded `waitForTimeout(400)` after clicks, fixed 8s/4s/6s caps, `wait` falls back to fixed sleeps.
- `src/lib/research-agent/agent-browser-cli.server.ts` — external CLI adapter; subprocess-per-call, 45s fixed.
- `src/lib/research-agent/worker-browser.server.ts` — HTTP adapter over worker REST; fixed 45s per op; no transport retry/backoff.
- `src/lib/research-agent/browser-runtime.server.ts` — `buildAgentBrowserRuntime(signal, meta)`; env-driven fallback (`WorkerWithFallback`), no worker health probe.
- `src/lib/research-agent/browser-worker-client.server.ts` — low-level REST client.

## 3. Session manager / retention / takeover
- `src/browser-worker/session-manager.ts` — per-session Chromium profiles on disk; per-session serial queue; lanes (`runKey`); retained sessions; human takeover (`control` human/agent; agent ops throw `HUMAN_CONTROL` 409 while human drives; `input` applies human typing; snapshotVersion bump on give-back); `close(retain)` + `reopen` restores cookies. Weakness: fixed 400ms action pacing; in-memory queues.
- `src/lib/research-agent/session.server.ts` — app-side run registry (in-memory).
- `src/browser-worker/egress-proxy.ts` — local HTTP(S) egress proxy enforcing UrlGuard for all page traffic.
- `src/browser-worker/network-guard.ts` — SSRF guard (DNS resolve, private-IP reject, pin + TTL re-validate).
- `src/browser-worker/errors.ts` — `WorkerError` codes.

## 4. Navigation / page read / extraction
- `session-manager.ts` `gotoGuarded()` — domcontentloaded + fixed 4s load-state catch-all; inline DOM snapshotter (text cap env-driven, 400 links, 12 headings, ref-stamped elements).
- `src/lib/research-agent/candidate-acquisition.server.ts` — HTTP-first: `requiresRendering(url)` (URL-pattern heuristic), `fetchStaticPage`, email/phone extraction, `runCandidateTasks` pool (1..6), `registrableDomainOf`.
- `src/lib/search/http-fetch.server.ts` — resilientFetch/resilientText/resilientJson (generic retry, not host-paced itself).
- `src/lib/search/fetch-gate.server.ts` — soft-404/login-wall/parked gates, `validateFetchedPage`, 2–4s jittered polite delays.
- `src/lib/research-agent/page-friction.ts` — regex classifier `CAPTCHA | LOGIN_WALL | ACCESS_BLOCK | RATE_LIMIT` from title/text. Weakness: misses JS-only interstitials; no HTTP-status-driven path in browser lane.

## 5. SERP + search engines
- `src/lib/search/serp-providers.server.ts` — SerpApi Google + site-dorks; process-global budget counters.
- `src/lib/search/searxng.server.ts` — SearXNG engine + budget.
- `src/lib/search/browser-live.server.ts` — in-browser SERP loop; per-engine `blockedEngines` for the run when challenge pages appear; `structuredSnippetRows`.

## 6. Live pipeline / gapfill
- `src/lib/search/browser-live.server.ts` — `discoverWithBrowser(spec, options)`: SERP loop, candidate reads (browser or http_read ladder), `extractEntities`, JSON-LD business rows, trace events, `maxPages = min(...,40)`, query budget 42 (magic numbers), session limits inline.
- `src/lib/search/live-gapfill.ts` — `runLiveGapfill`; query = `buildResearchPlan(spec).discoveryQueries[0]`; template-based (`craftFromTag`), not criteria-derived (C8).

## 7. Structured data + contact traversal
- `src/lib/search/page-structured.ts` — `extractStructuredFacts(html)` (JSON-LD incl. `@graph`; no microdata/RDFa).
- `src/lib/research-agent/browser-research.server.ts` — per-candidate static→browser ladder (`researchCandidatesWithBrowser`), `pacedStaticFetch` (host pacer), `verifyCandidateFromSnapshot`, early-exit needs computation in `browser-research.ts` (`computeResearchNeeds`).
- `src/lib/contact/contact-finder.server.ts` — fixed-path probe `["", "/contact", "/contact-us", "/team", "/about", "/about-us"]`.
- `src/lib/contact/harvest.server.ts` — BFS link-follow crawler, maxPages 6, politeDelay floor 250ms.

## 8. Pacing / domain health (existing)
- `src/lib/search/domain-pacer.server.ts` — per-host slots + cooldown; `HostPaceError` RATE_LIMITED/HOST_BLOCKED; `noteHostResponse` (status, Retry-After cap 60s), `noteBrowserAction`, `hostBlockedUntil`, `resetHostState`. Process-global in-memory.
- Consumers: browser-research (paced static fetch + browser actions), http-fetch, searxng, browser-live.

## 9. Cancellation
- session-manager: AbortSignal on every op; nav races abort; `close(session,"cancelled")`.
- routes.ts: abort per request on disconnect; worker-browser: signal passed but in-flight op waits up to 45s.
- browser-live: signal threaded; user-cancel vs time-budget distinguished (~:1366).

## 10. Budgets (fragmented)
- browser-live: maxPages ≤40, queries ≤42, visited-set; plan stoppingRules.maxPages (default 30); harvest maxPages 6. No shared `BrowserNavigationPolicy`. → Workstream E unifies.

## 11. Tests
- `src/browser-worker/__tests__/session-manager.test.ts` (real Chromium; takeover, retention, cancel-before-nav, restart-reopen…), `worker-adapter.test.ts`, `network-guard.test.ts`.
- `src/lib/research-agent/*.test.ts` (adapter, pacing, acquisition-policy, zero-ai), `src/lib/search/*.test.ts` (browser-live, fallback, serp-discovery, browser-trace, contact-page-evidence).
- `e2e/*.spec.ts` Playwright; `reports/full-e2e-validation/tools/qa-run.mts` (36-case harness).

## Stabilization gaps this map commits to closing
1. Centralized `BrowserNavigationPolicy` (min domain interval, readiness-based waits, bounded retries/backoff, per-domain/per-candidate/per-run budgets) replacing magic numbers + fixed sleeps.
2. Status-driven domain health (AVAILABLE/RATE_LIMITED/AUTH_REQUIRED/CHALLENGE_REQUIRED/BLOCKED/TEMPORARY_FAILURE/UNUSABLE) surfaced to zero-UX + source routing.
3. SERP triage/ranking BEFORE navigation; HTTP/structured-data first; early exit when candidate criteria are proven (partially exists in computeResearchNeeds).
4. Challenge detection wired to human takeover surfacing (UI "Scrapy needs your help").
