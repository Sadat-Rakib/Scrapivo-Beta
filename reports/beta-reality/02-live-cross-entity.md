# Beta Reality — 02 Live Cross-Entity Battery (real UI runs, desktop)

| # | query | asked | discovered/researched | qualified (UI) | first verdict | verdict |
|---|---|---|---|---|---|---|
| B5 | Find 30 plumbers in Austin | purpose (1q) | 48 | **48 returned**, real phones, why_match | ~2 min | **PASS** (fast, structured, no wasteful browsing) |
| B4 | Find 20 AI startups in Toronto | none | 15 leads, clutch.co 19p | **1 rendered** (Formic AI, good identity+email); DB `results_count` later 49 | ~3.5 min | **FAIL volume/streaming** — user sees 1/20; widening produced more but conversation attached 1 |
| B3 | D2C brands in India | none | 10 activity events, 1 site | **0 returned** | ~2 min | **FAIL DISCOVERY/CANDIDATE_VOLUME** — shallow discovery, no widening, silent zero |
| B7 | Find 30 remote React developer jobs in Canada | none | whatjobs/adzuna/careers-page | **13 returned** | ~2 min | **PARTIAL** — volume ok-ish; sources are UK/PL aggregators not ATS; Canada constraint not visibly enforced; "Hiring signal" label bleeds onto job rows |
| B6 | Find 20 HVAC companies in GTA without websites | none | per-candidate absence checks | **1 returned** (real company+phone) | ~3.5 min | **FAIL volume** — budget burned browsing microsoft.com 9 pages during absence verification |
| B1 | Find 20 SaaS founders in Canada | none | 19 links | **0 returned** | ~2 min | **FAIL** — people acquisition yields zero; browser spent 8 pages/10 actions on bing.com SERPs |
| B2 | Find CTOs at AI startups in London | none | linkedin-site: queries ×3 repeated | **1 returned — WRONG** (Conference Director @ Sedex ≠ CTO @ AI startup) | ~3.5 min | **FAIL QUALIFICATION** — role/company constraints not enforced |
| B8 | Find 20 pre-seed AI investors in North America | none | investor corpus + enrichment | **41 returned** with stage/focus/geo tags, emails, phones | ~2 min | **PASS** (strongest path) |
| B9 | accelerators for an early-stage Canadian AI startup | purpose + "Did you mean Canada?" | queries degraded to "AI company Canada" | — (still asking business-model questions) | — | **FAIL** — accelerator not a first-class subtype; redundant location question; query lost "accelerator" |
| B10 | Find SaaS founders talking about manual operations | none | deep-signal path works | **2 returned** (real founders: Field, Canva) | ~3.5 min | **FAIL CONTACT TRUTH** — emails are pattern-guessed (melanie.perkins@canva.com) presented as verified; no signal evidence/date visible in row |

Not run live this session (context budget): B12 (VP Sales — same class as B2), B11 (intent — same class as B10).

## Score
- Working end-to-end: LOCAL BUSINESS (48/30), INVESTORS (41/20).
- Partial: JOBS (13/30, wrong source mix), PEOPLE-with-signals (2, fabricated contacts).
- Broken: COMPANIES (1, 0), PEOPLE plain search (0), ACCELERATORS (misrouted), QUALIFICATION for role queries.

## The user's question answered
"Can a random beta user type a real request and consistently get useful opportunities?" —
**NO, not yet, and not uniformly.** It works for investors and local businesses. Companies and
people searches end with an honest-looking zero after ~2 minutes of browser waste. Jobs return
volume from low-grade aggregator sources with unverified location. And when people DO come back,
their emails may be invented. That last one is a beta-blocking truth violation.
