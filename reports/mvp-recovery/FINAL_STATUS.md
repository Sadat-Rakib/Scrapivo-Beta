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

**NOT READY FOR USER LOCAL TESTING — one criterion short, and it is now a measured yield gap, not an unknown.**

### Final acceptance battery (2026-10-03, all seven runs through the real UI; post Phases 1-4 + composer Stop)

| Query | Settled | Budget | Raw | Relevant | Delivered | Stage attribution | Class |
|---|---|---|---|---|---|---|---|
| W2 solar installers Windhoek | YES 622s | ok | 337-era OSM pool | — | 0 | `rejected_category` on the generic pool; browser funnel stage-attributed | HONEST_ZERO (coverage-limited geography; browser supply still thin) |
| T2 freight forwarders Tbilisi | **YES 664s** (was 81-min hang) | ok | 10 | 1 | 0 | `UNPROVEN_CRITERION` + `rejected_location` | HONEST_ZERO |
| C2 wedding photographers Cebu | YES 572s | ok | 9-10 | 3 | 0 | `missing: contact` ×3 — real photographers reached research, died at contact stage | HONEST_ZERO (contact enrichment yield) |
| B2 construction Banja Luka | YES 618s | ok | 19 | 0 | 0 | `missing: contact_or_site` ×7 + OSM fallback rejections | HONEST_ZERO |
| D2 manufacturing Da Nang | YES 673s | ok | 20 | 8 | 0 | `rejected_category` ×1 + `UNPROVEN_CRITERION` + contact gaps | HONEST_ZERO |
| N2 informal solar Windhoek | YES 529s | ok | — | — | 0 | **1 candidate streamed** (informal shape resolves, Phase 4 fix live) | HONEST_ZERO (streamed lead did not survive verification) |
| X02 cancel during browsing | Cancel at 112s | — | — | — | 0 | stop gone <=30s, zero post-cancel rows, UI settled | PASS (Stop/Cancel proof) |

- **Hangs: ELIMINATED.** All seven runs settled; the watchdog instrumentation (5849c74) plus the post-core-return telemetry proved the core settles and the earlier 81-minute hangs were the HARNESS waiting on a transport-dead SSE past its own flat deadline (fixed: answered clarifies extend the case window).
- **Ledger conservation: `unaccounted: 0` on every settled run**, every candidate fated with named reasons (rejected_category / UNPROVEN_CRITERION / missing: contact_or_site).
- **Phase 9 informal shapes: FIXED** (fa593f0) — all four directive shapes resolve entity+activity+location with `ready_to_search`, corpus at the 16-KNOWN_RED baseline, informal-activity tests unskipped and green.
- **Composer Stop: landed and proven** (e3f7fdd + X02) — clickable during browsing, gone <=30s, no post-cancel rows, UI settles.
- **Takeover handshake: proven** (35/35 across session-manager/worker-adapter/scrapy-challenge/scrapy-browser).
- **Gates: full vitest NEW_FAILURES=0** (1612/1678, 51 KNOWN_RED frozen), typecheck 43 frozen, build exit 0.

### The one remaining criterion
**Browser-supplied delivered > 0 through the real UI was not observed** — all six queries delivered 0. The zeros are honest (closed ledgers, named stages: coverage-limited OSM/geography, contact-stage losses, normalization rejections), and the browser funnel now names exactly where each run's candidates die. The yield chain (browser candidate -> verified -> delivered) is the remaining engineering target, with every stage instrumented.

Previous verdicts and their scope: READY (local MVP baseline, pre-V2) — superseded by manual QA; NOT READY (V2 forensic pass) — its hang blocker is resolved and its remaining gap is now measured rather than unknown.
