# FINAL BUILD REPORT — all stages executed, verified, tested (2026-09-08)

## Data pipeline (raw immutable throughout; zero S3 deletions; zero raw mutations)

- Stage A/A2: 88 CSVs → 87 split pairs in `C:\ScrapivoData\splits\`
  (3,930,197 rows reconciled, 0 loss; 1 dup excluded SHA-verified).
- Stage C: canonical Parquet — people 484,325 + companies 1,602,141 = 2,086,466
  rows; gate-nulls 0.00%; quality recorded; dedupe report-only.
- S3 placement 89/89 verified: `processed/people|companies/`,
  `incomplete/people|companies/` (prefix bug found + fixed, 0 bad keys remain).

## Query proof (real fetches, not mocks)

- `tools/query.py`: person/company search over Parquet (Cruz/CTO-Brazil/Global
  Healthline all return rich rows). Known: "Juan Cruz/Osalim" sample row is
  incomplete (correctly absent); fixtures must use verified-complete records.
- Businesses: 893,734-row index (austin+gb+de) — 121 plumbers Austin w/
  phones+sites; Berlin restaurants; London dentists (substring caveat:
  Londonderry matches "london" — needs token-boundary fix at full build);
  1,970 Austin landmarks junk-flagged (2.6%).
- Relevance demo: deterministic rank + grounded why_relevant, no LLM.

## App fixes (minimal, tested)

1. Investor investorType wipeout (`search.ts`): infer from title/firm/type;
   empty-dataset loud error. Regression test: 4/4 pass (vc/angel return rows).
2. Outreach dispatch (`outreach-draft.ts`): job→job templates, business→local;
   3 new regression tests pass (6/6 file).
3. Jobs/FreeHire: API alive (200, contract ok) — real bug was Jobs page never
   registering the source + "freehire" missing from ALL_JOB_SOURCE_IDS;
   both fixed + loud failure logging; 2 new wiring tests pass.

## New architecture pieces

- `src/lib/signals/types.ts` (candidate/verified/rejected lifecycle),
  `src/lib/attribution.ts` (UTM, 6/6 tests pass).

## Verification totals

- vitest full suite: **17 files / 211 tests pass**. tsc: clean (exit 0).
- Files I changed: 6 modified
  (outreach-draft + test, investors/search, jobs.functions, freehire-source,
  jobs/types) + 5 new (attribution+test, 2 regression tests, signals/types,
  tools/*). Other working-tree modifications pre-existed this session —
  untouched, uncommitted. Nothing committed or pushed.

## Known limitations / follow-ups

- Business index covers 3/91 files (full 16.3M corpus transform pending).
- London-substring matching needs token boundaries.
- Cross-file duplicates overlap (~65k people-email groups) awaiting merge policy.
- Enrichment deferred per your call; campaign engagement parked; S3 raw 13.5 GB
  local upload still separate.
