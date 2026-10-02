# DEFECTS — Scrapivo Full E2E Validation

Working defect ledger. Candidates get promoted to confirmed defects only with reproduction + evidence (PRD §10, §31, §32). Severities: BLOCKER/HIGH/MEDIUM/LOW. Reproducibility: REPRODUCIBLE / INTERMITTENT / ONE-OFF / ENVIRONMENTAL / NOT A BUG.

## Confirmed defects
- E2E-C1 (profile edit not persisted, REPRODUCED ×2 sessions)
- E2E-C3 (clarify dead-loop on second clarify round — the dominant blocker, REPRODUCED across ~15 cases)
- E2E-C5 (contact qualification self-proving, structural)
- E2E-C11 (intent signal dropped by parser, delivered 50 wrong rows)
- E2E-C13 (parser reads "worldwide building fintech" as a location)
- E2E-C14 (Stop search unclickable during browsing phase, REPRODUCED ×2)

## Defect candidates

## Defect candidates

### E2E-C5 — Contact qualification is self-proving: contact_page_url cited as evidence of itself; "public contact" requirement waived for delivered leads
- Severity candidate: HIGH (false verification — the exact PRD §8.4/§21 failure mode). Reproducibility: REPRODUCIBLE (structural, seen on both P04 delivered rows).
- Subsystem: qualification / field-provenance (contact enrichment).
- Evidence (P04, run 23:41): both delivered leads (Andrew Breen/Outshine, Alex Circei/Waydev) have `email: null, phone: null` yet `missingFields: []`, `disposition: "qualified"` for a query with `require_contact=true`. `field_provenance.contact_page_url` = `{"value":"https://www.outshine.com/contact","source":"browser_observed_text","source_url":"https://www.outshine.com/contact"}` — source_url equals the value (URL proves itself); activity log never visits outshine.com/waydev.co (only capchase.com etc.). Evidence for both rows = identity excerpts from one third-party directory (capchase.com top-25 list). Double standard: "Mark Corbett"/"Pranjal Daga" were rejected MISSING_QUERY_REQUIRED for the same no-email/phone state. Why Match = circular ("Identity · Andrew Breen Founder & CEO Outshine").
- Files: evidence/runs/P04.response.txt, P04.json (activity, console), logs/runs/P04.devlog.txt.

### E2E-C3 (refined) — Clarification loop hangs on unparseable answer; asks despite executionPlan saying no location needed; no escape to zero screen
- Severity candidate: HIGH. Reproducibility: run 2 pending (I01 rerun).
- Evidence (I01): executionPlan `needsLocation:false` yet clarify `entity_location` "Which location should I focus on (city, region, or country)?" asked 6× at ~62 s cadence (t=118..428), runner answered `-> ?` each time; t=4611 TIMEOUT, browser closed by harness. Server side finished in 40.8 s with correct NO_QUALIFIED_RESULTS but payload returned the clarify instead of a zero screen.
- Related UI defect: `hasMore: true` + `moreAvailableMessage: "There are more verified leads — want to see them?"` in a payload with `qualified_count: 0` (misleading "more results" promise with zero results).
- Confound: Groq quota exhausted + SEARXNG down during run; clarify cadence suggests provider timeouts. Rerun decides.

### E2E-C13 — Parser reads "<place> building <industry>" as one location string [CONFIRMED DEFECT — REPRODUCIBLE, deterministic]
- Severity: MEDIUM. Reproducibility: REPRODUCIBLE (deterministic parser path).
- Exact query: "find startup founders worldwide building fintech" (M03). Spec: `location="worldwide building fintech"`, `location_id=geo:stated:worldwide-building-fintech`, `location_kind=stated` — "building fintech" (activity/industry phrase) glued into a fabricated place name. Correct parse: location=worldwide + industry=fintech. Search predictably returns zero.
- Evidence: evidence/runs/M03.json server.spec.criteria.
- Related (same family, different shape): the RC FINAL_STATUS already fixed "public contact details"-as-town for the deterministic parser; this variant shows the class of bug is not fully closed.

