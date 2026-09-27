# Product-completion baseline

- HEAD: 8981850 (feat(full-v1): volume engine, activity counts, JSON-LD extraction, metro location gate, zero-state narratives + A-L acceptance battery)
- baseline parent: c60b925
- dirty files: none at pass start
- acceptance command: npx tsx scripts/full-v1-acceptance.mts [A|B|C|D|E|F|G|H|I|J|K|L]
- focused tests: npx vitest --run src/lib/search/__tests__/candidate-survival.test.ts src/lib/__tests__/spec-search.test.ts src/lib/search/__tests__/m8-enrichment.test.ts src/lib/search/__tests__/v1-cancellation.test.ts src/lib/search/__tests__/m12-people.test.ts src/lib/search/__tests__/phase1-acceptance.test.ts src/lib/search/__tests__/entity-clarifier.test.ts src/lib/__tests__/spec-candidates.test.ts src/lib/search/__tests__/m1-m3-runtime.test.ts src/lib/search/__tests__/m11-ui-run.test.ts src/lib/search/__tests__/full-v1-additions.test.ts  (158/158)
- known working: see reports/full-v1/FINAL_STATUS.md battery A-L
