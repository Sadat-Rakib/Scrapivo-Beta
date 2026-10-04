# SCRAPIVO MVP RECOVERY STATUS

Branch `rc/mvp-local-testing-baseline` · HEAD `a70d148` · local MVP, no push · Oct 2, 2026
Evidence base: `reports/full-e2e-validation/` (DEFECTS.md FINAL STATUS table, FINAL_STATUS.md, RUN_MATRIX.md, evidence/runs/*.json), `reports/final-stabilization/{DEFECT_STATUS,TEST_RESULTS}.md`, `reports/beta-reality/`, `reports/mvp-release-candidate/FINAL_STATUS.md`, `reports/mvp-recovery/{PIPELINE_MAP,ROOT_CAUSE_REPORT}.md`.

---

## ROOT CAUSES

### BUG-01 — Premature zero-results banner

- **ROOT CAUSE:** Tier failures and run-budget aborts finalized as `NO_QUALIFIED_RESULTS` (indistinguishable from honest empty), and the client rendered zero chrome on non-terminal payloads (thin-ask rides, "more verified leads" promise at 0 rows). Detail: `reports/mvp-recovery/ROOT_CAUSE_REPORT.md` Q1.
- **FIX:** Adaptive run budget `29cab9e`; zero-outcome honesty + thin-ask force guard + zero chrome `f9c83eb`; funnel booking + rowStatus to UI `e22d44f`; ledger accounting `7bfc657`; enriched honest zero `f255750`.
- **EVIDENCE:** `reports/full-e2e-validation/DEFECTS.md` FINAL STATUS rows C3-related/C6/C9/C10; L05 ledger closes `{unaccounted: 0, ok: true}`; `reports/beta-reality/09-fixed-failures.md` (premature-run-death row).
- **STATUS: PASS**

### BUG-02 — Clarification after searching

- **ROOT CAUSE:** Clarify was outcome-attached (thin-ask re-attached to identical zero results) and clarify state reset every HTTP round; `force` ignored in unresolved/scope/relation branches → dead-loop. Detail: `ROOT_CAUSE_REPORT.md` Q2.
- **FIX:** State machine `ec85bb9`; answers close their questions `01d2b68`; force/amount contract + thin-ask-on-outcome chrome `f9c83eb`. Clarify now decided strictly before retrieval (`src/lib/spec-search.functions.ts:1256-1270`).
- **EVIDENCE:** spec-clarification 6/6; reruns M05/S01/I01/R03 `clarifyRepeats=0`, all settle (`reports/full-e2e-validation/DEFECTS.md` FINAL STATUS row E2E-C3); `reports/final-stabilization/DEFECT_STATUS.md` row C3.
- **STATUS: PASS**

### BUG-03 — Run stops at ~29–30 s

- **ROOT CAUSE:** Stored-path deadline stack (understanding 12 s + hot-index 4 s + 15 s S3 scan deadline ≈ the observed wall) finalized instead of continuing to live discovery; timeouts misreported as honest zeros. Detail: `ROOT_CAUSE_REPORT.md` Q3.
- **FIX:** S3 tier 15 s → 60 s (`c60b925`); adaptive run budget `29cab9e`; deadline finalizes accumulated candidates `f9c83eb`; browser deadline hands back researched candidates (`src/lib/search/browser-live.server.ts:1439-1461`). Current acceptance runs last 240–600 s with no 30 s cap remaining on the live path.
- **EVIDENCE:** `reports/beta-reality/09-fixed-failures.md`; E2E matrix runs all settle to outcomes; `reports/core-forensic/13-fix-priority.md:232`.
- **STATUS: PASS**

### BUG-04 — Browser candidates discovered but not delivered

- **ROOT CAUSE:** Losses were post-extraction: merge drops with no ledger entry, entity_id re-mint stranding streamed rows, streamed-"verified" rows silently dropped by the strict gate, unaccounted accounting. Detail: `ROOT_CAUSE_REPORT.md` Q4.
- **FIX:** Two-stage streaming + per-row ledger trail `7bfc657`; every funnel entrant booked + rowStatus to UI `e22d44f`; absorbed fate + merge accounting + cancel seed echo `f9c83eb`.
- **EVIDENCE:** L05 streamed == delivered, ledger closes exactly (`reports/full-e2e-validation/DEFECTS.md` FINAL STATUS rows C6/C10); ledger design `src/lib/search/candidate-ledger.ts`.
- **STATUS: PASS**

### BUG-05 — Searches deliver zero/one lead (low result volume)

- **ROOT CAUSE:** (a) Extraction: OSM `;`-multi-value phone lists mangled, `contact:mobile`/`url` tags unmapped → most local businesses failed the completeness gate (`missing: contact_or_site`) — L05 forensic: the OSM pool genuinely carries 26% phones / 35% websites, and faithful extraction still lost multi-value phones. (b) Acquisition: no widening loop on the interactive path — one-shot gapfill only; widen metric overestimated delivery-readiness (pre-gate rows); the run budget had no widening reserve, so the deadline fired before the first widen pass (W1: 440 s deadline, zero passes). Detail: `ROOT_CAUSE_REPORT.md` Q5.
- **FIX:** OSM extraction (`splitOsmContactValues`, `contact:mobile`, guarded `url` fallback, first-surviving-phone) + bounded interactive widening (shared job-engine semantics, ≤3 passes, constraints never loosened, first-once streaming) + delivery-predicting widen metric + `scaledRunBudgetMs` widening reserve + first-pass 60 s floor — all in `a70d148`.
- **EVIDENCE:** **L05 live: 1 → 34 delivered** (same query, "Roofers in Mississauga with phone numbers", first verified lead at 227 s, ledger `ok: true`) — `evidence/runs/L05.json`. Unit/integration: widening.test.ts 10/10 (incl. 2-empty-pass COVERAGE_EXHAUSTED, target-reached stop, constraints-never-loosened), osm-contact-extraction 7/7. OPEN: live widen-pass engagement on queries whose initial acquisition falters — see MVP VERDICT.
- **STATUS: PARTIAL** — extraction + widening machinery landed and proven; local-business volume fixed live (34); people/company volume + widen-loop live engagement on faltering initial paths still unverified (W1 below).

### BUG-06 — Browser challenges cancel searches (no human takeover)

- **ROOT CAUSE:** Worker adapter treated any aborted signal as user cancel; page challenges had no first-class state and surfaced as empty SERPs. Detail: `ROOT_CAUSE_REPORT.md` Q7.
- **FIX:** Challenge detection feeds human takeover `21e0284`; challenge state through browser-status projection `a045f57`; worker adapter carries outcome (cancelled vs deadline vs budget).
- **EVIDENCE:** takeover 3/3 full cycles (`reports/full-e2e-validation/FINAL_E2E_REPORT.md:92`); session-manager tests (exclusive hand-off, resume from fresh snapshot).
- **STATUS: PASS** at behavior level — architectural adaptation noted: pause/resume lives at the browser-session layer ("Scrapy is paused" → give back → agent continues); there is no `PAUSED_NEEDS_USER` run-state name in `search-run` (deliberate: §43's per-source semantics beat pausing the whole run).

### BUG-07 — Question UI layout / not scrollable

- **ROOT CAUSE:** The clarify/questions panel had no bounded height of its own (long question sets overflowed the footer); Radix `DialogContent` sheets without `DialogTitle` (a11y warnings). Detail: `ROOT_CAUSE_REPORT.md` Q8.
- **FIX:** `7097bf8` sr-only titles on the three untitled sheets; `a70d148` clarify panel bounded to `max-h-[40vh] min-h-0 overflow-y-auto overscroll-contain` inside a properly flexed footer (viewport-relative — holds at 1366×768-class laptop heights).
- **EVIDENCE:** clarify-panel.test.tsx extended (long question set renders in the bounded scrollable container), green; L05 rerun 0 a11y warnings (`2d73279`).
- **STATUS: PASS**

### BUG-08 — SearXNG not used

- **ROOT CAUSE:** `SEARXNG_URL` unset or probe failed; circuit breaker opens after 2 failures; Docker down all sprint so `:8888` never reachable; ladder silently substituted. Detail: `ROOT_CAUSE_REPORT.md` Q6.
- **FIX:** SearXNG routed in the plan with per-search `SOURCE_UNAVAILABLE` diagnostics; **startup health check landed `a70d148`** (`src/browser-worker/searxng-preflight.server.ts`, worker + app wiring, one-shot log `{"event":"searxng_preflight", status, latencyMs, endpoint}` — observed live: `unhealthy, fetch failed, http://127.0.0.1:8888`).
- **EVIDENCE:** `reports/full-e2e-validation/logs/dev-live.log` (preflight line); `SEARXNG_INTEGRATION_STATUS.md` (root).
- **STATUS: PARTIAL** — wiring + health check landed and logging; the real SearXNG path end-to-end still requires Docker up (environmental).

---

## REAL SEARCH FUNNEL

| Query | asked | discovered | researched | qualified | returned | first_verified | ledger ok | verdict |
|---|---|---|---|---|---|---|---|---|
| Roofers in Mississauga with phone numbers (L05, m375) | 0 | 177 (OSM) | 177 | 34 | **34** | 227 s | ok | PASS — volume fixed by extraction fixes |
| SaaS founders with public contact details (P04, desktop) | 0 | 10 (pg/s3 + browser) | 10 | 2 | **2** | — | ok (`unaccounted: 0`) | PASS runs; run-to-run variance (latest rerun 0 — strict verification flake, see VERDICT) |
| Find 20 plumbers in Oakville with public phone numbers (W1) | 1 (business model, answered) | 0 (stored 0; live browse hit yelp bot-wall, 0 emissions) | 0 | 0 | **0** | n/a | n/a | OPEN — widen loop did not engage on this path |

Funnel stage definitions: `reports/mvp-recovery/PIPELINE_MAP.md` §5–§10; ledger accounting: `src/lib/search/candidate-ledger.ts:171-193`.

## ACCEPTANCE

- [x] Clarify decided before any retrieval; answers close their questions (BUG-02)
- [x] No premature zero: tier failures surfaced as source health, ledger closes with `unaccounted: 0` (BUG-01/04)
- [x] Deadline finalizes accumulated candidates; user cancel only discards (BUG-03)
- [x] Challenge pauses for human takeover; budget/deadline never logged as user cancel (BUG-06)
- [x] Stop button clickable during browsing; cancel leaves no post-cancel rows (C14)
- [x] Streamed "verified" == delivered (two-stage streaming, rowStatus to UI) (C10)
- [x] Contacts backed by observed contact-page evidence (C5)
- [x] Question UI scroll + a11y (bounded scrollable panel, sr-only sheet titles) (BUG-07)
- [x] Widening machinery + delivery-predicting metric + budget reserve, unit/integration-proven (BUG-05 code)
- [ ] Local-business volume: DONE live (L05 34). People/company volume at target: UNPROVEN (P04 verification variance)
- [ ] Widen-loop live engagement when the initial acquisition falters (W1) — needs SSR-observable widening logging
- [ ] SearXNG reachable end-to-end with Docker up (BUG-08) — environmental

## VALIDATION

- Full vitest 1586/1652 pass, 51 KNOWN_RED (frozen baseline), **NEW_FAILURES = 0** (`logs/vt-recovery.txt`)
- Typecheck 43 errors = frozen baseline; focused batteries 39/39 + 16/16 (`a70d148`)
- E2E defect matrix 9/9 green + mobile 390/375/360 + persistence/lifecycle proofs (`reports/final-stabilization/TEST_RESULTS.md`)
- Environmental: Docker down (SearXNG unreachable — preflight logs it), free LLM quotas exhausted → provider-ladder fallbacks; real-Chromium suites are load-flaky under parallel gates (pass in isolation)

## REAL USER QUERIES

| # | Query | Parsed spec (key fields) | Outcome | Delivered | Evidence |
|---|---|---|---|---|---|
| 1 | Roofers in Mississauga with phone numbers | local · Mississauga · phone required | COMPLETED | **34** (was 1 pre-fix) | `evidence/runs/L05.json` (485 s, first lead 227 s) |
| 2 | SaaS founders with public contact details | person · founder · contact required | COMPLETED | 2 (matrix run; latest rerun 0 — verification variance) | `evidence/runs/P04.json` |
| 3 | Find 20 plumbers in Oakville with public phone numbers | local · Oakville · phone · target 20 | NO_QUALIFIED_RESULTS | 0 | `evidence/runs/W1.json` + `evidence/acceptance-widen-suite.json` |

## MVP VERDICT

**NOT READY FOR USER LOCAL TESTING — but the mandatory reproductions moved from 0 to PARTIAL, and every remaining loss is named.**

### Mandatory reproductions (2026-10-04, post Phase 1/3 fixes, real UI)
| Query | Settled | Relevant | Delivered | Class | First loss |
|---|---|---|---|---|---|
| Find 10 HVAC companies in Toronto (website + phone) | yes 537s | 7 of 141 | **2** | PARTIAL | OSM craft=hvac pool thin (140 generic-heavy rows, `rejected_category` ×132); browser query "HVAC Toronto" EXTRACTION_EMPTY on 1 nav |
| Find 5 wedding photographers in Cebu (public contact) | yes 678s | 7 of 141 | **2** (streamed 2) | PARTIAL | 6 candidates `missing: contact_or_site` — contact pages not reached |

Both runs: ledger `unaccounted: 0`. Both delivered counts moved 0 → 2 with the deterministic extraction layer + target-aware queue + contact pass. The strict gate held throughout.

### What each Phase delivered (commits)
- Phase 1 (`1daac8e` + the deterministic layer): first-party/directory extraction without the LLM — fixtures green (rainbowfish, directory×3, HVAC, no-JSON-LD, nav-only).
- Phase 3 (`5849c74` watchdog + `645ad84` harness window): hangs eliminated — every battery run since settles.
- Phase 3 target-aware queue (this session): research pool 6 → 12..60 by strength rank — HVAC1 delivered its first 2.
- Person-card fallback (Phase 2, a9f3b16) and contact-page pass (ba5a2f1) live in the path.

### Remaining P1s (each instrumented, each with a named first loss)
1. **HVAC candidate yield:** OSM `craft=hvac` Toronto returns mostly non-HVAC rows; 132 `rejected_category` is correct gating — the gap is the SOURCE (need HVAC-specific OSM tags or browser queries that surface real HVAC sites).
2. **Cebu contact yield:** 6 photographers `missing: contact_or_site` — domain discovery resolves few small-business sites; the search-based pass (efff08d) fires only after a website_url exists — wire it to fire on `missing: website` candidates too.
3. **Browser extraction on "HVAC Toronto":** 1 page navigated, 0 entities — the deterministic layer needs the category tokens present on the page; a generic directory page yields nothing.

The broader battery and verdict re-grade continue in the next session from this instrumented state.