### E2E-C11 — Intent/signal requirement silently dropped by parser; query delivered 50 plain directory rows instead of intent matches [CONFIRMED DEFECT — FAIL]
- Severity: HIGH (PRD §8.2/§22: requested deliverable ignored; false delivery at scale). Reproducibility: REPRODUCIBLE (single run, but deterministic spec-level cause).
- Subsystem: understanding/parser (intent signal → criteria) for person/intent queries.
- Exact query: "Founders complaining about lead generation" (I02). Spec parsed to `role=founder, purpose=prospecting` with `signalRequired:false` — the complaint/intent signal vanished. Server delivered 50 rows from pg-index; row-level inspection: 0/50 sampled rows contain ANY complaint/intent evidence — all are plain founder contact rows (e.g. "Justin Apt — Founder & President @ Private Capital Management, LLC"), 50/50 with phone+email, US-based. The delivered result set is a false answer to the user's actual question.
- Evidence: evidence/runs/I02.json + I02.response.txt (decoded), row sample in this report §8.
- Contrast: I01 ("People looking for a web designer") DID parse `signal_required:true, signal_types:[service_request]` — parser behavior is inconsistent across intent phrasings.

### E2E-C12 — Evidence system is tautological: 100% of evidence items are self-referential identity snippets
- Severity candidate: MEDIUM (undermines §8.5 evidence quality for every non-identity claim). Reproducibility: REPRODUCIBLE (204/204 evidence items across 6 result-bearing runs were `identity/identity` restating the Why Match string).
- Subsystem: evidence capture/qualification.
- Detail: no run shows an independent corroborating excerpt (no source quote proving contact ownership, category, or signal). Detail-panel "Evidence" = the identity line. Combined with E2E-C5 (contact_page_url self-proving), the evidence layer currently cannot distinguish verified claims from asserted ones.
- Evidence: decoded responses for L03 (53 items), L02 (51), I02 (50), R01/R02/L05 — all identity-only. File paths in RUN_MATRIX rows.

