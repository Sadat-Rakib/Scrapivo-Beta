# Phase A — positive-control evidence (Final-MVP PRD, 2026-10-03)

Post-Phase-D-first-fix runs through the real UI (`evidence/runs/PC{1,2,3}.json`):

## PC1 — "Find 5 plumbers in Calgary with public phone numbers." → **50 delivered, PASS**
funnel: raw 51 → deduped 50 → relevant 51 → enriched 50 → qualified 50 → **delivered 50**; TARGET_REACHED; ledger `unaccounted: 0`.
Proves the delivery machinery works end-to-end (understand → discover → relevant → enrich → qualify → deliver → UI). Supply was stored-corpus (local businesses DB) — the browser-live conversion criterion is judged on PC3/PC2.

## PC3 — "Find 5 local businesses in Calgary with a public phone number and website." → 0 delivered, HONEST_ZERO (partially improved)
Pre-fix: 10 relevant → 10 enriched → 0 qualified, `missing: contact_or_site` ×9.
Post-contact-pass: raw 163 → deduped 154 → **relevant 5 → enriched 5 → pending_enrichment 3**, `missing: contact_or_site` ×3, ledger closed.
The relevance gate narrows correctly; the remaining weak link is **domain discovery**: the slug-guess probe (name→.com/.co/.io) rarely resolves small-business sites, so the new /contact pass rarely triggers. Next: Pass 4 contact search queries ("<Name> Calgary contact") and discovered-link navigation (per the PRD's contact discovery order).

## PC2 — "Find SaaS companies currently hiring Account Executives in Toronto." → 0 delivered, HONEST_ZERO (signal)
raw 2 → 1 → relevant 0 → `UNPROVEN_CRITERION`. The loss is ACQUISITION WIDTH for signal queries — the query family for hiring-signal discovery produced ~2 candidates. Next: signal query families (PRD §13) in the widening ladder.

## Funnel conversion (PRD §16) — PC1 as the healthy reference
discovered 51 → parsed 51 → deduped 50 → relevant 51 → enriched 50 → qualified 50 → delivered 50 (100% conversion once candidates carry the required evidence — the machinery is proven; the gap is candidate SUPPLY for live queries, i.e. domain/contact discovery and signal query width).

## Phase B verification run (2026-10-03, second PC3 rerun) — NEW FINDING: acquisition variance
- Same query, same code: raw **349** (was 163) → deduped 203 → **relevant 0** (was 5) → settled=false at 687s.
- The live acquisition crop (OSM + browser mix) varies run-to-run; this run's pool missed the stored Calgary rows entirely and died at the category gate.
- Implication: before tuning domain discovery further, the ACQUISITION layer needs determinism/coverage work — the funnel variance (163→349 raw, 5→0 relevant) dominates the domain-discovery yield question.
- Phase B status: the query builder already emits `"<name>" <location> official website` / `"<name>" contact` shapes when candidate.missing fires (source-plan.ts:497); verification of their live effect is blocked by this acquisition variance — stabilize acquisition sampling first.
- Ledger: unaccounted 0 (conservation holds).

## Session close (2026-10-03) — Failure A/B fixed; deterministic extraction rebuild queued
- Failure A (premature zero): FIXED — root cause was the per-turn zero card (discover.tsx:2213) lacking a run-settled guard; b525473 gates it on runInFlight.
- Failure B (unexplained CANCELLED): FIXED — root cause was worker-browser close() classifying by the bare aborted boolean (worker-browser.server.ts:210); 22e2de4 attributes by abort reason (only SEARCH_CANCELLED cancels).
- Phase 1 (deterministic local-entity extraction): implementation attempted in-browser-live.server.ts but the scripted edits escape-corrupted the file twice; browser-live.server.ts was reverted to HEAD (efff08d state — Phase B intact). The five directive fixtures are preserved as skipped tests (deterministic-extraction.test.ts, 4b21039) with the full intended implementation spec in SEARCH_EXECUTION_MAP.md + this session's probe outputs. NEXT SESSION: rebuild deterministicLocalEntities by writing it with the Write tool (never scripted heredocs — they corrupt \s/\n/\b escapes), wire into observedFallback's business branch, unskip the fixtures.
- Failure B follow-up: session.server.ts:126 and scrapy-browser.server.ts still classify by bare booleans.

## Holdout finding (2026-10-03, universal directive §55) — semantic category gap
Universal business query families landed (6 category-derived variants, pass cap raised to the planner bound). Holdout reruns of HVAC Toronto + Cebu photographers: **every browser query EXTRACTION_EMPTY (ent=0)** while SERPs succeeded (10 links each) and pages were navigated.
Root cause (code-level): `deterministicLocalEntities.hasTrade()` matches the user's literal category tokens ("hvac", "wedding photographer") against page text. The reached pages describe the trade with SYNONYMS ("heating and cooling", "air conditioning") — literal-token matching rejects real matches. Exactly the gap PRD §12/§19 predicted.
Next fix: hasTrade must accept semantic trade evidence — spec-category token OR trade-family membership (the TRADE_FAMILIES map from 6bf6d31 covers solar/construction/photography/freight/plumbing/roofing/electrical/hvac/dental — extend hasTrade to consult it) OR model-semantic classification where the deterministic layer is ambiguous. This is the single highest-leverage generalization left.
