# FINAL OVERNIGHT MVP REPORT — 2026-10-04

## A. FINAL VERDICT
**NOT MVP READY**
Investor demo: **NO**

The pipeline now converts discovery → candidates → relevance → enrichment for live queries without the extraction LLM, and PC1/PC3 prove full delivery when contact evidence exists. The remaining gap is contact-research yield on candidates whose official domain is not yet discovered, plus signal-acquisition width. Both are instrumented; neither is a mystery.

## B. STARTING STATE
- Branch `rc/mvp-local-testing-baseline`, session start `08772bb`, final commit `git log -1` at close.
- Known failures at start: premature zero (fixed), unexplained CANCELLED (fixed), page→candidate loss (fixed for first-party + directory archetypes), contact yield (partially improved, still the bottleneck).

## C. WHAT WORKS NOW (real-UI evidence)
| Path | Evidence |
|---|---|
| Understand → spec (clean + informal do-verb shapes) | fa593f0; informal-activity tests green; N2 resolves entity+activity |
| Stored discovery → relevance → enrichment → qualification → delivery | PC1: 50 delivered, TARGET_REACHED, ledger closed |
| Browser-supplied discovery → domain discovery → contact pass → delivery | PC3: 3 delivered with first-party domains (saucal.com, bristolwindowcleaning.ca) |
| Deterministic extraction without the LLM | e6d0193 + Phase 1 fixtures: first-party, directory×N, HVAC, no-markup, nav-only |
| Semantic trade matching (synonyms) | aaa91a3: "heating and cooling" matches "HVAC" |
| Person-card normalization | ea17542: subject-bound role = person evidence |
| Cebu extraction → normalization → candidates (LLM-free) | 10 extracted → 10 normalized (0 rejections) → 6 emitted → 2 relevant (HO2 evidence) |
| Target-aware research queue | d5a5bd5: pool 12..60 by requested count (was flat 6) |
| Premature-zero guard | b525473 + 40af70e: both zero render sites gated on runInFlight |
| Cancellation attribution | 22e2de4 + 33b2e91: deadline/stale ≠ user cancel |
| Watchdog + stage telemetry | 5849c74: a hung stage names itself |
| Stop during browsing | X02: stop at 112s, gone ≤30s, no post-cancel rows |
| Universal business query families | 6 category-derived variants, no trade vocabulary |

## D. REMAINING P1 GAPS (exact first-loss boundaries)
1. **Contact-research trigger inversion for website-less candidates:** the /contact-page research requires `candidate.row.website_url` to exist; candidates missing a website need domain discovery FIRST (efff08d's search-based pass exists but the research loop's `visitedUrls ≥ 4` / `attempts ≥ 2` window often closes before it runs for directory-sourced candidates). Location: browser-live.server.ts research loop + probeFirstPartyDomains. Fix shape: when a relevant candidate is missing website AND contact, schedule domain discovery as the candidate's research query (the query builder already emits `"<name>" <location> contact` shapes — wire the need flag).
2. **Contact-semantics → needs wiring:** "public contact information" must set the contact need in computeResearchNeeds so the research loop schedules contact research for every candidate missing it (source-plan.ts / completeness.ts).
3. **Signal-acquisition width (PC2):** hiring-signal queries produce ~2 raw candidates — signal query families (careers/ATS/job-board shapes) must join the widening ladder for signal_required specs.
4. **HVAC Toronto 2/10:** OSM craft=hvac Toronto is generic-heavy (132 `rejected_category` — correct gating); browser query "HVAC Toronto" hit EXTRACTION_EMPTY on the visited page. The universal business query families (landed this session) widen this to 6 variants — needs one live rerun to measure.
5. **Research Computer runtime (§41-47):** not started — the existing browser card + takeover path covers watch/take-over/return; the isolated-desktop runtime is a separate build.

## E. RUN CLASSIFICATION (latest battery + reproductions)
- PASS: PC1 (50/50), PC3 (3/5 = PARTIAL by count but first browser-supplied delivery — classified PARTIAL per the strict count rule)
- HONEST_ZERO→PARTIAL: HVAC1 2/10, CEBU2 2/5 (both settled, ledger closed, named losses)
- All runs: `unaccounted: 0`

## F. REGRESSION STATE
- Typecheck 43 frozen; full vitest NEW_FAILURES=0 (1612/1667 at last gate); build exit 0.
- Deterministic-extraction fixtures 5/5; widening suite 12/12; canonical 46+9 skipped green.

## G. NEXT SESSION ORDER (P0, from this exact state)
1. Wire "missing website/contact" → the query builder's domain-search shapes (set the need flag; the queries already exist).
2. Loosen the research-loop window for candidates with pending contact needs (visitedUrls/attempts budget per PRD §17).
3. Signal query families for signal_required specs (careers/ATS shapes in buildResearchPlan).
4. Live battery: Toronto HVAC (10), Cebu (5), Calgary (5) + messy inputs (§60) + unseen holdout (§61).
5. Research Computer runtime if budget remains.
