# SCRAPIVO BETA REALITY STATUS: BLOCKED

(One flat statement, per spec §49. BLOCKED means: real users on people/company queries get
premature zeros and non-matching leads, the understanding gate misroutes several entity classes,
and durable jobs/watch tables are missing from the deployed database. Investors and local
businesses already pass end-to-end.)

## REAL QUERY SUMMARY

| query | category | asked | discovered | researched | qualified (UI) | returned | first_verified | total | verdict |
|---|---|---|---|---|---|---|---|---|---|
| Find 30 plumbers in Austin | local | 1 (purpose) | 48 | 48 | 48 | 48 | ~90s | ~2min | PASS |
| Find 20 AI startups in Toronto | company | 0 | 15 leads | clutch.co 19p | 1 | 1 | ~3min | ~3.5min | FAIL volume/streaming |
| D2C brands in India | company | 0 | 1 site | shallow | 0 | 0 | — | ~2min | FAIL discovery |
| Find 30 remote React developer jobs in Canada | jobs | 0 | aggregator boards | — | 13 | 13 | ~90s | ~2min | PARTIAL (wrong sources, location unverified) |
| Find 20 HVAC companies in GTA without websites | local/no-website | 0 | msft.com 9p waste | per-candidate | 1 | 1 | ~3min | ~3.5min | FAIL volume (browser waste) |
| Find 20 SaaS founders in Canada | people | 0 | 19 links | bing SERP 8p | 0 | 0 | — | ~2min | FAIL |
| Find CTOs at AI startups in London | people/role | 0 | linkedin queries ×3 | bing SERP 8p | 1 (WRONG) | 1 | ~3min | ~3.5min | FAIL qualification |
| Find 20 pre-seed AI investors in North America | investor | 0 | corpus+enrichment | — | 41 | 41 | ~90s | ~2min | PASS |
| accelerators for an early-stage Canadian AI startup | accelerator | 3 (redundant) | lost "accelerator" | — | — | — | — | — | FAIL routing |
| Find SaaS founders talking about manual operations | signal | 0 | deep-signal path | 2 founders | 2 | 2 | ~3min | ~3.5min | FAIL contact truth (pattern-guessed emails) |

B12 (VP Sales) and B11 (intent) not run live this session (context budget).

## UNDERSTANDING
tested: 22 · passed: 13 (+2 minor) · failed: 5 systemic (F1–F5) · fixed: 0 (subagent infra died) · open: 5
Bare jobs/investors/accelerators bypass clarification; no off-topic gate; "need buyers" misquestion;
accelerators misrouted + redundant questions.

## PEOPLE
requested 20+20 · returned 0 and 1-wrong-role · signal-shape people search returned 2 real founders
with fabricated emails (now fixed at the source).

## COMPANIES
1 and 0 returned for targets 20 — discovery too shallow, widening not reached before run end.

## LOCAL BUSINESSES
48/30 plumbers (strong, structured, fast) · 1/20 no-website HVAC (honest but starved by browser waste).

## JOBS
13/30 remote React Canada, but from UK/PL aggregators, not ATS feeds; ATS adapters+seeds did not win the plan.

## INVESTORS
41/20 pre-seed AI North America — corpus + stage/focus/geo tags + contacts. Strongest path.

## ACCELERATORS
Not first-class: routed to companies, asked redundant questions, discovery lost "accelerator".

## SIGNAL / INTENT
Deep-signal path resolves real people (2/2 real founders). Contact truth violation fixed at source;
signal evidence/date not shown on the returned rows (checked card view only).

## BROWSER
pages opened: ~60 across runs · irrelevant: dominant in people/company runs (bing SERPs 8p,
microsoft.com/support 8–10p ×2) · blocked: none encountered · fallbacks: http fallback worked ·
take-control: NOT functional ("coming next") · HTTP/structured/browser ratio: good for local +
investors; browser-dominated (bad) for people/company runs.

## SOURCE ROUTING
known-source routing: investors + local correct; jobs wrong tier (aggregators over ATS) ·
real-time discovery: works but shallow for companies · registry enforcement: active in plan layer ·
dangling components: none new; all registry/pacer/recognition/seeds now have production callers.

## VOLUME
target-10: local passes; people/company fail · target-100: NOT TESTABLE live (search_jobs table
missing from DB — migration not applied) · target-1000 mechanics: not run (same blocker) ·
widening: exists in code, not reached in 120s window before the budget fix.

## OUTPUT QUALITY
why_match: 100% on local/investor rows · summary: good · contacts: real where structured (local,
investors); FABRICATED for people (fixed at source) · signals: not evidenced on rows · intent: n/a ·
evidence: present on qualified rows.

## PROJECT CONTEXT
Not testable end-to-end (projects tables are among the unapplied migrations).

## UI
desktop 1366×768: composer, clarify cards, activity collapse, results table all usable; history view
works · mobile 390×844: not exercised this session · activity: user-safe copy, no internal jargon ·
browser panel: live browsing visible · tables: semantic table with correct columns.

## PERFORMANCE
local ~2min/48 results · investors ~2min/41 · people/company runs died at the 120s deadline
(adaptive budget now deployed, unvalidated live) · repeated identical queries observed (×3).

## FIXES MADE
See 09-fixed-failures.md — 8 fixes: dead dev app (route transform), adaptive run budget,
fabricated-email ban (2 sites), SERP skip, discovery furniture gate, gate entity context,
vitest excludes.

## KNOWN LIMITATIONS
See 10-open-limitations.md — 9 items, ordered by triage priority.

## NEXT BETA TRIAGE ITEMS
1. People/company zero-yield root cause (qualify/identity) — biggest blocker.
2. Understanding gate F1–F5 (mode-gate/readiness branches).
3. Role/company constraint enforcement in qualify.ts.
4. Jobs: ATS-first routing + location eligibility.
5. Apply the 6 DB migrations (owner action).
6. Validate the deployed fixes live (budget, furniture gate, contact truth).