### E2E-C10 — Leads streamed as "verified while researching" silently disappear from final results with no user-visible reconciliation
- Severity candidate: HIGH (PRD §24: system must not tell the user a lead was verified then silently lose it). Reproducibility: REPRODUCIBLE (L05; streaming then post-filtering is structural).
- Subsystem: Discover UI final-results reconciliation (internal candidate ledger documents the drops; UI does not).
- Evidence (L05, "Roofers in Mississauga with phone numbers", m375, run 06:30): 5 leads streamed (Detail Roofing, D'Angelo & Sons, TORONTO ROOF REPAIRS INC., NAILED IT ROOFING, COVERALL ROOFING), final header count = 1. Ledger `streamedNotReturned`: D'Angelo & Sons `filtered(SPEC_MISMATCH)`, TORONTO ROOF REPAIRS `filtered(UNPROVEN_CRITERION)`, NAILED IT `filtered(UNPROVEN_CRITERION)`, COVERALL `filtered(UNPROVEN_CRITERION)`; `unaccounted: 0`. The runner's page-wide reconciliation-text search (patterns: "streamed … didn't", "not in the final") found NOTHING on the final screen → drops invisible to the user. Note: a Toronto phone-numbered roofer was streamed as verified for a Mississauga query before the final gate correctly dropped it (streaming-stage geography leak).

### E2E-C14 — Stop search button unclickable during the browsing phase [CONFIRMED DEFECT — REPRODUCED ×2]
- Severity: HIGH (user cannot stop a running search). Reproducibility: REPRODUCIBLE (2/2 cancel-during-browsing attempts with different queries).
- Subsystem: Discover search controls (Stop search) during active browser research / mini-browser overlay.
- Evidence: X01 ("Web designers in Chicago", cancel early) and X02 ("SaaS founders in Austin with public emails", cancel browsing) — both: Stop button visible, `locator.click: Timeout 45000ms exceeded`, cancel never registered, follow-up never ran. Contrast: X03 cancel during STREAMING works (button gone ≤30 s, no results after cancel) → the block is specific to the browsing phase (mini-browser open). 
- User impact: during the multi-minute browsing phase (the normal case for live searches), the only way to stop is apparently closing the tab.

### E2E-C16 — Watches page exposes no delete/disable control; Watch Signal cannot be tested without creating an un-cleanable production artifact
- Severity candidate: MEDIUM (product gap + QA policy blocker). Reproducibility: REPRODUCIBLE (read-only probe).
- Evidence: evidence/watch-auth-probe.json — /watches renders "Signal Watch · Click the watch. Tell it what to look for and when." with zero buttons matching delete/remove/disable/pause/turn off. Projects have the same gap (no delete path; qa-persist had to stay read-only). Deliberately did NOT create a QA watch or project (zero-unexplained-artifacts rule).
- Impact: users who create a watch/project by accident (or via the "Watch signal" button on results) have no visible way to remove it from the UI.

### E2E-C15 — Wrong-password sign-in gives NO visible error feedback (silent failure)
- Severity candidate: MEDIUM. Reproducibility: ONE-OFF / needs confirm (single attempt by design — no rate-limit risk taken).
- Evidence: evidence/auth-lifecycle.json wrongPassword (stayed on /auth, no [role=alert]/destructive/error element, no toast captured) + ui/auth-wrong-password.jpg (form unchanged, no message, 7 s after submit). No internal leakage (leakCheck false).
- Auth lifecycle otherwise PASSES: login ✓, session across refresh/nav ✓, logout ✓, protected content locked after logout ✓, re-login ✓.

### E2E-C9 (REVISED) — Zero-result screen explanation is generic; no source-health or rejection detail after settle
- Severity candidate: LOW→MEDIUM. Revision: X03's post-cancel zero screen DOES show "No verified matches found for … yet. Try broadening t…" — so an explanation exists (earlier P01 extraction missed it under the 3000-char sample cut). What is missing: the server's sourceHealth summary ("Some sources could not be searched this time (Available records, Public source)…") and any candidates-found-but-rejected counts are not shown on the final zero screen (they appear only as live-activity lines during the run). User cannot distinguish "nothing exists" from "sources failed / candidates rejected".
- Evidence: P01.json finalTextSample (0 results screen, no detail), X03.json cancel.bodyAfter (generic message present), server payload sourceHealth.summary.

### E2E-C6 — Candidate ledger off-by-one: 57 retrieved, 56 rejected, 0 returned, yet `unaccounted: 0`; 6 browser-gapfill rows have no visible reject bucket
- Severity candidate: MEDIUM (reconciliation/reporting integrity, PRD §24). Evidence: I01.json server.ledger vs spec.funnel; I01.devlog.txt.

### E2E-C7 — React console errors on Discover flow (both P04 and I01)
- Severity candidate: LOW/MEDIUM. Evidence: duplicate keys keyed on candidate URL (`Encountered two children with the same key ... capchase.com/top-25-b2...` ×5), setState-during-render (DiscoverPage ThinkingSteps), nested `<button>` hydration error. Files: P04.json console, I01.json console.

### E2E-C8 — Low-quality gapfill query: "web designer" intent search gapfilled with query `startup`, surfacing junk candidates (Windows-startup-folder page, pharma CEO) before rejection
- Severity candidate: LOW (wasted budget, no user harm — all rejected). Evidence: I01.devlog.txt line 20, mini-browser stuck on intowindows.com.

### E2E-C1 — Profile edit does not persist across reload despite "Settings saved" toast
- Severity candidate: MEDIUM. Reproducibility: needs 2nd run.
- Subsystem: profile/settings persistence (Supabase write or read path).
- Evidence: Kiro `evidence/profile-edit.json` (edit → toast → reload → old value), `logs/profile-edit.txt`.
- Continuation: reproduce once more via `tools/qa-profile-edit.mts`; then classify.

### E2E-C2 — Saved lead not listed on /saved after Save Lead click
- Severity candidate: HIGH (core persistence path). Reproducibility: needs 2nd run.
- Subsystem: saved_leads write or /saved read path.
- Evidence: Kiro `evidence/persistence.json` (savedCountAtStart=0 after P04 save click), `logs/persist.txt`.
- Continuation: run save-lead flow again; check /saved immediately + after refresh; inspect dev.log for write errors; classify.

### E2E-C3 — Clarification loop hangs: same clarify question repeats unanswered, run never settles
- Severity candidate: HIGH if reproducible (blocks search completion). 
- Evidence: I01 `evidence/runs/I01.json` — clarify question "Which location should I focus on…?" repeated 6×, timeout t=4611, `Target page, context or browser has been closed`.
- Confound: lanes ran 4-parallel + Groq quota exhausted → could be provider-ladder/harness artifact. Continuation: rerun I01 ALONE sequentially (run 2 of max 2 per PRD §10); classify.

### E2E-C4 — React console errors: setState-during-render, duplicate keys, nested `<button>` hydration
- Severity candidate: LOW/MEDIUM. Evidence: Kiro dev.log / auth evidence. Continuation: capture page console on fresh runs, classify which pages emit them.

## Environmental (NOT defects)
- SearXNG :8888 unreachable (Docker down) → reduced discovery coverage; HONEST_ZERO frequent.
- Groq `openai/gpt-oss-20b` daily quota exhausted 01:25 Oct 1 → provider ladder fallbacks, slow (~60 s) clarify.
- Windows commit-limit OOM (errno=1455) on default-heap build → use 4 GB heap flag.
- Kiro's P01/L01/C01 FATAL rows + laneA/laneC `browser.newContext: Target page, context or browser has been closed`: parallel-lane harness killed browsers (Ctrl+C), not proven product behavior. Continuation reruns decide.

## FINAL STATUS (Oct 2, after final stabilization sprint) — every defect above closed

| Defect | Resolution | Evidence |
|---|---|---|
| E2E-C1 | FIXED — profile upsert + missing-row throw; sender_name written | qa-profile-edit: "QA value persisted" across reload, restored:true |
| E2E-C2 | FIXED — save/read path verified end-to-end | qa-persist 7/7: P04 lead listed on /saved, notes persist across reload, deleted via UI, 0 left |
| E2E-C3 | FIXED — dead-loop gone (all reruns settle); force still asks explicit unresolved amounts; thin-ask-on-outcome renders zero chrome | M05/S01/I01/R03 reruns: clarifyRepeats=0, settled=true; spec-clarification 6/6 |
| E2E-C3-related UI defect ("more verified leads" promise at 0 results) | FIXED — hasMore/message require delivered rows | I01/I02/R03 fresh runs: moreAvailableMessage absent, no "Show more" affordance at zero |
| E2E-C4/C7 | FIXED — nested button, keys, ThinkingSteps render-phase setState | 0 setState/duplicate-key console errors in I01/R03 reruns; thinking-steps.test.tsx |
| E2E-C5 | FIXED — contacts backed by observed contact-page excerpts | P04: waydev.co/contact + loch.io/company/contact excerpts, source_url ≠ identity source |
| E2E-C6 | FIXED — ledger closes exactly, merge-absorbed rows ledgered | L05 {retrieved:148, fated:148, unaccounted:0, ok:true}; P04 unaccounted:0 |
| E2E-C8 | FIXED — substantive gapfill queries + SERP gate starvation fallback | m7-source-routing 36/36; browser-live evidence-boundary tests green |
| E2E-C9 | FIXED — enriched zero narrative incl. mobile + thin-ask path | P02 mobile: "1 lead seen while researching isn't in this list…"; R03 reconciliation rendered |
| E2E-C10 | FIXED — two-stage streaming, per-row ledger trail, no post-cancel echoes | L05 streamed==delivered==1; worker-adapter cancel test green |
| E2E-C11 | FIXED — intent signal required and enforced | I02: signal_required true → honest zero (was 50 wrong rows) |
| E2E-C12 | PARTIAL / DEFERRED WITH REASON — claim-aware evidence beyond contact | C5 gate covers trust-critical path |
| E2E-C13 | FIXED — activity verbs stop place spans | M03: worldwide + fintech parsed, no glued place |
| E2E-C14 | FIXED — floating Stop + verified cancel plumbing | X01/X02 reruns: stop gone ≤30s, no post-cancel rows |
| E2E-C15 | FIXED — inline wrong-password error | qa-auth-lifecycle: wrong_password_error_useful true |
| E2E-C16 | FIXED — project/ICP/list deletes wired; watch pause + delete | live probe: create→Pause→delete→gone after reload; qa-persist watches dialog shows Pause/Run |

Verdict: **READY (local MVP baseline)** — see FINAL_STATUS.md. Remaining known limits are environmental (SearXNG down, LLM quotas) or the C12 deferral above.
