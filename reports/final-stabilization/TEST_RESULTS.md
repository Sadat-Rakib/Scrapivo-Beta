# TEST_RESULTS — final stabilization

Branch `rc/mvp-local-testing-baseline` · baseline HEAD `d10892d` · verdict: PENDING (gates in progress)

## Focused suites (all run locally, Windows)

| Suite | Result |
|---|---|
| thin-ask + entity-clarifier + jobs-spec-questions (C3 contract) | 36/36 pass (forced-thin contract updated to honest-zero) |
| m7-source-routing (C8 query planner) | pass |
| phase1-acceptance + browser-live-fallback + activity-presenter | 25/25 pass |
| candidate-survival + discovery set | 61/61 pass |
| browser-research pacing + acquisition-policy + research-agent (run budget) | 50/50 pass |
| scrapy-challenge (Workstream F state machine) | 4/4 pass |
| scrapy-browser component (banner/give-back/poll) | 8/8 pass |
| browser-policy (navigation policy + domain health) | 7/7 pass |
| serp-triage (Workstream G scoring) | 4/4 pass |
| domain-pacer (Retry-After, cap fail-fast, hard-block, valve) | 8/8 pass |
| src/components (C7 key/button fixes + profile/auth) | 12/12 pass |

## Typecheck
- 43 errors — EQUAL to frozen baseline (zero new; challenge projection + fixture updated).

## Pending gates
- Full vitest (`node reports/mvp-release-candidate/tools/vt.mjs --maxWorkers=2`) — target: 55 KNOWN_RED unchanged, NEW_FAILURES=0
- Build (`NODE_OPTIONS='--max-old-space-size=4096' npm run build`)
- Bundle scan
- Understanding stress corpus + adversarial battery (after PARSER lands)
- E2E defect matrix: X01 X02 (Stop), M05 S01 I01 (clarify), I02 (signal), M03 (place), P04 (contact), L05 (streaming), C16 lifecycle + cleanup
- Auth lifecycle (C15) + profile edit (C1) repro scripts
- Mobile widths 390/375/360 (Stop, clarify, mini-browser, challenge handoff, zero state)
- Production QA writes cleaned via lifecycle controls

## NEXT EXACT ACTION
Await PARSER (C11/C13) + CONTACT (C5) workers → relaunch LEDGER + C16 → wire policy/triage into browser-live → full gates.
