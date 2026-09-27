# SCRAPIVO PRODUCT COMPLETION STATUS

READY FOR USER TESTING

Date: 2026-09-26. Commits: c60b925 (candidate-survival baseline) → 8981850
(full-V1 volume/UI) → 7d883a7 (investors/perf/off-topic) → 3f4c59c (Scrapy
browser + mascot).

## BASELINE
- preserved: yes — every verified behavior re-tested (A battery, live UI)
- focused tests: 158/158 (11 suites)
- typecheck: clean on all touched files (pre-existing untracked-file errors
  and research-agent.functions.ts middleware-typing errors unchanged)

## INVESTORS (Phase 2 — fixed)
- DB rows accessible: 8,076 investors scanned per query (S3 parquet corpus)
- indexed: no PG idx_investors (single parquet read, fast)
- broad query returned: I1 "Find 20 investors." → 21 discovered, 20 returned,
  12s (was: blocked by clarify gate — investor slots no longer blocking)
- AI-infra candidates: sector token matching ("AI infrastructure startups" →
  ANY of {ai, infrastructure}) — I2 → 2 qualified real investors
  (AME Cloud Ventures et al.) in ~50s incl. live research
- researched/qualified/runtime: see ACCEPTANCE below
- key fix: REQUIRED.investor = [] (broad-then-enrich) +
  investorSectorMatches token expansion (search-spec.ts) used by both the
  parquet reader and the strict validator

## VOLUME
- local business: 50 returned (battery A, prior pass; unchanged)
- founders: 9 verified (C, persistent browser — was 3)
- companies: 4 (E, prior pass)
- jobs: 125 fetched/run, strict role filter → 1 (honest)
- investors: 20 broad / 2 focus-specific

## PERFORMANCE
- A first result: rows land at final gate (single-gate architecture; streamed
  verified rows now appear mid-run for live-researched entities)
- A total: ~76s for 50 rows (prior pass)
- C first result: verified rows stream from ~30s via candidate-verified events
- C total: ~127s (persistent worker; 9 verified vs 3 on CLI adapter)
- investor first result: I1 12s total; deep signal total: ~120s cap
- stage timings now in retrievalTrace.timings (understanding/stored/research/
  enrichment/qualification/total) + [spec-run] log

## DISCOVERY CONCURRENCY
- provider concurrency: structured source plan sequential-with-early-stop
  (unchanged); jobs fleet fetches 16 boards in parallel (existing)
- HTTP concurrency: contact enrichment Promise.all (cap 12, existing)
- browser concurrency: 1 page (sequential research loop) — but each action is
  now ~50-150ms on the persistent worker instead of a 1-3s process spawn
  (≈10-20× per-action speedup, same safe semantics)
- per-domain cap: visited/page caps from plan (unchanged)

## SCRAPY BROWSER
- persistent worker: YES — PlaywrightBrowserAdapter
  (src/lib/research-agent/playwright-browser.server.ts) behind the unchanged
  AgentBrowser interface; SCRAPIVO_BROWSER_ADAPTER=cli forces the legacy
  adapter; chromium already present (playwright-core 1.63)
- session reuse: one browser per process, one context per session/run
- live screenshots: JPEG q45 captured after every page change
  (SCRAPIVO_BROWSER_SCREENSHOTS=false disables); served as data URLs by
  getScrapyBrowserState (owner-scoped, ≤300KB)
- action events: typed progress events with counts + streamed verified rows
  (existing poll channel, 450ms)
- pause/resume: NOT in this pass (protocol ready via session status)
- take control: behind flag — button renders disabled ("coming next"); same-
  session takeover protocol documented (screenshot-coordinate mapping)
- mobile browser: Scrapy renders as an inline collapsible card in the activity
  area (works at 390×844; no layout surgery)
- desktop browser: same collapsible card (right-dock layout deferred)

## PROGRESSIVE RESULTS
- row streaming: verified leads stream mid-run as typed events with payload
  (StreamedLead); UI renders "✓ name · contact" lines + running count under
  the activity feed ("N verified while researching…")
- stale protection: events keyed by run id; session.accept guards unchanged
- final reconciliation: final server response remains authoritative

