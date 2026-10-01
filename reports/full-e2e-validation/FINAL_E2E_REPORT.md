# Scrapivo Full E2E Validation Report

## 1. Executive Summary

- **Branch:** `rc/mvp-local-testing-baseline`
- **Commit:** `2fcf028a0f56794080cf61049a35e6bc4320ac2d` (local RC snapshot commit; NOT pushed; `main` untouched at `7805e75`)
- **Dates:** Kiro phase Sep 30 21:14 – Oct 1 02:09 MDT; continuation phase Oct 1 02:42 – ~08:20 MDT
- **Environment:** Windows 10.0.26200, Node v24.19.0 / npm 11.6.0, memory-bound (15.6 GB), Docker DOWN → SearXNG unavailable the entire time, Groq `openai/gpt-oss-20b` daily quota exhausted 01:25 Oct 1. Worker `:8788` + dev app `:8080` with `SCRAPIVO_LOCAL_NO_PERSIST=true`, `SCRAPIVO_BROWSER_ADAPTER=worker`.
- **Scope:** all 36 suite cases attempted (founder 5, local-business 5, roles 5, intent 4, companies 3, investors 2, jobs 2, messy 6, cancel 3, isolation 1) + auth lifecycle + persistence flows + row-level quality inspection of every result-bearing run + automated gates start & end.

### Tally (36 live search cases, final classification each)

| Outcome | Count |
|---|---:|
| PASS | 9 |
| HONEST_ZERO | 19 |
| FAIL | 5 (P04 quality, I01 UI hang, I02 wrong delivery, M03 parse, M05 clarify trap) |
| BLOCKED | 3 (X01, X02 cancel defect; S01 clarify trap) |

- **Confirmed defects:** 7 (1 HIGH-cluster around the clarify dead-loop, 1 cancel blocker, 2 result-trust defects, 2 parser defects, 1 persistence defect)
- **Intermittent / unconfirmed:** 4 (E2E-C6, C7, C8, C15)

### Verdict

```text
NOT READY — REPRODUCIBLE BLOCKERS FOUND
```

The verdict is driven by four reproducible, user-facing core-path defects: (1) the clarify dead-loop that prevents a large fraction of zero/ambiguous queries from ever completing (E2E-C3, ~15 cases affected, REPRODUCED across 4 live sessions); (2) Stop-search being unclickable during the browsing phase (E2E-C14, 2/2 reproduced); (3) parser delivering 50 wrong rows for an intent query with the intent signal silently dropped (E2E-C11); (4) contact qualification accepting self-proving evidence, so "verified" leads do not prove their required contacts (E2E-C5). All other tested paths — auth lifecycle, worker takeover (3/3 full cycles), cancel-while-streaming, mobile, jobs, stored-corpus local searches, save-lead persistence — behaved correctly, and honest zeros were correctly classified server-side 19/20 times.

## 2. Environment

| Item | Value |
|---|---|
| OS / shell | Windows 10.0.26200, Git Bash |
| Node / npm | v24.19.0 / 11.6.0 |
| Memory | 15.6 GB machine, memory-bound; build requires 4 GB heap flag; errno=1455 = Windows commit-limit (environment, not code) |
| SearXNG | DOWN all sessions (Docker daemon not running) → discovery via in-browser DuckDuckGo/Bing/OSM + stored corpora; `sourceHealth` reported degraded all runs |
| LLM providers | Groq `openai/gpt-oss-20b` daily quota exhausted 01:25 Oct 1 → provider-ladder fallbacks; clarify rounds sometimes ~60-100 s |
| Worker | `npm run worker:local` → loopback :8788, visible Chromium; `research_worker_started` clean both sessions |
| App | `SCRAPIVO_LOCAL_NO_PERSIST=true SCRAPIVO_BROWSER_ADAPTER=worker npm run dev -- --port 8080` (Vite 7.3.2) |
| Auth method | Authorized demo account; credentials resolved by `tools/qa-auth.mts` (env `QA_EMAIL`/`QA_PASSWORD`, else literals from `e2e/ship-it.spec.ts`); Playwright storageState `.auth/qa-demo.json` (gitignored). No secret value ever printed/committed |
| Git snapshot | `rc/mvp-local-testing-baseline` @ `2fcf028`; worktree clean of product changes during testing (only QA harness files under `reports/full-e2e-validation/` were modified) |

## 3. Automated Gate Results

