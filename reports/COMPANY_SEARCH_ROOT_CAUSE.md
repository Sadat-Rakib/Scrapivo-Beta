# COMPANY_SEARCH_ROOT_CAUSE

Loader: `src/lib/companies/local-file-source.ts:42-48,134-177` (2-dir resolve,
`readline` stream, `limit*4` break, token/location match, sort
`score,signal_count,name`). Sole caller `src/lib/search.functions.ts:742-751`
(hiring-only, `limit:24`). General company search never reads the file.

## Root cause

1. `companies_complete.jsonl` (239MB, 315,208 rows) gitignored → Vercel
   `findFile()=null → []`, fail-soft to web sources. Production company-DB search
   effectively off.
2. Schema unfit for lead cards: head rows dormant UK shells (`! LTD`),
   `industries:[]`, `website:null`, `one_liner:null`, uniform `confidence:74`.
3. 239MB scan infeasible in serverless regardless (timeout).
4. ZIP + duckdb + JSONL = 3 unreferenced Companies House copies.

## Fix (needs approval)

`raw/companies/` → profile → canonical company schema (SCHEMA_PROPOSALS.md) →
Parquet → registry API/index; Vercel never scans JSONL. License: OGL v3.0,
keep `registry_id` + attribution.
