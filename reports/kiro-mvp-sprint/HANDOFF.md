# Kiro MVP sprint handoff

Plan: approved MVP RC plan + OpenMuse addendum (Q1=a local no-persist, Q2=a user signs in once, Q3=a no system changes first). Hard rules: no git add/commit/push/deploy, no Vercel env changes, no production Supabase/S3 writes, never run `scripts/start-mvp-testing.ps1`.

## CURRENT HEAD
`main` @ `7805e75e452d925a6d88e3db880622fdb2f35207` (unchanged; nothing committed).

## CURRENT WORKTREE
Checkpoint edits plus this pass's edits, all uncommitted.
- Baseline copies `C:\scrapivo-baseline\{head,worktree}` were removed at the end of the pass. Their junctions were unlinked first, and the repo's `node_modules` (395 entries) and `data` (109) were verified intact.
- The OpenMuse reference clone `C:\ref\openmuse` was also removed.
- The baseline evidence is kept in `reports/mvp-release-candidate/baseline/`: porcelain v2 status, binary diff vs HEAD, SHA-256 manifest, DB write-site map.

## WHAT IS DONE
- Task 1: baselines; KNOWN_RED frozen (1387 total / 1317 pass / 59 fail / 11 skip, 60 entries incl. 1 suite-level); env probes; OpenMuse reference at `C:\ref\openmuse` @ d0b3a6b; local no-persist guard (`src/lib/persistence-policy.server.ts`) wired into search_history (transcript + legacy search/local), profiles quota, canonical live write-back, qualified_leads, source_health, source_yield_stats, ats_companies, ats_check_queue, ai_cache, lead_research, job worker start.

## ENVIRONMENT FACTS
- 15.6 GB RAM; commit limit 39.9 GB with only ~2.6 GB free at pass start; Kiro processes hold ~16.6 GB private (48 procs). This is the likely build OOM cause (esbuild errno=1455).
- SEARXNG_URL is loopback :8888 and NOT reachable (docker engine not running). Browser discovery falls back to in-browser DDG/Bing.
- LLM keys present: GROQ, OPENROUTER, NARAROUTER, MISTRAL. Paid search keys present (TAVILY, SERPER, SERPAPI) but free-first rules apply.
- Chromium: ms-playwright chromium-1208/1243 installed. Node v24.19.0. WSL: only docker-desktop distro.

- Task 2: 25 focused tests pass. Fair stress scorer `reports/mvp-release-candidate/stress.mts`: raw 78 → mechanics 89 → policy-adjusted 95/100. Remaining 5 = typo places (Task 12). Fixed SOCIAL_TOPIC compound-noun bug and "could use X" modal in `src/lib/understanding/to-search-spec.ts` (test `social-topic-modal.test.ts`). See `STRESS_CLASSIFICATION.md`, `CONTRACT_CHANGES.md`.

- Task 3: trace hooks (`onTrace`, no-op default) in `browser-live.server.ts` + `live-gapfill.ts` passthrough `onBrowserTrace`; tests `src/lib/search/__tests__/browser-trace.test.ts`. Harness `reports/mvp-release-candidate/browser-trace.mts <founders|businesses> <smoke|product>`. Verdict RUNTIME_OK. First failing boundary = SERP organic-link selection. Second = no deterministic business extractor + JSON-LD first-block only. See `BROWSER_TRACE.md`.

- Task 4 (fixes, all test-first): Playwright `extractLinks` + DDG challenge friction + all-JSON-LD extraction; engine hosts re-filtered after unwrapping redirects; SERP results must share a query term; SearXNG unavailability memoized per run; blocked engines skipped for the run; deterministic JSON-LD business rows (`structuredBusinessRows`); canonical `contact` requirement (email|phone|first-party contact page); contact attribution (`contact-attribution.ts`); contact page must render contact content; HTTP 404 short-circuit; no input mutation. Understanding repairs (has_asset object, contact-as-relation, target descriptors, hiring wording). m10 live-DB test now opt-in only (`SCRAPIVO_ALLOW_LIVE_DB_TESTS=true`) — it previously wrote test rows to production Supabase on every full run.

- Task 5 (HARD GATE, server core): PASSED on a real headed run — `reports/mvp-release-candidate/FIRST_BROWSER_ROW.md` (5 qualified founders, evidence audit clean, 3 streamed). Fixture `first-browser-row.test.ts`. Role/industry split in `fallback.ts`; `announceVerified` streaming (`verified-streaming.test.ts`).
- FULL GATE #1: tests 1439 total / 56 failed all KNOWN_RED / 0 new; typecheck 43 = baseline; `npm run build` SUCCEEDS with NODE_OPTIONS=--max-old-space-size=4096 (peak node private 5.3 GB — environment-bound).

