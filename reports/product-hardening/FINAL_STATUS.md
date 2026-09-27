# SCRAPIVO HARDENING STATUS

READY FOR USER TESTING

Date: 2026-09-26. Commits: 5fa7989 (checkpoint) → 2109ad1 (hardening) → this
report. Baseline untouched: candidate-survival pipeline frozen per directive.

## UNDERSTANDING
- tested inputs: 16-class hardening battery (H1–H16, scripts/hardening-battery.mts)
- clarification accuracy: "find me investors" → 1 focus question; "find plumbers"
  → location; "find companies" → industry+location; "find me SaaS founders" →
  searches (SaaS stated); "find me founders" → asks kind; garbage → entity ask
- failures found & fixed: investor-noun override (H3 misrouted to company);
  founder industry question suppressed when location already stated

## INVESTORS
- stored records: 8,076 scanned per query (S3 parquet)
- retrievable: yes — I1 20/20 in ~12s; H2 10 in ~16s
- broad search: "Find 20 investors." → 20 returned
- filtered search: "investors backing pre-seed AI startups in North America" →
  9 qualified (was 0 ×3 causes fixed: entity routing, region location matching
  in reader/validator/theorem, sector token matching)
- runtime: broad ~12–16s; specialized ~55–65s

## JOBS
- broad: 125 postings fetched per run
- remote: "find me remote frontend jobs" → 10 returned in ~25s (was 0)
- role: hyphen normalization ("front-end" ⇄ "frontend"); alias variants
- remote handling: "remote" is a work MODE — sets geo_scope worldwide, never
  geo-gates rows carrying a city

## VOLUME (entity | requested | discovered | qualified | returned)
- plumbers Austin | 30 | 31 | 30 | 30 (29s — fast path)
- founders global | 10 | 10 | 9 | 9 (~92s)
- investors broad | 20 | 21 | 20 | 20 (12s)
- investors AI+pre-seed+NA | 10 | 17 | 9 | 9 (~65s)
- Toronto SaaS | 20 | 7 | 3 | 3 (variance)
- remote frontend jobs | 10 | 100 | 10 | 10 (25s)
- honest limits: US-restricted founders (5→0, corpus thin); signal-query class
  (needs deferred deep-signal phase); no-website HVAC (27→0, strict absence
  verification caps yield — B-class behavior)

## OUTPUT QUALITY
- why_match: evidence-derived (theorem-enforced); directory templates for
  non-signal hunts
- contact coverage: streamed rows + cards show email/phone when public
- signal vs fit: intent only under spec.signal_required; fit rows never
  labeled as intent

## SEARCH STATE
- premature zero bug: FIXED — the hardcoded "No fresh buyer-intent posts…"
  empty-state (rendered for every non-local zero incl. investors/founders/jobs)
  replaced with the retrievalTrace narrative ("N candidates were checked, but
  none passed verification…"); toast uses the same narrative
- stale state: events/results keyed by run id (existing session.accept guards)
- progressive results: verified rows stream mid-run ("✓ Name · contact ·
  N verified while researching…")

## QUERY PLANNING
- general: entity discovery templates (existing)
- Boolean/site: planDiscoveryVariants — exact phrases, site:linkedin.com/in,
  site:reddit.com + site:linkedin.com/posts public signal hunts, job role
  aliases, greenhouse/lever scopes; merged into discovery plan (capped)

## ACTIVITY PRIVACY
- internal provider names leaked: none — activity-presenter.ts sanitizes at
  publish time (SearXNG/duckduckgo/database/parquet/etc. → "Checking saved
  leads", "Searching the web", "Reading page", …); leaking detail text dropped
- user-safe events: yes; collapse: last 3 events collapsed with
  "Show all activity (N)" toggle; expanded list scrolls in a bounded region

## SCRAPY
- persistent browser: PlaywrightBrowserAdapter behind AgentBrowser
  (SCRAPIVO_BROWSER_ADAPTER=cli = legacy fallback)
- real actions: every event comes from actual driver actions (progress() only
  at real navigate/click/scroll/extract sites)
- screenshots: JPEG q45 per page change; owner-scoped state endpoint
- minimized/compact/expanded: pill ⇄ screenshot card (desktop side-dock and
  full take-control remain behind flag)
- mobile: 390×844 verified (card collapses, composer pinned)

## HOME UX
- mascot: page-mascot cat, local assets, single instance (fixed-canvas note)
- speech bubble: "Hey {name} 👋 I'm Scrapy. What are you looking for today?"
- quick choices: [Find investors][Find founders][Find companies][Find jobs]
  [Find local businesses] — flow through the SAME composer pipeline, so the
  readiness gate turns a bare chip into one conversational question
- composer: KEPT and always visible (verified live)
- clarification experience: chips + typed answer + "Search with defaults"

## PERFORMANCE
- 30 plumbers Austin: ~29s total (was ~76s for 50)
- remote frontend jobs: ~25s total, 10 rows
- investors broad: ~12s
- specialized investors: ~65s
- signal/no-website classes: up to the ~120–150s deadline (documented)

## LIVE QA
- inputs tested: H1–H16 classes (headless, real pipeline) + live UI flows
- desktop: composer/activity/results verified via screenshots
- mobile 390×844: home hero, chips, clarify chips, results cards verified
- bugs found & fixed this pass: buyer-intent fiction empty-state; investor→
  company routing; investor region location (reader + validator + theorem);
  remote-as-geography job bug; hyphenated role matching; duplicate
  "Candidate verified" events; internal provider names in activity
- remaining failures: H7 (US founders — corpus), H8 (signal depth), H14
  (strict absence yield) — all honest zeros with narratives, no silence

## REGRESSIONS
- focused: 158/158 (11 suites)
- full: not run (focused strategy per PRD)
- typecheck: clean on all touched files

## KNOWN LIMITATIONS
- browser candidate research still sequential (worker made actions ~10-20×
  cheaper; multi-page concurrency next)
- take control + pause/resume: protocol typed, UI flag disabled
- dynamic widening rounds: not yet (adaptive per-entity overfetch shipped)
- deep signal research phase (H8 class): deferred

## START COMMAND
```powershell
cd "C:\Users\mirsa\OneDrive\Desktop\Scrapivo (2)"
docker compose -f docker-compose.searxng.yml up -d   # if not running
npm run dev
```
URL: http://localhost:8080 · LAN http://192.168.1.70:8080
Batteries: `npx tsx scripts/hardening-battery.mts [H1..H16]` ·
`npx tsx scripts/full-v1-acceptance.mts [A..L]`

## DEMO FLOW
1. Home: Scrapy bubble + chips above the composer.
2. Tap "Find investors" → one conversational question → answer "AI" → search.
3. "Find 20 investors." → 20 rows in ~12s.
4. "find me remote frontend jobs" → 10 jobs in ~25s.
5. "Find 30 plumbers in Austin." → 30 rows in ~29s.
6. Watch Scrapy: sanitized activity, expandable, live browser screenshot.
7. Zero queries show honest funnel narratives — never "buyer-intent posts".
