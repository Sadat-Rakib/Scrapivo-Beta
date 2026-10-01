# Typecheck triage (Task 17)

Source: `reports/mvp-release-candidate/evidence/typecheck6.txt`, the latest current-tree run at triage time (43 `error TS` lines). The final run (`evidence/typecheck-final.txt`, after the last code change) has the same 43, with no file or error group above baseline.
It matches the baseline `reports/mvp-implementation/TYPECHECK_LOG.txt` modulo line numbers, so every error predates this pass.
Nothing was fixed.

## Summary

- 43 errors in 15 files.
- Test files: 35 errors in 12 files. vitest/esbuild strips types, so these have no effect on test execution or the app bundle.
- Production source: 8 errors in 3 files.
  - 5 are in an unreferenced module.
  - 3 are on the qualification path, but they are pure typing gaps or dead comparisons.
- Scripts: 0.
- **RELEASE-CRITICAL: 0.**

## Table

| File (lines) | Count | TS codes | Category | Runtime risk | Release-critical | Reason |
|---|---|---|---|---|---|---|
| `src/lib/research-agent.functions.ts` (38, 46, 51, 56, 64) | 5 | TS2345 | Experimental server fns. Nothing in `src/` (routes, components, lib) imports the module or its exports. | none | no | The handlers return `researchWorker()` with no type argument, so the type is `Promise<unknown>`. That fails TanStack Start's serializable-return check. At runtime the value is plain worker JSON, and the module is unreachable anyway. |
| `src/lib/search/person-qualify.ts` (57) | 2 | TS2367 | Production (`qualify.ts` → `evaluatePersonGates`, person qualification) | none | no | `row.kind === "company"` / `"business"` can never be true: line 47 already returned `ENTITY_TYPE_MISMATCH` for any non-person kind. The comparisons are dead code, and the `page_type === "institute"` check still works. |
| `src/lib/search/verification.ts` (537) | 1 | TS2322 | Production (claim verification via `canonical-contract.ts` / `qualified-lead.ts`) | low | no | `claim_parameters = { ...requiredParams }` can carry `undefined` values into a `Record<string, string\|number\|boolean\|null>`. Consumers use optional chaining or equality, and JSON persistence drops `undefined` keys. |
| `src/lib/search/__tests__/m9-verification.test.ts` | 6 | TS2352 | test | none | no | Evidence fixture casts are missing required props (e.g. `confidence`). |
| `src/lib/search/__tests__/m12-people.test.ts` | 5 | TS2352 | test | none | no | Evidence fixture casts are missing required props. |
| `src/lib/search/__tests__/m15-coverage-adversarial.test.ts` | 5 | TS2352 | test | none | no | Evidence fixture casts are missing required props. |
| `src/lib/search/__tests__/m14-social.test.ts` | 3 | TS2352 | test | none | no | Evidence fixture casts are missing required props. |
| `src/lib/search/__tests__/m13-jobs.test.ts` | 2 | TS2352 | test | none | no | Evidence fixture casts are missing required props. |
| `src/lib/search/__tests__/m10-persistence.test.ts` | 1 | TS2352 | test | none | no | Evidence fixture cast is missing `confidence`. |
| `src/lib/search/__tests__/candidate-survival.test.ts` | 1 | TS2352 | test | none | no | The `no_website_verification` cast has `official_site_found` as a boolean, but the type says string. |
| `src/lib/search/__tests__/m10-production-persist.test.ts` | 3 | TS2322 | test | none | no | `"job_posting"` is not a member of `EvidenceSourceType`. |
| `src/lib/search/__tests__/full-v1-additions.test.ts` | 3 | TS2353 | test | none | no | `returned` is not in the retrievalTrace parameter type the test passes to. |
| `src/lib/search/__tests__/universal-audit-fills.test.ts` | 3 | TS2339 | test | none | no | Reads `soft_duplicate` off an inferred literal type. |
| `src/lib/search/__tests__/m4-entity-resolve.test.ts` | 2 | TS2339 | test | none | no | Reads `entity_resolved` off an inferred literal type. |
| `src/lib/search/__tests__/m1-m3-runtime.test.ts` | 1 | TS2339 | test | none | no | Reads `page_type` off an inferred literal type. |

## Counts by code

TS2352 ×23, TS2345 ×5, TS2322 ×4, TS2339 ×6, TS2353 ×3, TS2367 ×2 (total 43).

## Notes

- None of the errors involves calling a possibly-undefined value or passing a wrong argument shape at runtime on a user-facing path.
- Cheapest cleanups if wanted (not done):
  - `researchWorker<Record<string, unknown>>(…)` would clear the 5 TS2345 errors.
  - Dropping the dead `row.kind` comparisons at `person-qualify.ts:57` would clear the 2 TS2367 errors.
  - Filtering `undefined` out of `requiredParams` would clear the TS2322 at `verification.ts:537`.