- Tasks 5A/5B/5C/5E (worker runtime, OpenMuse-derived, MIT notices in `src/browser-worker/THIRD_PARTY_NOTICES.md`):
  - Worker core `src/browser-worker/`: `network-guard.ts` (public-IP allowlist, metadata hosts, validated-DNS pin), `egress-proxy.ts` (Chromium traffic only via the guard; connects to the validated address), `session-manager.ts` (persistent profile per session, one lane per owner+run, per-session serialization, atomic navigate→read, cancel before/after navigation, ref actions with stale-snapshot guard, human takeover with exclusive control, retain-after-run, idle sweeper, active/profile limits, retryable failed launch), `routes.ts` (token ≥32 chars, constant-time compare, owner-scoped, typed sanitized errors, no script eval; a session created for a caller that disconnected is closed).
  - Mounted in `src/research-worker/server.ts` under `/browser/*`; local launcher `npm run worker:local` (`scripts/local-browser-worker.mts`).
  - App side: `browser-worker-config.server.ts`, `browser-worker-client.server.ts`, `worker-browser.server.ts` (`WorkerBrowserAdapter`), seam `browser-runtime.server.ts` (`SCRAPIVO_BROWSER_ADAPTER=playwright|cli|worker`; `WorkerWithFallback` reports every fallback as a trace `runtime` event).
  - Evidence provenance: every browser-observed evidence item gets `id` + `provenance {acquisition, requested_url, search_run_id, browser_session_id}` (`evidence-provenance.test.ts`).
  - Tests: `src/browser-worker/__tests__/{network-guard,session-manager,worker-adapter}.test.ts` (60 pass; worker-adapter runs unchanged discovery list→company site→contact page through the HTTP worker + real Chromium, asserts one retained session, cancel closes, fallback reported).

- Task 5D (worker runtime gate): PASSED — `reports/mvp-release-candidate/WORKER_RUNTIME_GATE.md` (runtime used=worker, 5 qualified founders, 3 streamed, audit clean, one retained session). Fixed: a run stopped by its time budget closed the worker session as "cancelled"; `AgentBrowser.close(session, outcome)` now carries the outcome.
- Task 5F + Task 10 (takeover + retention): `src/lib/search/scrapy-browser-control.{ts,server.ts,functions.ts}` (authenticated, owner-scoped, closed command set), `getScrapyBrowserState` live worker frames + `adapter/controller/retained/canControl`, `ScrapyBrowser` Take control / Give back / Close + click/type/keys/scroll, mini-browser stays mounted after the search settles. Worker `close(retain)` keeps a person in control.
- FULL GATE #2: tests 1514 / 0 new from this pass (one new suite-level failure `Promotional Videos/film/lib/motion.test.js`, a folder created 22:35 by parallel promo work, same failure mode as the known motion-reel-kit entry); typecheck 43 = baseline; build exit 0; client bundle has no Playwright, worker routes, or worker token.

