# Test report

## Newest stable results

- Broad suite command passed: `rtk npm run test -- src/lib/search src/lib/understanding src/lib/signals src/lib/__tests__/outreach-draft.test.ts src/lib/__tests__/spec-search.deadline.test.ts src/lib/jobs/__tests__/job-engine.test.ts src/lib/jobs/__tests__/search-jobs-store.test.ts --testTimeout=20000`.
- Broad result: exit 0, `103 passed | 1 skipped` files, `1375 passed | 4 skipped` tests, duration `22.45s`.
- Typecheck: exit 0.
- Build: exit 0 from unchanged frozen product-source gate.
- ESLint: exit 1.

## Focused proofs recorded this session


- Cache exact dedup metadata: 50 PASS.
- Unreachable lead-segments else-branch removal rule: PASS.
- Investor proof set: 53 PASS, 66 PASS, artifact 33 PASS.
- Deadline root absolute abort: 6 PASS.
- Deadline file stabilized with fake clock plus entry barrier: six assertions PASS, no weakening.
- OR location execution: 6 PASS.

## Historical duplicate validation anomaly

A duplicate broad command failed only `src/lib/__tests__/spec-search.deadline.test.ts` with 5 fixture assertions:

- `reader` not called.
- `web` not called.
- `browser` not called.
- previously qualified rows array stayed empty.
- `fetch` not called.

Saved details: `reports/final-validation-2026-10-09/deadline-failure-errors.txt`.

Current attribution: superseded by the stable gate. Earlier failure matched cold module / fake-clock entry timing where the <=300ms fixture window did not enter expected stages.

## Pending proof

- Actual 10/50/100 production breadth.
- Real Postgres resume/cancel; existing proof is fake-only.
- Q5/Q11 live results from live agent.






