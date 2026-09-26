# SCRAPIVO FULL INITIAL PRODUCT STATUS

READY FOR USER TESTING (with documented coverage limits)

Date: 2026-09-26. Baseline commit: c60b925. Full-V1 work builds on it without
regressing the verified baseline (see baseline.md).

## BASELINE PRESERVED
- All verified baseline behaviors re-tested live during this pass: founders
  query, 50-plumber volume, no-website verification, clarify loops, mobile UI.
- Focused regression after changes: 100/100 (6 suites) + 28/28 (clarifier,
  phase1) + 7/7 (new full-v1-additions suite).
- Touched-file typecheck: clean (pre-existing untracked-file errors unchanged).

## VOLUME ENGINE
- candidate pool behavior: `candidatePoolTarget = min(150, max(requested*3, 20))`
  (spec-search.functions.ts); live discovery `desiredCount` raised 5 → 30;
  research plan caps raised (maxCandidates 30→60, maxPages 40→60).
- provider fanout: structured source plan (OSM → jobs → SearXNG/web) + browser
  stage; per-source records with diagnostics (existing architecture preserved).
- pagination: `Show more` offset path unchanged; hasMore exactness preserved.
- concurrency: sequential per-run (unchanged) — safe; browser respects
  visited/page caps from the plan.
- dedupe: mergeDuplicateCandidates at pool entry (unchanged contract).

## AGENTIC BROWSER
- browser architecture: AgentBrowser abstraction over agent-browser CLI
  (process-based) — unchanged this pass; persistent-worker exploration deferred.
- persistent sessions: NOT yet (deferred, see LATER_WORK).
- research actions: search/open/read/extract/resolve-site/contacts/absence
  (existing) + JSON-LD structured extraction (new).
- page classification: classifyPage (existing) + structured facts module.
- browser fallback: httpFallback with resilientFetch (existing).
- live viewer: activity feed shows actions + counts (new: found-N, k/n
  researching, leads-verified tally, qualified count).
- takeover: deferred (flagged in LATER_WORK).
- cancellation: typed abort reasons; deadline finalizes, user-cancel discards
  (from candidate-survival pass, re-tested).

## ENRICHMENT
- destination resolution: registry-identity official-destination (free, ≤2
  queries, validated) — from previous pass; exercised in E/C results.
- contacts: contact-harvest from resolved sites + new first-party JSON-LD
  contact merge (page-structured.ts) with host-match attribution.
- signals: intent only under spec.signal_required (theorem gate unchanged).
- no-website: structured absence + 2 exact checks + in-browser claim minting
  (previous pass; re-verified in battery B).
- jobs: 16 free boards + ATS ladder (existing) + JSON-LD JobPosting extraction
  from browsed pages (new, deterministic).
- evidence: every claim evidence-backed; no invented fields (theorem enforced).

## DATABASE / CACHE
- write-back: persistVerifiedLiveRows → idx_* PG/Supabase (existing gating:
  qualified + resolved + non-provisional).
- cache: page/serp caches in browser-live (existing); TTL layer deferred.
- freshness: last_seen stamped on write-back; staleness reads deferred.

