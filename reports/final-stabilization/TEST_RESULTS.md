# TEST_RESULTS — final stabilization

Branch `rc/mvp-local-testing-baseline` · baseline HEAD `d10892d` · verdict: **DONE — all gates green**

## Focused suites (all green unless noted)

| Suite | Result |
|---|---|
| thin-ask + entity-clarifier + jobs-spec-questions (C3 contract) | 23/23 (forced-thin contract updated to honest-zero; seniority-in-role KNOWN_RED retired) |
| spec-clarification (incl. force does not bypass explicit unresolved amounts) | 6/6 |
| m7-source-routing (C8 query planner) | pass (36/36) |
| phase1-acceptance + browser-live-fallback + activity-presenter | 25/25 |
| candidate-survival + discovery set | 61/61 |
| public-contact + contact-page-evidence + first-browser-row (C5) | 10/10 |
| browser-research pacing + acquisition-policy + research-agent (run budget) | 50/50 |
| scrapy-challenge (Workstream F state machine) | 4/4 |
| scrapy-browser component (banner/give-back/poll) | 8/8 |
| browser-policy (navigation policy + domain health) | 7/7 |
| serp-triage (Workstream G scoring) | 4/4 |
| domain-pacer (Retry-After, cap fail-fast, hard-block, valve) | 8/8 |
| candidate-ledger + candidate-merge + browser-live streaming stages (C6/C10) | 57/57 + new absorbed/merge-funnel tests (duplicates absorbed by a merge stay ledger-visible) |
| serp-discovery (gate starvation fallback, candidate split) | 5/5 |
| pagination (hasMore/message require delivered rows) | 8/8 (2 baseline-red fixtures repaired — 3 known-reds retired) |
| thinking-steps (render-phase onDone regression) | 6/6 (new component test) |
| browser-trace (lifecycle traces, modernized fixture) | 5/5 |
| discovery + triage wiring | 13/13 |
| m9 verification + m11 UI run + m6/m8/m10 theorem callers | 19 + 17 + 58 green |
| src/components (C7 key/button fixes + profile/auth) | 12/12 |
| understanding suite (C11/C13 corpus + spec-level) | 182 pass / 16 fail — all 16 verified pre-existing at d10892d (KNOWN_RED) |
| verify:understanding --deterministic | HOLDOUT/CHAOS failure sets byte-identical to baseline; TRAIN 74/88 → 86/100 |

## Gates

| Gate | Result |
|---|---|
| Full vitest (vt.mjs, `--maxWorkers=2`) | total=1630 passed=1564 failed=51 skipped=15 files=166 · knownRedHit=51 · **NEW_FAILURES=0** (known-red 54→51: pagination fixture repair retired 3; foreign `Cotly/` project excluded from the sweep) |
| Typecheck | 43 errors = frozen baseline, zero groups above (byte-identical list) |
| Build (`NODE_OPTIONS='--max-old-space-size=4096' npm run build`) | PASS |
| Bundle scan | CLEAN (69 files, 0 pattern hits, 0 secrets) |
| E2E defect matrix (qa-run) | **9/9 rerun cases green** — M03 PASS (parse fixed, honest zero), M05/S01 PASS (clarifyRepeats 0, settled), I01 PASS after fix (zero screen, no more-promise, console clean), I02 PASS (signal_required enforced, honest zero instead of 50 wrong rows), P04 PASS (C5: observed contact-page excerpts, 2 delivered, ledger closes), L05 PASS (C10/C6: streamed==delivered==1, unaccounted:0), P02 PASS (mobile 390 enriched zero), R03 PASS after fix (m360 zero screen + reconciliation) |
| Mobile 390/375/360 | PASS — P02 (390×844 touch), L05 (m375), R03 (m360) all settled with honest outcomes |
| Persistence proofs | qa-profile-edit: edit persists across reload, restored ✓ · qa-auth-lifecycle: wrong-password error useful, full lifecycle ✓ · qa-persist 7/7: saved lead listed, notes persist across reload, deleted via UI, 0 left ✓ |
| Watch lifecycle (C16) | live probe: create → Pause toggled → delete → gone after reload ✓ |

## Defect coverage by test layer (PRD §34)
- C3: unit (clarifier/thin-ask/force-amount) + server core (runSpecSearchCore) + qa-run M05/S01/I01/R03 green
- C5: unit (contact contract) + delivered-row inspection P04 green (observed excerpts, no self-proof)
- C6/C10: ledger invariant tests + real-core streamed reconciliation + browser-live streaming-stage tests + L05/P04 ledger closes unaccounted:0
- C11/C13: corpus + spec-level semantic tests + I02/M03 live confirmations
- C14: X01/X02 browser reruns green (cancel telemetry)
- C16: live watch lifecycle probe + delete UI callers + qa-persist

## Environmental (not defects)
- Docker down → SearXNG :8888 unreachable → degraded source health, HONEST_ZERO frequent.
- Free LLM quotas exhausted earlier on Oct 1 → provider-ladder fallbacks, slow clarify.
- Windows commit-limit OOM (errno=1455) on default-heap build → 4 GB heap flag.