| Gate | Start (Sep 30 21:18) | End (Oct 1 02:06, Kiro) | End (Oct 1 ~08:20, continuation) |
|---|---|---|---|
| vitest (`tools/vt.mjs --maxWorkers=2`) | — | 1568 total / 1498 pass / 55 fail (all KNOWN_RED) / **0 new** | **total=1568 passed=1498 failed=55 skipped=15 knownRedHit=55 NEW_FAILURES=0** (logs/vt-end2.txt) — zero drift |
| typecheck | — | 43 errors = frozen baseline | not re-run (no product change) |
| build (4 GB heap) | FAILED errno=1455 (OOM, environment) | exit 0 (209 s) | not re-run (no product change) |
| bundle scan | — | clean: 69 files, 0 pattern hits, 29 secret values checked, 0 found | not re-run (no product change) |

The metric that matters — **regression vs the frozen RC baseline — is ZERO.**

## 4. Authentication Results — PASS

- Valid demo login → `/discover` ✓; authenticated shell (composer + nav) ✓; profile identity ✓ (Kiro's auth suite 15/17, both fails passed in retry; continuation refresh 3/3).
- Session survives refresh, navigation, and separate contexts ✓.
- Logout ✓ (redirect to /auth); protected content unavailable after logout ✓; re-login ✓; `.auth/qa-demo.json` restored ✓ (`evidence/auth-lifecycle.json`).
- **Wrong-password feedback: silent.** One intentionally wrong attempt: stays on /auth, no error element/toast 7 s after submit (`ui/auth-wrong-password.jpg`), no internal leakage. E2E-C15 (MEDIUM, single attempt by design).

## 5. Live Search Coverage

Full per-case table: `RUN_MATRIX.md`. Summary by category (outcome counts from §1):

- **Founder/person (5):** P04 FAIL-quality (2 delivered founders but required contacts unproven), P01/P02/P03 HONEST_ZERO, P05 HONEST_ZERO. P02 mobile ✓, P03 takeover ✓.
- **Local business (5):** L03 50 delivered (2/12 sampled FP: union hall, bath retailer), L02 50 delivered mobile ✓, L05 1 delivered live-OSM (phone verified) with streamed-drop issue, L01/L04 HONEST_ZERO.
- **Roles (5):** R01 1 delivered (Upwork-sourced, takeover full cycle), R02 1 delivered (correct fractional CMO), R03/R04/R05 HONEST_ZERO.
- **Intent (4):** I01 server-honest-zero but UI clarify hang (FAIL), I02 **FAIL** (50 wrong rows), I03/I04 HONEST_ZERO.
- **Companies (3):** C01/C02/C03 HONEST_ZERO (C01 includes a size criterion parsed correctly).
- **Investors (2):** V01/V02 HONEST_ZERO, both settled cleanly.
- **Jobs (2):** J01 **PASS** — 4 real job postings (employer + hiring-signal evidence from himalayas.app; genuine non-identity evidence, the only category producing it); J02 HONEST_ZERO.
- **Messy (6):** M01 parse excellent (role+industry+location+"sales help"+prefer_email from sloppy input), M02 41 Portland dentists delivered, M06 4 delivered (historic town-parse bug stays fixed), M03 **FAIL** (location="worldwide building fintech"), M04 HONEST_ZERO, M05 **FAIL** (clarify trap, ×2).
- **Cancel (3) + isolation (1):** X03 PASS (streaming), X01/X02 BLOCKED (browsing), S01 BLOCKED.

Minimum live coverage from PRD §34 met (5 founder, 5 local, 5 roles ≥4, 4 intent ≥3, 3 company, 2 investor, 2 job, 6 messy ≥5).

## 6. Query Understanding

- **Correct parses (majority):** including every messy input except M03/M05; typo-free strict location handling worked; M01's five-part sloppy query parsed perfectly.
- **Corrected typos:** none exercised beyond RC baseline (no new typo queries were needed; RC stress battery 100/100 stands).
- **Reproducible parser defects:**
  - E2E-C13: "find startup founders worldwide building fintech" → `location="worldwide building fintech"` (deterministic; same class as the RC-fixed "public contact details"-as-town bug).
  - E2E-C11: "Founders complaining about lead generation" → intent signal dropped entirely (`signalRequired:false`) while I01's equivalent phrasing parsed `signal_required:true` — inconsistent intent handling.
  - Minor: M04's soft "email" preference dropped (LOW).
- **Unstable parses:** none observed beyond the above (clarify-loop behavior is a runtime defect, not parse).

## 7. Discovery / Browser Runtime

- Worker requested AND used in 20+ live runs (`[browser-live] … used: worker`); no unexplained `playwright` fallbacks. 2 worker sessions started/killed cleanly.
- **Takeover 3/3 PASS** (P01, P03, R01): Take control → "Scrapy is paused" → scroll → Give control back → agent continues (R01: pages 8→8, no error, search completed) → Close browser ✓.
- **Cancel:** streaming-phase ✓ (X03: stop ≤30 s, zero post-cancel rows, coherent zero screen, next query clean). **Browsing-phase ✗ 2/2** (E2E-C14: Stop click times out 45 s).
- Retained-browser and close flows behaved (P01 "KEPT OPEN" session closed cleanly).
- Clarify-loop dead-lock (E2E-C3) is the dominant runtime defect: the FIRST clarify ("What are you trying to do…?") always advances; the SECOND clarify ("Which location…", "Any particular business model…", "Any particular industry…") frequently re-asks indefinitely — Skip and "Search with defaults" both fail to advance it (observed in 4 independent live sessions; ~15 of 36 cases affected to varying degrees; worst case ground 50 min in Kiro's parallel session, 20-30 min sequential).

## 8. Result Quality (row-level inspection of all result-bearing runs)

- **Category purity:** strong on stored-corpus local searches (L02 dentists 12/12 sample; L03 plumbers 10/12 — FP: union hall + bath-fixture retailer). Weak on intent: I02 delivered 0/50 intent-bearing rows (E2E-C11). L05's final gate correctly dropped a Toronto roofer from a Mississauga query — but only AFTER streaming it as verified (E2E-C10).
- **Geography:** correct everywhere inspected (Portland 503 numbers, Calgary AB, 905 Mississauga, Toronto/Ontario for R02).
- **Contact data:** L02 websites 50/50, phones 50/50; L03 phones 50/50 (emails only 1/50); L05 phone OSM-sourced + domain-matched email ✓. P04's rows FAILED the contact requirement while being marked qualified (E2E-C5).
- **Why Match:** consistently well-formed identity lines; circular for persons (restates identity); never attests to the specific required deliverable (website/phone/email/signal).
- **Evidence:** **100% tautological** — 204/204 evidence items across all result-bearing runs were `identity/identity` snippets restating the Why Match; the only genuine external evidence in the whole pass was jobs (himalayas.app hiring signals) and R01's Upwork directory page (E2E-C12). Detail panels themselves are meaningful (category/geo/contact for businesses; pipeline stages for people/jobs).
- **Provenance:** `prov=browser` maintained on live-acquired evidence; contact_page_url provenance self-referential (E2E-C5).

## 9. Honest Zero Analysis

19 HONEST_ZERO classifications; server-side honesty is a strength: every zero I inspected had a truthful funnel (candidates retrieved → rejected reasons → qualified 0) — e.g. I01: 57 retrieved, 56 rejected with `CLAIM_TYPE_MISMATCH`/`PROVISIONAL_ENTITY`, correctly refusing to deliver directory people for a seek-designer query. Weaknesses: the final zero screen shows only a generic "No verified matches found … Try broadening" without the sourceHealth disclosure or rejection stats that the server payload carries (E2E-C9 revised, LOW→MEDIUM), and 12 of the 19 zeros were reached only after clarify dead-loop breaks (E2E-C3) rather than a clean settle.

## 10. Streaming / Candidate Ledger

- P04: streamed 2 = delivered 2 ✓. L05: streamed 5 → delivered 1, ledger `streamedNotReturned` documents all 4 with reasons (`SPEC_MISMATCH`, `UNPROVEN_CRITERION`×3), `unaccounted: 0` — internally consistent, **but the UI shows no reconciliation note** (E2E-C10, HIGH).
- I01 ledger off-by-one (57 retrieved vs 56+0 accounted; claims `unaccounted: 0`) — E2E-C6 (MEDIUM candidate).
- J01: 4 streamed = 4 delivered ✓. L03/L02: 50 delivered with 0 streamed (bulk stored delivery; no streaming UX shown for stored results).

## 11. Responsive/UI

- Desktop 1366×900 ✓, mobile 390×844 touch ✓ (P02, L02, I04), m375 ✓ (L05), m360 ✓ (R03). Streaming rows, lead/business cards, detail panels, evidence expansion, mini-browser, takeover controls, zero states, chat history, modals all exercised without layout breakage. Horizontal overflow / stuck buttons: none observed.
- React console errors recurring on Discover (both Kiro's and my sessions): setState-during-render (`DiscoverPage ThinkingSteps`), duplicate keys keyed on candidate URLs, nested `<button>` hydration error — E2E-C7 (LOW/MEDIUM candidate; no user-visible malfunction observed).

## 12. Persistence Features

| Flow | Result |
|---|---|
| Save Lead (P04 click) → /saved list | ✓ listed (Kiro's earlier "not listed" did NOT reproduce — likely read-lag; E2E-C2 reclassified NOT REPRODUCED) |
| Notes/status edit → reload | ✓ persisted |
| Delete saved lead → reload | ✓ gone |
| Profile edit ("Job title / craft") | ✗ **"Settings saved" toast but value lost after reload — REPRODUCED in 2 independent sessions** (E2E-C1, MEDIUM-HIGH) |
| Projects / ICPs | create dialog opens; NOT submitted — product exposes **no delete path** (E2E-C16); creating would leave un-cleanable artifacts |
| Watch Signal | deliberately NOT created: /watches exposes no delete/disable control (E2E-C16) |

Cleanup proof: `WRITE_CLEANUP.md` — profile field restored ×2 (`restored: true`), saved lead deleted via product UI ("gone after reload"). **Zero unexplained QA artifacts.**

## 13. Security / Privacy

- Bundle scan clean (69 client files, 0 server-only/worker-route patterns, 29 secret values checked, 0 found — Oct 1 02:06, product unchanged since).
- Manual probes found no credential/token/internal-path leakage in UI text, error states, or wrong-password responses (leakCheck false).
- `.auth/` remains gitignored; no secret printed in any report; screenshots containing the account email are excluded from any commit.

## 14. Confirmed Defects

### E2E-C1 — Profile edit does not persist despite "Settings saved" toast
**Severity:** MEDIUM-HIGH **Reproducibility:** REPRODUCIBLE (2 sessions) **Subsystem:** profile/settings write-read path
**Exact action:** Settings → edit "Job title / craft" → Save → reload. **Timestamps:** Sep 30 ~00:08 (Kiro), Oct 1 07:58 (continuation, tag E2E_QA_1790866703196).
**Expected:** value persists. **Actual:** value empty after reload; toast claims success. **Reproduction:** `npx tsx reports/full-e2e-validation/tools/qa-profile-edit.mts`.
**Run 1:** not persisted. **Run 2:** not persisted (afterReload "not persisted (empty)"). **Relevant logs:** logs/profile-edit-resume.txt. **Screenshot:** ui/persist-4-profile-restored.jpg (restored state). **Likely boundary:** write path completes (toast) but read path returns stale/empty field — or write silently no-ops.

### E2E-C3 — Clarify dead-loop: second clarify question re-asks indefinitely; search never starts or zero screen never reached
**Severity:** HIGH **Reproducibility:** REPRODUCIBLE (4 sessions; ~15/36 cases affected; I01 Kiro 77-min fatal, L01 50-min grind, L01-rerun + M05 ×2 + S01 ×2 clean breaks, P05 partial) **Subsystem:** clarify conversation flow (client↔server answer round-trip on round ≥2)
**Exact queries:** "People looking for a web designer" (I01: "Which location should I focus on…?" ×6 despite `executionPlan needsLocation:false`), "HVAC companies in Toronto with phone numbers" (L01), "hvac gta phone" (M05: entity question ×3 despite "Search with defaults"), "Bakeries in Halifax…" (S01: business-model question ×3), P05 (re-asked ×3 after Skip AND "Search with defaults", eventually searched).
**Expected:** answer (or Skip) advances; zero results reach the honest-zero screen. **Actual:** same question re-renders; runner answers register but flow does not advance; UI never reaches zero screen without harness intervention; Groq-quota fallback widens the window but is not the root cause (dead-loop also occurred on 2 s cadence with fast responses).
**Run 1/2/3/4:** reproduced in all. **Evidence:** evidence/runs/{I01,L01,L04,L05,R03,R04,R05,I03,I04,C01,C03,M03,M04,M05,S01}.json clarify arrays + timeline; 16 spec-search invocations in one I01 session (dev.log) — each clarify round re-runs the server search.
**Likely boundary:** second-round clarify answer submission is accepted by UI but not by the server spec state (state mismatch), so the server returns the same question on every poll.

### E2E-C5 — Contact qualification is self-proving; "public contact" requirement waived for delivered leads
**Severity:** HIGH (false verification) **Reproducibility:** REPRODUCIBLE (structural; 2/2 delivered rows in P04)
**Exact query:** "SaaS founders with public contact details" (P04). **Expected:** email/phone/contact-page verified public contact per row. **Actual:** both rows `email:null, phone:null`, `missingFields:[]`, `disposition:"qualified"`; `contact_page_url` provenance = `{"source":"browser_observed_text","source_url":"<the value itself>"}` (URL cited as proof of itself; domains never visited per activity log); evidence = one third-party directory (capchase.com); 2 other candidates were REJECTED for the same no-contact state the delivered rows are in. **Why Match:** circular.
**Evidence:** evidence/runs/P04.response.txt (decoded), P04.json activity. **Likely boundary:** contact enrichment infers `/contact` URL from company name and marks it browser_observed without a fetch.

### E2E-C10 — Streamed "verified" leads silently dropped from final results
**Severity:** HIGH **Reproducibility:** REPRODUCIBLE (structural; 4/5 rows dropped in L05) **Subsystem:** streaming vs final-gate reconciliation UX
**Exact query:** "Roofers in Mississauga with phone numbers" (L05). **Actual:** 5 streamed (incl. a Toronto-numbered roofer for a Mississauga query); final count 1; ledger documents the 4 drops; the final screen shows NO reconciliation note (page-wide text search negative). **Expected:** PRD §24 — no silent loss. **Evidence:** evidence/runs/L05.json ledger + main.reconciliation=null. **Likely boundary:** final qualification re-filters streamed rows without a UI surface for the delta.

### E2E-C11 — Intent signal dropped by parser; 50 wrong rows delivered [FAIL]
**Severity:** HIGH **Reproducibility:** REPRODUCIBLE (deterministic spec cause) **Subsystem:** understanding/parser intent handling
**Exact query:** "Founders complaining about lead generation" (I02). **Expected:** people/posts expressing the complaint (service-signal evidence). **Actual:** spec = `role=founder, purpose=prospecting, signalRequired:false`; 50/50 delivered rows are plain founder directory contacts (0/50 sampled show any complaint evidence). Contrast I01 which parsed `signal_required:true` for equivalent intent phrasing. **Evidence:** evidence/runs/I02.json + decoded response. **Likely boundary:** intent-signal detection depends on phrasing ("looking for X" ✓, "complaining about X" ✗).

### E2E-C13 — Parser reads "worldwide building fintech" as one location [FAIL]
**Severity:** MEDIUM **Reproducibility:** REPRODUCIBLE (deterministic) **Exact query:** "find startup founders worldwide building fintech" (M03). **Actual:** `location="worldwide building fintech"`, `location_id=geo:stated:worldwide-building-fintech`. **Expected:** location=worldwide + industry=fintech. **Evidence:** evidence/runs/M03.json. **Likely boundary:** same class as the RC-fixed deliverable-as-place bug; "X building Y" span not peeled.

### E2E-C14 — Stop search unclickable during browsing phase [BLOCKER for cancel]
**Severity:** HIGH **Reproducibility:** REPRODUCIBLE (2/2, different queries) **Subsystem:** Discover Stop-search control vs mini-browser overlay
**Exact actions:** X01 "Web designers in Chicago" (cancel early), X02 "SaaS founders in Austin with public emails" (cancel browsing) — Stop button visible but `locator.click` times out at 45 s; cancel never registers; follow-up never runs. Contrast X03 (streaming phase) where cancel works ≤30 s. **Evidence:** evidence/runs/X01.json, X02.json timeline/fatal. **Likely boundary:** mini-browser panel/overlay intercepts pointer events over the Stop control (or the control is disabled while the worker session is active).

## 15. Intermittent / Unconfirmed Observations

- **E2E-C6:** I01 ledger 57 retrieved vs 56 accounted (claims unaccounted 0); 6 browser-gapfill rows lack a reject bucket. MEDIUM candidate, single run.
- **E2E-C7:** React console errors (setState-in-render, duplicate keys, nested button hydration) on every Discover session. LOW/MEDIUM, no observed user impact.
- **E2E-C8:** gapfill query quality — I01's live gapfill searched literally `"startup"`, surfacing Windows-startup-folder and pharma junk (all rejected). LOW.
- **E2E-C15:** wrong-password sign-in shows no feedback within 7 s (no leak). MEDIUM candidate, single attempt by design.
- Kiro's two auth-suite failures (shell/identity) passed on retry and twice more in continuation — transient.
- One `worker-adapter.test.ts` full-suite flake (Kiro, passed alone + 2 reruns) — pre-existing note from RC.

## 16. Environment Limitations (NOT product defects)

- SearXNG down (Docker not running) → materially reduced discovery; zeros must be judged against this.
- Groq daily quota exhausted → provider-ladder fallbacks; clarify rounds up to ~100 s; may have amplified E2E-C3's window but not its root cause.
- Memory-bound machine: 4 GB heap flag required; parallel test lanes infeasible (Kiro's 4-lane run self-destructed — browsers closed, Groq quota burned; all 4 lanes' FATAL rows were harness artifacts, superseded by sequential reruns).
- Windows commit-limit errno=1455 on default-heap build.
- The clarify dead-loop, cancel defect, and false-delivery defects above reproduce WITH these limitations present; fix-PRD should re-verify them with SearXNG up + paid LLM tier.

## 17. Data Cleanup Verification

All intentional production-backed writes cleaned with UI-verified evidence: profile field restored ×2 (`restored: true`), saved lead deleted ("gone after reload"). Projects/ICPs/Watches deliberately not created (no delete path exists — E2E-C16); read-only probes only. Search history rows are demo-account-local; `SCRAPIVO_LOCAL_NO_PERSIST=true` suppressed search-generated persistence throughout. **Zero unexplained QA artifacts.** Details: `WRITE_CLEANUP.md`.

## 18. Recommended Fix Order

1. **E2E-C3** clarify dead-loop (blocks search completion across categories — biggest single win)
2. **E2E-C14** Stop-search during browsing (user control/safety)
3. **E2E-C11 + E2E-C13** parser: intent-signal detection + place-span peeling (false answers)
4. **E2E-C5 + E2E-C12 + E2E-C10** result trust: self-proving contact qualification, tautological evidence, streamed-drop reconciliation (false "verified" claims)
5. **E2E-C1** profile persistence
6. **E2E-C16** watch/project delete paths (+ then unblock Watch Signal E2E)
7. **E2E-C9** zero-screen disclosure of sourceHealth/rejections
8. **E2E-C15** wrong-password feedback; **E2E-C7** console errors; **E2E-C6/C8** ledger/gapfill hygiene

## 19. Exact Reproduction Commands

```powershell
# stack
npm run worker:local
$env:SCRAPIVO_LOCAL_NO_PERSIST='true'; $env:SCRAPIVO_BROWSER_ADAPTER='worker'
npm run dev -- --port 8080   # open http://localhost:8080

# single suite case (E2E-C3: try I01 or M05 or S01; E2E-C13: M03; E2E-C11: I02; E2E-C10: L05)
$env:QA_MAX_MIN='7'
npx tsx reports/full-e2e-validation/tools/qa-run.mts reports/full-e2e-validation/tools/suite.json M05

# cancel blocker (E2E-C14): watch the mini-browser phase, click Stop search — button does not respond
npx tsx reports/full-e2e-validation/tools/qa-run.mts reports/full-e2e-validation/tools/suite.json X01

# profile persistence (E2E-C1)
npx tsx reports/full-e2e-validation/tools/qa-profile-edit.mts

# auth lifecycle incl. silent wrong-password (E2E-C15)
npx tsx reports/full-e2e-validation/tools/qa-auth-lifecycle.mts

# contact self-proof (E2E-C5): inspect provenance of P04 rows
node reports/full-e2e-validation/tools/decode-rows.mjs reports/full-e2e-validation/evidence/runs/P04.response.txt

# regression gates
node reports/mvp-release-candidate/tools/vt.mjs --maxWorkers=2
$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run build
node reports/mvp-release-candidate/tools/bundle-scan.mjs
```

## 20. Final Verdict

```text
NOT READY — REPRODUCIBLE BLOCKERS FOUND
```

Core search completion (clarify flow), user control (Stop during browsing), and result trust (self-proven verification, wrong-delivery intent rows) are reproducibly broken. The foundation beneath those defects is sound — clean gates with zero regression, working worker/takeover/streaming-cancel/mobile/jobs paths, honest server-side zero funnels, and clean persistence for saved leads — which is why the fix list in §18 is short and specific rather than a rebuild.