- Tasks 6–19 (details in `reports/mvp-release-candidate/*.md`):
  - **Candidate ledger** (`candidate-ledger.ts`): records each candidate's fate, including `filtered` (SPEC_MISMATCH / UNPROVEN_CRITERION), and reconciles streamed vs returned. UI refusals are matched per row.
  - **Row retention, real cancel, website status, source health, privacy regex, guided pills.**
  - **Founder understanding fixes:**
    - "globally"/"worldwide" → `geo_scope=worldwide`, run last.
    - Contact normalization (any channel; negations aren't asks).
    - `splitInnerPlace` ("fintech in London").
    - A bare participle isn't a town.
  - **Opt-in gazetteer** with strict typo repair (stress 100/100).
  - **Strict stream/delivery judge:** `isVerified` uses `rowSatisfiesSpec`, a post-research judge runs on `completeRows`, and browser seeds are filtered. Matrix m07/m19 no longer deliver unknown-category rows.
  - **Presenter scrub:** infra hosts and credentials only.
  - **Stored company/investor evidence.**
  - **Worker review fixes:** branch control, idle sweeper, eviction behind the lane queue, env denylist, trace flush.
  - **Adversarial 500-char boundary.**
  - **Reports:** `FOUNDER_PATH.md`, `LOCAL_BUSINESS_PATH.md`, `TEST_TRIAGE.md`, `TYPECHECK_TRIAGE.md`, `SEMANTIC_REVIEW.md`, `MATRIX.md` (PASS 6 / HONEST_ZERO 18 / FAIL 0), `ADVERSARIAL.md` (40/40), `BUILD_MEMORY.md`, `ui/mobile-clarify.json`.
- **Task 20 (authenticated UI acceptance): PASSED.** The user signed in once. Desktop and mobile runs passed on the final tree: founders 5/5 streamed→delivered on the worker, with take control, give back and close all working; dentists 41/41 dentist. Defects found and fixed:
  - Blank dev UI: `optimizeDeps.exclude` playwright-core.
  - "anon" card footer.
  - General clinics returned for dentists.
  - Headed worker tab race, which caused the in-process fallback.
  - A trailing deliverable read as a town.
  - See `reports/mvp-release-candidate/FINAL_STATUS.md`.
- **Task 21:** final gates on the final tree; FINAL_STATUS written; scratch removed (`tmp/`, baseline copies, OpenMuse clone, test temp, probe worker profiles); all background processes stopped.

## BLOCKED ON USER
Nothing. Verdict: `READY FOR USER LOCAL TESTING` (`reports/mvp-release-candidate/FINAL_STATUS.md`).

## CURRENT FAILURES
KNOWN_RED only (see `reports/mvp-release-candidate/KNOWN_RED.json`). Once under full-suite load, `worker-adapter.test.ts` failed at suite level. It passed alone and on the next two full runs.

## LAST TEST COMMAND
`node reports/mvp-release-candidate/tools/vt.mjs --maxWorkers=2` (final tree)

## LAST TEST RESULT
- Tests: 1568 total / 1498 pass / 55 fail, all KNOWN_RED / 15 skipped / 0 new.
- Typecheck: 43 = baseline, no group above baseline.
- Build: exit 0 (163 s).
- Bundle scan: clean.
- Stress: 100/100. Adversarial: 40/40.
- Evidence: `reports/mvp-release-candidate/evidence/`.

## NEXT EXACT ACTION
User local testing:
1. `npm run worker:local`
2. `$env:SCRAPIVO_LOCAL_NO_PERSIST='true'; $env:SCRAPIVO_BROWSER_ADAPTER='worker'; npm run dev -- --port 8080`
3. Open http://localhost:8080.

Optional engineering follow-ups:
- Start SearXNG (Docker) for wider discovery.
- Investigate the one unreproduced composer word drop if it recurs. `ui-gate.mts` now records it.

## PROGRESS RECORD (end of pass)
- **Finished:** Tasks 1–21.
- **Saved this final session:**
  - `vite.config.ts`
  - `src/components/lead-card.tsx` + `lead-card.test.tsx`
  - `src/lib/canonical/businesses.server.ts`
  - `src/lib/search/live-gapfill.ts`
  - `src/lib/search/__tests__/clinic-category.test.ts`
  - `src/browser-worker/session-manager.ts` + `__tests__/session-manager.test.ts`
  - `src/lib/understanding/fallback.ts` + `founder-path.test.ts`
  - Tools: `reports/mvp-release-candidate/tools/{ui-gate.mts,vt.mjs,matrix.mjs,bundle-scan.mjs,worker-cycle.mts}`
  - Reports: `FINAL_STATUS.md`, `BUILD_MEMORY.md`, `TYPECHECK_TRIAGE.md`, `evidence/`
- **Failed / not done:** none blocking. Environment limits (no SearXNG, exhausted free LLM quotas, tight memory) are documented in FINAL_STATUS.
- **Next:** user local testing.

## IMPORTANT FILES
- Verdict: `reports/mvp-release-candidate/FINAL_STATUS.md`.
- Runner: `reports/mvp-release-candidate/tools/vt.mjs` (prints only NEW failures vs KNOWN_RED).
- UI acceptance:
  - `tools/auth-capture.mts` signs in once and saves `.auth/local-user.json` (gitignored; delete when done).
  - `tools/ui-gate.mts "<query>" <tag> [--mobile] [--takeover]`.
- Gates: `tools/bundle-scan.mjs` (after build), `tools/worker-cycle.mts` (worker launch stress), `tools/matrix.mjs`, `tools/adversarial.mts`, `stress.mts`.
- Guard: `src/lib/persistence-policy.server.ts`; set `SCRAPIVO_LOCAL_NO_PERSIST=true` in harness/dev-server env (ignored when NODE_ENV=production or VERCEL*).
- Browser: `src/lib/search/browser-live.server.ts`, `src/lib/search/live-gapfill.ts`, `src/lib/research-agent/*`, `src/browser-worker/*`, `src/research-worker/server.ts`.