## UI
- progress: activity feed now shows counts ("Stored search complete · N",
  "Found local businesses · N", "Researching · name · k/n", "Leads verified ·
  N", "Leads qualified · N").
- progressive results: streaming of qualified ROWS deferred (single-shot gate
  architecture); count-level streaming shipped instead. See LATER_WORK.
- cards: existing card grids (verified in live UI).
- table: Cards/Lists toggle with per-entity tables (Business/Company/Person/
  Posts) — unchanged; generic column system deferred.
- detail: mobile sheet + desktop panel (verified).
- mobile: 390×844 verified (drawer, sheet, composer).
- desktop: verified.
- empty states: NEW zeroResultsNarrative — honest reason from retrievalTrace
  ("17 candidates were checked, but none passed verification…").
- browser activity: poll-based feed (450ms), count support added.

## PERFORMANCE
- time to first lead: first qualified rows land at final response (single
  gate); broad DB-first queries (A) complete in ~75s for 50 rows.
- largest result set: 50 qualified plumbers in 76s (battery A).
- median runtime: ~100-120s for live-research queries (120s deadline).
- browser concurrency: 1 page at a time (unchanged, safe).

## ACCEPTANCE RESULTS (scripts/full-v1-acceptance.mts, one run each)

| ID | Query | requested | discovered | returned | contacts | ms | outcome |
|----|-------|-----------|-----------|----------|----------|----|---------|
| A | 50 plumbers Austin | 50 | 58 | 50 | 50 | 76.5s | QUALIFIED_RESULTS |
| B | 10 plumbers Austin no-website | 10 | 31 | 1 | 1 | 122.7s | QUALIFIED_RESULTS |
| C | 10 SaaS founders global | 10 | 10 | 3 | 3 | 120.2s | QUALIFIED_RESULTS |
| D | founders w/ workflow-pain signal | 10 | 17 | 0 | 0 | 120.1s | NO_QUALIFIED_RESULTS |
| E | 20 SaaS companies Toronto | 20 | 7 | 4 | 4 | 97.8s | QUALIFIED_RESULTS |
| F | 25 HVAC GTA | 25 | 9 | 7 | 6 | 133.1s | QUALIFIED_RESULTS (after metro-aware location fix) |
| G | React jobs Toronto | 10 | 125 | 1 | 1 | 94.0s | QUALIFIED_RESULTS (125 jobs fetched, strict role filter) |
| H | remote ML jobs Canada | 10 | 125 | 1 | 1 | 63.5s | QUALIFIED_RESULTS |
| I | AI infrastructure investors | 10 | 0 | 0 | 0 | 1.4s | NO_QUALIFIED_RESULTS (investor slots answered; stored investor corpus has no AI-infrastructure matches — coverage gap, honest zero) |
| J | "help me find founders" | — | — | — | — | 1.5s | clarify ×1 (minimal, useful) |
| K | "asdfgh" | — | — | — | — | 12.1s | clarify ×1 (entity question — never a misleading zero) |
| L | "what's the weather in Paris" | — | — | — | — | 10.1s | clarify ×1 (off-topic never runs the pipeline) |

(Battery rows filled in as runs complete; see git history for intermediate.)

## FUNNEL METRICS
Per-run retrievalTrace logged in [spec-run] lines: rawCandidates →
postSpecFilter → researchable → researched → complete → qualified → returned.

## PROVIDER CONTRIBUTION
providerAttempts + SourceHealthRows (existing); battery logs per-run actions
counters (Searching candidates, Found search results, Researching, …).

## TARGETED TESTS
- passed: 158 (11 focused suites incl. new full-v1-additions)
- failed: 0

## TYPECHECK
- touched files: clean. Pre-existing untracked-file errors unchanged (m4/m9/
  universal-audit test files, person-qualify.ts, verification.ts).

## FILES CHANGED (this pass, after c60b925)
- src/lib/spec-search.functions.ts (pool target, desiredCount, contact caps,
  count events)
- src/lib/search/source-plan.ts (maxCandidates/maxPages raises)
- src/lib/search/live-gapfill.ts (source-count events, callback types)
- src/lib/search/browser-live.server.ts (JSON-LD wiring, structured job rows,
  first-party contact merge, research ranking, verified tally)
- src/lib/search/page-structured.ts (NEW — JSON-LD/mailto/tel facts)
- src/lib/search/outcome-ui.ts (zeroResultsNarrative)
- src/lib/search/search-browser-progress.server.ts (count field, MAX_EVENTS 80)
- src/routes/_authenticated/discover.tsx (count rendering, narrative detail,
  event state type)
- scripts/full-v1-acceptance.mts (NEW — A–L battery)
- src/lib/search/__tests__/full-v1-additions.test.ts (NEW)
- reports/full-v1/baseline.md, reports/full-v1/FINAL_STATUS.md (NEW)

## KNOWN INITIAL-V1 LIMITATIONS
- Live-research queries run to the 120s deadline; verified rows finalize but
  deep coverage needs the persistent browser worker (deferred).
- D (signal-evidence founders): 0 qualified — posting-signal verification is
  strict; no invented intent (correct per theorem, thin for now).
- B (no-website): 1-2 verified per run — Austin OSM craft data is sparse;
  strict absence verification caps honest yield.
- No LLM understanding provider keys configured — deterministic understanding
  only (LLM route activates automatically when keys are added).

## DEFERRED (LATER_WORK.md updated)
- Persistent Playwright browser worker behind AgentBrowser interface.
- Take-control + pause/resume of live browser sessions.
- True row-level result streaming (requires streaming qualification gate).
- TTL cache layer + staleness-aware read-back.
- Adaptive concurrency + dynamic pacing.
- Generic entity-driven table columns.

## START SCRAPIVO

PowerShell:
```powershell
cd "C:\Users\mirsa\OneDrive\Desktop\Scrapivo (2)"
npm run dev          # or: npx vite dev --host
```
Docker (SearXNG, required for live search):
```powershell
docker compose -f docker-compose.searxng.yml up -d
```

URL:
- Local: http://localhost:8080
- LAN (phone): http://192.168.1.70:8080

## MANUAL TEST QUERIES
```
Find 50 plumbers in Austin.
Find 10 plumbers in Austin with no website. Include their public phone numbers and emails when available.
Find 10 SaaS founders globally who may need help with AI automation.
Find founders who recently posted about struggling with manual operations or workflow automation.
Find 20 SaaS companies in Toronto and their public contact details.
Find 25 HVAC companies in the Greater Toronto Area.
Find React developer jobs in Toronto.
Find remote machine learning engineer jobs in Canada.
Find investors who focus on AI infrastructure startups.
help me find founders
asdfgh
what's the weather in Paris
```
Headless battery: `npx tsx scripts/full-v1-acceptance.mts [A|B|...|L]`
