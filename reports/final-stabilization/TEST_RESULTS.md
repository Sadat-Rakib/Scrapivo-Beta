# TEST_RESULTS — final stabilization

Branch `rc/mvp-local-testing-baseline` · baseline HEAD `d10892d` · verdict: PENDING (gates in progress)

## Focused suites (all green unless noted)

| Suite | Result |
|---|---|
| thin-ask + entity-clarifier + jobs-spec-questions (C3 contract) | 23/23 (forced-thin contract updated to honest-zero; seniority-in-role KNOWN_RED retired) |
| m7-source-routing (C8 query planner) | pass |
| phase1-acceptance + browser-live-fallback + activity-presenter | 25/25 |
| candidate-survival + discovery set | 61/61 |
| public-contact + contact-page-evidence + first-browser-row (C5) | 10/10 (two fixtures that codified self-proving updated to the honest contract) |
| candidate-survival + public-contact (type fix re-run) | 18/18 |
| browser-research pacing + acquisition-policy + research-agent (run budget) | 50/50 |
| scrapy-challenge (Workstream F state machine) | 4/4 |
| scrapy-browser component (banner/give-back/poll) | 8/8 |
| browser-policy (navigation policy + domain health) | 7/7 |
| serp-triage (Workstream G scoring) | 4/4 |
| domain-pacer (Retry-After, cap fail-fast, hard-block, valve) | 8/8 |
| candidate-ledger + candidate-merge + browser-live streaming stages (C6/C10) | 57/57 incl. new real-core reconciliation test |
| browser-trace (lifecycle traces, modernized fixture) | 5/5 |
| discovery + triage wiring | 13/13 |
| m9 verification + m11 UI run + m6/m8/m10 theorem callers | 19 + 17 + 58 green |
| src/components (C7 key/button fixes + profile/auth) | 12/12 |
| understanding suite (C11/C13 corpus + spec-level) | 182 pass / 16 fail — all 16 verified pre-existing at d10892d (KNOWN_RED) |
| verify:understanding --deterministic | HOLDOUT/CHAOS failure sets byte-identical to baseline; TRAIN 74/88 → 86/100 |

## Gates

| Gate | Result |
|---|---|
| Typecheck | 43 errors = frozen baseline (zero new) |
| Build (`NODE_OPTIONS='--max-old-space-size=4096' npm run build`) | PASS (built in 1m27s) |
| Bundle scan | CLEAN (69 files, 0 pattern hits, 0 secrets) |
| Full vitest (vt.mjs) | PENDING (runs after C16 worker lands to avoid port/CPU collisions) |
| E2E defect matrix | PENDING |
| Mobile 390/375/360 | PENDING |

## Defect coverage by test layer (PRD §34)
- C3: unit (clarifier/thin-ask) + server core (spec-search through runSpecSearchCore) + qa-run browser matrix pending
- C5: unit (contact contract) + server core (candidate-survival, m9/m11) + delivered-row inspection via P04 pending
- C6/C10: ledger invariant tests + real-core streamed reconciliation test + browser-live streaming-stage tests
- C11/C13: corpus + spec-level semantic tests (+ deterministic grader equivalence)
- C14: cancel plumbing verified in code (registry abort reaches the run loop); X01/X02 browser rerun pending
- F (takeover): registry state-machine tests + component tests + worker takeover E2E (existing 3/3) unaffected

## NEXT EXACT ACTION
C16 worker lands → full vitest gate → dev+worker live E2E matrix → mobile → QA write cleanup → FINAL_STATUS verdict.
