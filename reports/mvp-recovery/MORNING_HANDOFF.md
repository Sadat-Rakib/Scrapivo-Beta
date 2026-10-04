# MORNING HANDOFF — 2026-10-04

## What changed overnight
1. **Failure A (premature zero) FIXED** — per-turn zero card now gated on runInFlight (b525473). The "No verified matches" banner cannot render while a new search is understanding.
2. **Failure B (unexplained CANCELLED) FIXED** — session close attributes by abort reason (22e2de4): deadline/stale aborts no longer render CANCELLED.
3. **Deterministic extraction layer** (e6d0193) — local-business/person candidates come from page text/title/structure with NO extraction LLM. Five fixtures green (first-party, directory, HVAC, no-markup, nav-only).
4. **Target-aware research queue** (d5a5bd5) — the flat 6-candidate cap is gone; pools size to 12..60 by requested count.
5. **Search-based domain discovery** (efff08d) — official sites are found via search, not slug guessing.

## What works now (real UI evidence)
- **PC1 Calgary plumbers: 50 delivered** — full pipeline PASS (stored supply).
- **PC3 Calgary businesses: 3 delivered** — first **browser-supplied** delivery (OSM+browser, first-party domains saucal.com / bristolwindowcleaning.ca).
- **HVAC Toronto: 2 delivered** (was 0) — first OSM-pipeline delivery, PARTIAL vs target 10.
- **Cebu photographers: 2 delivered, streamed** (was 0) — PARTIAL vs target 5.
- Watchdog + stage telemetry live; ledger `unaccounted: 0` on every run.

## What still fails (P1, instrumented)
1. **HVAC Toronto 2/10** — OSM `craft=hvac` Toronto is thin (140 rows mostly `rejected_category`); browser query "HVAC Toronto" yielded EXTRACTION_EMPTY on 1 nav. Need HVAC-specific acquisition (browser query families for HVAC, or better OSM tags).
2. **Cebu 6 candidates stuck at `missing: contact_or_site`** — domain discovery resolves few small-business sites; the search-based pass fires only when a website_url already exists — extend it to fire on `missing: website` candidates.
3. **Run-to-run acquisition variance** — PC3 pool was 163 raw then 349 then 498 across identical queries; coverage sampling needs stabilization.

## Test these first (in order)
1. `Find 5 local businesses in Calgary with a public phone number and website` → expect ≥3 delivered (regression check).
2. `Find 10 HVAC companies in Toronto with a website and phone number` → expect more than 2 delivered after the acquisition fix.
3. `Find 5 wedding photographers in Cebu with public contact information` → expect more than 2.
4. A messy query: `need like 7 hvac companies around toronto/gta, need sites and numbers, real ones i can actually contact` → intent should normalize without clarification.
5. Stop button during browsing → fast settle, no CANCELLED mislabel.

## Blockers
- SearXNG/Docker down (external) — the ladder degrades to duckduckgo/bing; runs still complete.
- LLM extractor quotas flapped during the session — the deterministic layer covers local-business extraction without it (proven by fixtures + PC3).

## Commit to be on
`1c70c78` (rc/mvp-local-testing-baseline). Dev server: `SCRAPIVO_LOCAL_NO_PERSIST=true SCRAPIVO_BROWSER_ADAPTER=worker npm run dev -- --port 8080`; warm-up ~60-90s before first search.
