# Scrapivo MVP release candidate: final status

Local checkout `main` @ `7805e75e452d925a6d88e3db880622fdb2f35207` (unchanged, nothing committed or staged). Every gate below was run on the final working tree, after the last code change.

## Gates (final tree)

| Gate | Result | Evidence |
|---|---|---|
| Unit/integration tests | 1568 total, 1498 pass, 55 fail (all frozen KNOWN_RED), 15 skipped, 0 new | `evidence/final-tests.txt`, `KNOWN_RED.json`, `TEST_TRIAGE.md` |
| Typecheck | 43 errors = baseline; no file or error group above baseline | `evidence/typecheck-final.txt`, `TYPECHECK_TRIAGE.md` |
| Production build | exit 0 (163 s, `NODE_OPTIONS=--max-old-space-size=4096`) | `evidence/build-final.log`, `BUILD_MEMORY.md` |
| Client bundle | 69 static files: no Playwright/chromium-bidi, worker routes, worker token, service role or server modules; 29 `.env` secret values checked, 0 found | `tools/bundle-scan.mjs` |
| Understanding stress corpus | 100/100 policy-adjusted | `STRESS_RESULTS.json`, `STRESS_CLASSIFICATION.md` |
| Adversarial battery | 40/40 | `ADVERSARIAL.md` |
| Live query matrix (24) | PASS 6, HONEST_ZERO 18, FAIL 0 | `MATRIX.md` |
| Founder hard gate (server + worker) | 5 qualified founders, audit clean | `FIRST_BROWSER_ROW.md`, `WORKER_RUNTIME_GATE.md` |
| Mobile clarify layout | 360/375/390 pass | `ui/mobile-clarify.json` |
| Authenticated UI acceptance | desktop + mobile pass (below) | `ui/*.json`, `ui/*.jpg` |

## Authenticated UI acceptance (Task 20)

The user signed in once (`tools/auth-capture.mts`). The dev server ran with `SCRAPIVO_LOCAL_NO_PERSIST=true` and `SCRAPIVO_BROWSER_ADAPTER=worker`, with the worker on loopback :8788. Each run: submit → answer "What are you trying to do…" → watch streaming and the mini-browser → take control / give it back → settle → close the kept-open browser. Runs used `tools/ui-gate.mts` (headless viewer).

| Run | Viewport | Query | Outcome |
|---|---|---|---|
| `ui-desktop-final` | 1366×900 | B2B SaaS founders with public contact details | 5 results. All 5 streamed leads were delivered. Worker runtime. Take control, give back and Close browser all worked. No internal names leaked. |
| `ui-mobile-founders` | 390×844 touch | same | 5 results, 5/5 streamed delivered. Worker runtime. Takeover and close worked. Layout fits (`ui-mobile-founders-5-takeover.jpg`). |
| `ui-desktop-business` | 1366×900 | Dentists in Portland, Oregon with phone numbers | 41 results, all category dentist, each with a public phone. |
| `ui-mobile-business` | 390×844 touch | same | 41 results, all dentist. |

## Defects found by UI acceptance and fixed in this pass

1. **Dev UI rendered a blank page.** The cause predates this pass: HEAD has the same imports. Vite's dependency scanner reaches `playwright-core` through the `import()`s inside serverFn handlers. Pre-bundling then fails on its optional `chromium-bidi` requires, and every `/node_modules/.vite/deps` request hangs. Fix: `optimizeDeps.exclude` now includes `playwright-core` (`vite.config.ts`). `/auth` renders (`ui/smoke-auth-desktop.png`). This is dev-only; the build is unaffected.
2. **Verified results showed "anon" in the card footer.** "anon" is a fallback meant for social posts. Fix in `src/components/lead-card.tsx`; test `lead-card.test.tsx`.
3. **"Dentists" returned general clinics** (14 of 43, e.g. "Maternal-Fetal Medicine Center"). The query alias clinic→dentist was also being applied to the observed OSM `amenity=clinic` category. Fixes:
   - `craftMatches` keeps an observed "clinic" literal (`src/lib/canonical/businesses.server.ts`).
   - OSM clinic rows count as dentists only when their own name says dental (`craftFromTag` in `src/lib/search/live-gapfill.ts`).
   - Test: `clinic-category.test.ts`. A "clinics" query still finds clinics.
4. **Worker sessions sometimes fell back to the in-process browser.** 3 of 6 headed sessions failed, and the UI showed "Viewing only. Taking control needs the browser worker." The worker had closed the launch tab before opening its own, which can shut a headed window down. The next tab then failed with `Target.createTarget: Failed to open a new tab`. Fixes in `src/browser-worker/session-manager.ts`:
   - Open the agent tab first, then close the launch tab.
   - Launch failures now print one sanitized line to the worker's stderr.
   - Test added to `session-manager.test.ts`.
   - After the fix: 12/12 headed launch cycles passed (`evidence/worker-headed-cycles.txt`), and back-to-back UI runs both used the worker.
5. **One run sent "B2B SaaS founders public contact details", and the parser read "public contact details" as a town (0 results).** The dropped "with" never reproduced: 4/4 composer probes kept the exact text (`evidence/composer-fill-probe.txt`). Fixes:
   - `ui-gate.mts` now checks the composer value before sending.
   - The deterministic parser no longer accepts a span of requested-deliverable words as a place (`plausiblePlace` / head peel in `src/lib/understanding/fallback.ts`). Test in `founder-path.test.ts`.
   - Matrix queries containing those words keep their locations.

## Known limits (environment, not code)

- SearXNG (loopback :8888, Docker) is not running. Discovery uses in-browser DuckDuckGo/Bing, and source health reports it as degraded.
- Free LLM quotas (Groq, several OpenRouter models) ran out during testing. Understanding falls back down the provider chain or to the deterministic path. The purpose question can then take about 60 s to appear.
- The machine is memory-bound (about 0.6–2 GB free). The build needs the 4 GB heap flag. If the worker cannot start Chromium, a search still completes on the in-process browser, and the mini-browser says takeover needs the worker.
- 55 test failures and 43 typecheck errors predate this pass (triaged, frozen).
- Once, under full-suite load, `worker-adapter.test.ts` failed at suite level. It passed alone and on two full reruns.

## Local run (no deploy, no Vercel, no production writes)

1. Worker: `npm run worker:local` (loopback :8788; forces local no-persist).
2. App: `$env:SCRAPIVO_LOCAL_NO_PERSIST='true'; $env:SCRAPIVO_BROWSER_ADAPTER='worker'; npm run dev -- --port 8080`, then open http://localhost:8080.
3. Never run `scripts/start-mvp-testing.ps1`.

Notes:
- `.auth/local-user.json` (gitignored) holds the signed-in session used by `ui-gate.mts`. Delete it when done.
- `reports/mvp-release-candidate/ui/` screenshots show the account name and chat history.

READY FOR USER LOCAL TESTING