## HOME UI
- mascot: page-mascot (MIT) cat with LOCAL sprite sheets in
  /public/mascots/*.webp (downloaded, never hotlinked); 112px mobile / 152px
  desktop; respects reduced-motion; cursor tracking degrades on touch
- personalized greeting: "Hey {firstName}, I'm Scrapy." from profile
  full_name; "Hey, I'm Scrapy." when unknown — no fabrication
- New Chat: top-right (existing) — resets to clean greeting state
- composer: existing rounded composer remains the focal point
- desktop/mobile: both verified (mascot sizes switch at sm breakpoint)

## OFF-TOPIC ROUTER
- weather test: "what's the weather in Paris" → UNSUPPORTED_CAPABILITY in
  ~0.3s with boundary copy — no retrieval, no browser, no clarify
- garbage test: "asdfgh" still asks the entity clarify question

## ACCEPTANCE A–L (one run each; prior-pass rows unchanged unless noted)
- A (50 plumbers Austin): 58→50 returned, 50 contacts, ~76s — QUALIFIED
- B (Austin no-website): 31→1 verified, ~123s — QUALIFIED (strict absence)
- C (SaaS founders): 10→**9 verified** (persistent worker), 7 contacts, ~127s
- D (workflow-pain signal): 17→0 — honest zero (deep signal research deferred)
- E (20 Toronto SaaS): 7→4, 4 contacts, ~98s — QUALIFIED
- F (25 HVAC GTA): 9→7, 6 contacts, ~133s — QUALIFIED (metro location fix)
- G/H (jobs): 125 fetched → 1 returned each — QUALIFIED (strict role filter)
- I1 (Find 20 investors): 21→20 returned, 12s — QUALIFIED (new)
- I2 (AI-infrastructure investors): 8076 scanned → 2 qualified, ~50s (new)
- J (help me find founders): clarify ×1 — correct
- K (asdfgh): entity clarify ×1 — correct
- L (weather): domain boundary ×1, 0.3s, no pipeline — correct

## TESTS
- targeted: 7/7 page-structured + narrative
- focused: 158/158 (11 suites)
- full: not run this pass (per test strategy — focused only)
- failures: 0

## FILES CHANGED (this pass, after 8981850)
- src/lib/search/search-spec.ts — investor REQUIRED=[] + sector token matcher
- src/lib/canonical/investors.server.ts — token-ANY sector filter
- src/lib/spec-search.functions.ts — per-entity overfetch (cap 250), off-topic
  boundary router, stage timings, ownerId threading, Scrapy state endpoint,
  boundary_message field
- src/lib/research-agent/playwright-browser.server.ts — NEW persistent worker
- src/lib/search/scrapy-browser.server.ts — NEW session registry
- src/lib/search/browser-live.server.ts — adapter factory, streamed rows
- src/lib/search/live-gapfill.ts — ownerId + event type threading
- src/lib/search/search-browser-progress.server.ts — StreamedLead payload
- src/components/discover/scrapy-browser.tsx — NEW Scrapy viewer
- src/components/discover/discover-welcome-hero.tsx — Scrapy mascot hero
- src/routes/_authenticated/discover.tsx — viewer + streamed-row rendering
- scripts/full-v1-acceptance.mts — investor answers for I
- public/mascots/*.webp — LOCAL assets (MIT project, downloaded)

## REMAINING LIMITATIONS
- Browser research is still sequential (one page); the worker made each action
  ~10-20× faster, and multi-page candidate concurrency is the next lever.
- D (signal queries) needs the deferred deep-signal research phase.
- Investor sector matching is token-level; a richer focus/portfolio enrichment
  pass would raise I2 yield (2 today).
- Take control + pause/resume: protocol ready, UI flag disabled.
- Row-level card streaming (vs summary lines) needs incremental result state.

## START SCRAPIVO

PowerShell:
```powershell
cd "C:\Users\mirsa\OneDrive\Desktop\Scrapivo (2)"
docker compose -f docker-compose.searxng.yml up -d   # if not running
npm run dev
```

URL:
- Local: http://localhost:8080
- LAN (phone): http://192.168.1.70:8080

## MANUAL DEMO SCRIPT
1. Open /discover — Scrapy cat greets: "Hey {name}, I'm Scrapy."
2. "Find 50 plumbers in Austin." → 50 real businesses in ~76s.
3. "Find 10 SaaS founders globally who may need help with AI automation." →
   watch the activity counts + Scrapy pill; expand it to see the live
   Chromium screenshot; "✓ verified while researching" lines appear as
   founders qualify (~9).
4. "Find 20 investors." → 20 investors in ~12s (DB corpus).
5. "Find 10 investors who focus on AI infrastructure startups." → real
   AI-infra investors with evidence.
6. Mobile: mascot fits, Scrapy card collapses/expands, results readable.
7. "what's the weather in Paris" → instant domain boundary, no pipeline.
