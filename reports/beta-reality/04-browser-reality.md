# Beta Reality — 03 Source Routing + 04 Browser Reality (live evidence)

## Browser reality (Phase D, live sessions)
Observed pages opened by the browser during real runs:

| run | observed browser behavior | classification |
|---|---|---|
| B5 plumbers | no visible browsing; structured listing path | USEFUL ratio ~1.0 |
| B4 startups | clutch.co directory, 19 pages | USEFUL (directory) |
| B3 D2C | qikink.com (a D2C brand itself), 2 pages, then run ended | LOW YIELD, shallow |
| B6 HVAC no-website | **microsoft.com, 9 pages, 71s** while verifying a GTA HVAC company's website absence | **IRRELEVANT — the §15 Microsoft regression, live** |
| B1 founders | **bing.com SERP, 8 pages, 10 actions** | **IRRELEVANT — browser paginating a search-results page** |
| B2 CTOs | **bing.com, 8 pages**, site:linkedin queries repeated ×3 | **IRRELEVANT + repeated queries** |
| B10 signal | **support.microsoft.com, 8 pages, 83s** | **IRRELEVANT — support page class, live §15 regression** |

- irrelevant_page_rate in browser-heavy runs: dominant (8 of 8-12 observed pages are SERP/irrelevant).
- The page-relevance classifier exists (`classifyPageRelevance`) but is only wired into
  `verifyCandidateFromSnapshot`; the discovery/open path opens SERP pages and irrelevant results
  without consulting it, and nothing skips bing.com SERP pagination.
- Take Control: UI shows "Take control (coming next)" — NOT functional. Recorded honestly (§18).

## Source routing (Phase C)
- JOBS: live rows came from uk.whatjobs.com / pl.whatjobs.com / adzuna.com / careers-page.com —
  third-party aggregators. No ATS feed rows visible for remote React Canada even though ATS
  adapters + board seeds exist. Structured-first routing is not winning the plan.
- INVESTORS: corpus-first, strong enrichment. Correct tiering.
- LOCAL: OSM/structured listing first, no browser. Correct tiering — matches spec.
- COMPANIES: search engine → browser SERP browsing → weak identity verification → zero. This is
  the "search engine → browser only" coverage gap the PRD warned about (§11), now proven live.
- PEOPLE: same shape as companies; zero yield without the signal path.
- SIGNAL: deep-signal path did the research (only path that resolved real founders).

## No-silent-zero check (§33/34)
Zero renders as "No verified matches found ... Try broadening the search". It does NOT distinguish
"sources failed / coverage incomplete" from "verified none exist" in the UI, and the runs ended
after ~2 minutes with a dozen activity events — so the zeros in B1/B3 are premature, not honest
coverage exhaustion.
