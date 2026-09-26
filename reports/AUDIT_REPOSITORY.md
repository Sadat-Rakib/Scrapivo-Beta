# AUDIT_REPOSITORY (generated 2026-09-07, read-only inspection + head-reads)

Stack: TanStack Start + Vite + Nitro preset `vercel` (`vite.config.ts:10`, `vercel.json`).
All logic in `src/lib/**/*.server.ts` + `createServerFn`; `supabase/functions/` empty.
No `src/lib/config.server.ts`; env read inline. 15 supabase migrations; isolated
`freehire/` Postgres/S3 (`hire-resumes`) unrelated to main app.

## Data files (full detail: reports/DATA_INVENTORY.csv/.md — 107 files, 13.50 GiB)

| file | size/rows | git | app use |
|---|---|---|---|
| `investors_merged.json` | 15.8MB / 8098 | YES | LIVE Investors page (`src/lib/investors/search.ts:6` static import) |
| `investors_complete.jsonl` | 1.1MB / 1252 | YES | shadow only (`local-file-source.ts:33` → unified discover) |
| `companies_complete.jsonl` | 239MB / 315,208 | ignored | hiring-only blend (`search.functions.ts:742-751`) |
| `local_businesses_*.jsonl` | 12.6GB / 91 files | ignored | DB-first locally; `[]` on Vercel → OSM fallback |
| `people_complete.jsonl` | 15KB / 27 rows stub | YES | NONE in `src/` |
| `pipeline.duckdb` 216MB, `BasicCompanyDataAsOneFile.zip` 470MB | — | ignored | NONE in `src/` (pipeline only) |
| `city_country_map.json` + `regions_manifest.json` | 22.9MB + 17KB | YES | business routing (ships to Vercel) |

## Search flows

- **Investors:** `investors.tsx:132,159-209` → `runInvestorSearch` (`investors.functions.ts:10-40`,
  limit 5000) → `runInvestorPipeline` (`search.ts:418-579`): entityType > investorType >
  checkBand > stage > sector (Groq expand) > location > query(AND); rank image >
  completeness > relevance > name; relax sector→band→stage.
- **Companies:** stream scan (`companies/local-file-source.ts`), hiring-only caller.
- **Local-business:** `local-businesses.functions.ts:133-437` file-first (DB_FIRST_MIN=12) →
  OSM → Places; `businesses-file-source.ts:330` score 30+40craft+20kw+phone/site/mail/addr+city+conf.
- **Personalization:** deterministic `outreach-draft.ts` (no LLM); 360 LLM
  `outreach.functions.ts:43 → entity-draft.server.ts`; research
  `run-research.server.ts → generateOutreach`; clarifier `clarify-ai.functions.ts +
  question-generator.server.ts`; relevance `scoring.ts`, `intent-lexicon.ts`,
  `card-adapters.ts:generateRelevantBecause`.

## Deployment

`vercel.json` has no `includeFiles/serverAssets` → Vercel lacks all gitignored data;
`process.cwd()` = `/var/task/.output/server`. Serverless size/timeout vs 13.5GB makes
JSONL-per-query infeasible. Secrets scattered (`VITE_*`, `MY_SUPABASE_*`,
`SEARXNG_URL` localhost-dead-on-Vercel, `SERPAPI/SERPER/TAVILY`, `GROQ_API_KEY` single).
No `DATABASE_URL`/`S3_BUCKET` in `src/`.

## Root causes (full: reports/*_ROOT_CAUSE.md, PERSONALIZED_QUESTION_AUDIT.md)

1. Investors: live page uses dirty merged bundle; clean JSONL orphaned; schema drift
   (`entity_type/investor_type`, `sweet_spot`, `investment_categories` missing) silently
   wipes filtered results; single-dir fs resolve + silent `[]` on Vercel; Groq latency.
2. Companies: file never deploys; only hiring path reads it; registry rows unfit for
   lead cards (dormant shells, null websites).
3. Local-business: 12.6GB never deploys; `sources` label hides absence; >80MB files
   stream-scan vs 55s race; Overture noise needs craft/junk gates.
4. Personalization P0: dead dispatch `outreach-draft.ts:322-341` (`jobEmail` unreachable,
   missing/`business` vertical → investor pitch); 4 mismatched vertical enums; forced
   `person→investor`; `thesisBits` delimiter mismatch; hook-rewrite fake-specificity.

## Licenses (verified via live docs 2026-09-07)

- Overture places: **CDLA-Permissive-2.0** (commercial OK), OSM-derived subset **ODbL-1.0**;
  keep `source/evidence`, show attribution (`Overture Maps Foundation, overturemaps.org`
  + `© OpenStreetMap contributors` where applicable).
- Companies House bulk: **OGL v3.0 / CC-BY** (commercial OK with attribution); keep
  `registry_id`, link find-and-update service.

## Target architecture (locked plan v3)

S3 `raw/ → profile → schema/category proposal → YOU APPROVE → DuckDB/Python →
processed/ | incomplete/ → search/index | enrichment → Scrapivo → relevance`.
S3 layout `raw|processed|incomplete/{investors,companies,local-businesses,people,other}/`
+ `reports/ + exports/` (200-row samples only). Quality score
email30/phone25/website25/linkedin20 with validity checks + component columns.
Mapping decisions persisted in `reports/mappings/*.json`.
