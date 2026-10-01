# Production Browser Access Evidence

Date: 2026-09-28 MDT

Scope: read-only production access/config/log verification for the Scrapivo browser/mini-browser question. No production searches were run. No Supabase or S3 writes were performed. No secrets were printed or pulled.

## Read-only commands run

- `rtk vercel whoami`
- `rtk vercel env ls production`
- `rtk vercel ls scrapivo-beta --yes`
- `rtk vercel inspect https://scrapivo-beta-2221m0i0w-mir-sadat-bin-rakibs-projects.vercel.app`
- `rtk vercel logs https://scrapivo-beta-2221m0i0w-mir-sadat-bin-rakibs-projects.vercel.app --since 6h | rtk rg -i "...browser/playwright/chromium terms..."`
- `rtk vercel logs https://scrapivo-beta-2221m0i0w-mir-sadat-bin-rakibs-projects.vercel.app --since 7d | rtk rg -i "...browser/playwright/chromium/session terms..."`
- `rtk powershell -NoProfile -Command "(Invoke-WebRequest -Uri 'https://scrapivo-beta.vercel.app' -Method Head -UseBasicParsing).StatusCode; (Invoke-WebRequest -Uri 'https://scrapivo-beta.vercel.app/discover' -Method Head -UseBasicParsing).StatusCode"`
- `rtk rg -n "...browser/worker/progress symbols..." src workers local-business-finder package.json vercel.json -g "!node_modules/**"`

## Access confirmed

- Vercel CLI identity: `mirsadatbinrakib01-9759`.
- Project: `scrapivo-beta`.
- Project id from `.vercel/project.json`: `prj_8bgITNUUDO9i2Bz6IDYee2AzKIbr`.
- Latest inspected production deployment:
  - URL: `https://scrapivo-beta-2221m0i0w-mir-sadat-bin-rakibs-projects.vercel.app`
  - Deployment id: `dpl_9WzPy1UtEyaSfEjzemTKtTxjzsCA`
  - Target: `production`
  - Status: `Ready`
  - Created: Mon Sep 28 2026 14:18:38 MDT
- Aliases:
  - `https://scrapivo-beta.vercel.app`
  - `https://scrapivo-beta-mir-sadat-bin-rakibs-projects.vercel.app`
  - `https://scrapivo-beta-git-main-mir-sadat-bin-rakibs-projects.vercel.app`
- Public HTTP checks:
  - `HEAD /` returned `200`
  - `HEAD /discover` returned `200`

## Production environment names observed

Values were hidden by Vercel and were not printed.

- `CRON_SECRET`
- `USE_RESEARCH_AGENT_DISCOVER`
- `BROWSER_WORKER_TOKEN`
- `BROWSER_WORKER_URL`
- `SEARXNG_URL`
- `MILLIONVERIFIER_DAILY_CAP`
- `MILLIONVERIFIER_API_KEY`
- `SERPAPI_MAX_CALLS_PER_RUN`
- `SCRAPE_DO_TOKEN`
- `SCRAPINGBEE_API_KEY`
- `ENRICHMENTAPI_KEY`
- `SCRAPINGDOG_API_KEY`
- `SERPER_API_KEY`
- `SGAI_API_KEY`
- `GITHUB_TOKEN`
- `FOURSQUARE_API_KEY`
- `GEOAPIFY_API_KEY`
- `CORECLAW_API_KEY`
- `PDL_API_KEY`
- `HUNTER_API_KEY`
- `SCRAPECREATORS_KEY`
- `SERPAPI_KEY`
- `TAVILY_API_KEY`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `USE_PAID_SOURCES`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_MY_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MY_SUPABASE_URL`
- `MY_SUPABASE_SERVICE_ROLE_KEY`
- `MY_SUPABASE_PUBLISHABLE_KEY`
- `MY_SUPABASE_URL`

## Production log evidence

Bounded log scan:

- Command: `vercel logs https://scrapivo-beta-2221m0i0w-mir-sadat-bin-rakibs-projects.vercel.app --since 7d`
- Returned lines: 17
- Effective visible window in returned logs: latest deployment logs around 2026-09-28 18:19-19:08 MDT
- Browser/Playwright/Chromium/session matches: none
- Browser run ids/session ids found: none
- Worker service errors found: none

Observed non-browser signals:

- `GET /discover`
- several `GET /_serverFn/...`
- `GET /api/cron/signal-watches`
- `HEAD /`
- `HEAD /discover`
- `[spec-flag] SPEC_SEARCH_ENABLED="(unset)" -> SPEC`
- `[build-stamp] hash=nogit builtAt=2026-09-29T00:19:06.045Z`
- `/bin/sh: line 1: git: command not found`

## Code path evidence

- `src/lib/search/browser-live.server.ts` defaults `SCRAPIVO_BROWSER_ADAPTER` to `playwright` and returns `PlaywrightBrowserAdapter`.
- `src/lib/research-agent/playwright-browser.server.ts` imports `playwright-core` and calls `chromium.launch(...)`.
- `src/lib/search/live-gapfill.ts` runs browser discovery when verified candidates are below desired count.
- `src/lib/spec-search.functions.ts` enters live gapfill when live/signal/thin-result conditions apply, then wires browser progress to `publishSearchBrowserProgress`.
- `src/lib/search/search-browser-progress.server.ts` stores progress in a process-local `Map`.
- `src/lib/search/scrapy-browser.server.ts` stores mini-browser sessions in a process-local `Map`.
- `src/components/discover/scrapy-browser.tsx` renders nothing until `pagesVisited > 0`.
- `src/routes/_authenticated/discover.tsx` clears `browserProgressRun` when the active search finishes.
- `src/lib/research-agent.functions.ts` contains an external worker client using `BROWSER_WORKER_URL` and `BROWSER_WORKER_TOKEN`, but symbol search found no Discover caller.
- `src/research-worker/server.ts` expects `SCRAPIVO_BROWSER_WORKER_TOKEN`, which does not match the observed production app env name `BROWSER_WORKER_TOKEN`.

## Status

Current-HEAD recheck on 2026-09-29: `vercel whoami` again resolved `mirsadatbinrakib01-9759`; `vercel env ls production` again listed hidden-value `BROWSER_WORKER_URL` and `BROWSER_WORKER_TOKEN`; `vercel ls scrapivo-beta --yes` listed the same latest Ready production deployment. A new bounded `vercel logs ... --since 7d` response returned one log entry, including a spec-run clarification for `get me leads for mirrin.agency`, and no browser launch/session evidence. Vercel log availability differed from the earlier 17-line response, so absence of a browser line cannot establish absence of browser execution.

`BROWSER_STATUS: UNKNOWN / NOT VERIFIED`

Evidence proves production project/log/env access is available and that browser-related env names exist. It does not prove that production currently selects the browser, launches Chromium successfully, fails to launch Chromium, reaches an external worker, or streams mini-browser state to the UI.

Most evidenced possible causes:

- Browser not triggered because existing non-browser sources satisfied the run.
- Browser triggered but Chromium launch failed without a captured matching log line.
- Browser triggered on one serverless instance while progress/session polling hit another instance because both registries are process-local.
- Browser worked but `ScrapyBrowser` stayed hidden because `pagesVisited` remained `0` or `browserProgressRun` was cleared after completion.
- External worker exists in env but is not wired into the current Discover path.

Exact production cause remains unverified because no authenticated production search/browser run was executed and the available Vercel log window contained no browser selection, session, launch, screenshot, or failure events.
