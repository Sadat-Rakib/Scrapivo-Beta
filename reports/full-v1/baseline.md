# Full-V1 Baseline (pre volume/UI expansion)

- **Commit**: c60b925 — "checkpoint: candidate-survival V1 baseline (funnel fixes, mobile, clarify flow verified live)"
- **Branch**: main
- **Date**: 2026-09-26

## Verified working (live UI, mobile 390×844 + headless)

| Query | Result |
|---|---|
| "Find 10 SaaS founders globally who may need help with AI automation." | 3 real founders + harvested contacts (Outshine, Waydev, Thrust Carbon) |
| "help me find plumbers" → clarify → "Austin" | 50 real plumbers (phone/email/site) |
| "React developer jobs in Toronto" | 1 real job (honest thin coverage) |
| "Find 10 plumbers in Austin with no website…" | 1 verified no-website candidate with phone |
| "asdfgh" (garbage) | entity clarify question → multi-turn → honest search |
| "what's the weather in Paris" | fast honest zero |

## Focused regression baseline

```
npx vitest --run src/lib/search/__tests__/candidate-survival.test.ts \
  src/lib/__tests__/spec-search.test.ts src/lib/search/__tests__/m8-enrichment.test.ts \
  src/lib/search/__tests__/v1-cancellation.test.ts src/lib/search/__tests__/m12-people.test.ts \
  src/lib/search/__tests__/phase1-acceptance.test.ts src/lib/search/__tests__/entity-clarifier.test.ts \
  src/lib/__tests__/spec-candidates.test.ts src/lib/search/__tests__/m1-m3-runtime.test.ts \
  src/lib/search/__tests__/m11-ui-run.test.ts
```
Last full focused run: all green (61/61 in the 4-suite subset; 137+ across 10 suites).

## Known pre-existing (not regressions)

- Typecheck errors in untracked test files (m4-entity-resolve, m9-verification, universal-audit-fills) + person-qualify.ts / verification.ts.
- Understanding isolation test failure ("to-search-spec imports the legacy parser") — pre-existing.

## Key mechanisms in place

- candidatePool funnel trace (researchable/researched/qualified) in retrievalTrace
- typed abort reasons: SEARCH_DEADLINE finalizes, user cancel discards
- in-browser no_website claim minting (structured absence + 2 exact checks)
- official-destination resolution in registry-identity adapter
- isVerified stamps opportunity before completeness
- entity clarify question for unknown-entity specs
- deadline returns browser rows instead of discarding

## IF REGRESSED

`git revert` to c60b925 or `git diff c60b925 -- <file>` to isolate.
