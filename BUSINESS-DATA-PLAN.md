# BUSINESS-DATA-PLAN — DB-first companies, local businesses & people for Scrapivo

> **BUILD STATUS (2026-09-06, final)**
> - ✅ freehire catalogs: workday 2→1,200 (rotating sample), ATS tenants 24→1,490, boards 220→600
> - ✅ Pipeline (`scripts/pipeline/`): pydantic schemas, normalizers, deterministic ER,
>   DuckDB store with content_hash/last_seen increments, confidence scoring
> - ✅ Companies: EDGAR 8,005 + YC 6,203 + GLEIF 1,000 + **Companies House 300,000 UK**
>   → `data/companies_complete.jsonl` (315,208 rows; CH runner auto-discovers the date-stamped
>   bulk ZIP, streams the CSV, disk-guarded — raise `--limit` for the full 5.2M)
> - ✅ Local businesses GLOBAL: tiled per-country Overture extractor (2° grid, per-tile caps,
>   country post-filter, streaming, resumable) — 90 countries across Europe/Asia/Middle East/
>   Americas/Africa/Oceania; re-extraction with raised caps (mega 2M / large 400k / medium 130k /
>   small 45k) running in background (~35/90 done at last check, ~10-13 GB final)
> - ✅ Scrapivo ingestion: region-routed file source (major-city map + manifest, LRU for small
>   files, line-streaming for mega files — V8 string cap safe), DB-first ≥25 rows in Discover
>   directory branch (live waterfall fallback), file-first Local Businesses page, opportunity
>   filter (no_website/has_phone/sales_ready) applied to DB rows, synonym map with gerund forms
>   ("plumber"→"plumbing"), extraCrafts fallback for classifier mis-picks
> - ✅ E2E fixes found by live browser testing: osm/localbiz/overture rows were dropped by the
>   quality gate (added to the directory auto-pass + boost), "0-1 years experience" leak in
>   local summaries (suppressed), coreSkill mis-picks ("web" from "no web presence")
> - ✅ People: `run_people_yc.py` harvests publicly published founders/execs + LinkedIn links
>   from YC companies' own sites (no invented names, no auth'd LinkedIn) → `people_complete.jsonl`
> - ⏳ In background: the tiled global re-extraction finishes all 90 countries on its own
>   (`python -m scripts.pipeline.run_overture_all` resumes; per-country logs in the run output)

> Researched against the actual sources/licences (numbers verified Sep 2026) and mapped to
> Scrapivo's existing architecture. The investor DB-first pattern (data/investors_complete.jsonl →
> source-router → tokenizer vertical) is the template; this plan clones it for companies,
> local businesses, and people.

> Researched against the actual sources/licences (numbers verified Sep 2026) and mapped to
> Scrapivo's existing architecture. The investor DB-first pattern (data/investors_complete.jsonl →
> source-router → tokenizer vertical) is the template; this plan clones it for companies,
> local businesses, and people.

## 0. Reality corrections to the pasted phase plan

| Pasted plan says | Reality (verified) | Decision |
|---|---|---|
| OpenCorporates as the initial primary source | Free API = **50 lookups/day, 200/month**; first paid tier **£2,250/yr for 500 calls/mo**; share-alike obligation on free tier | **Demote to enrichment/verification lookups only**. Bulk legal entities come from free bulk registries instead |
| OSM PBF + Pyrosm for local POIs | Works (pyrosm v0.13.1, maintained) but RAM-heavy (3–5× file size) and OSM POIs lack phones/websites/confidence | **Overture Maps Places instead**: ~74M POIs, CDLA-Permissive 2.0 (no share-alike), includes addresses, phones, emails, websites, socials, categories, confidence — queried per-bbox over S3 with DuckDB (no 5GB downloads). Keep PBF/pyrosm only for geometry gaps |
| Google Maps scraper as Tier 3 | Google ToS prohibits scraping (litigation risk) | Self-hosted **gosom** (MIT, Playwright, ~120 places/min, 30+ fields) — **already wired** in Scrapivo (`GOOGLE_MAPS_SCRAPER_URL`, intelligence provider registry). Targeted gap-fill only, never the backbone |
| Airflow/Celery/Splink from day 1 | Premature for one laptop | Start with plain scripts + DuckDB + content-hash increments; **Splink only when cross-source ER volume demands it**; Prefect optional later |

## 1. What Scrapivo already has (reuse, don't rebuild)

- **Live local search**: OSM Overpass → Geoapify → Foursquare waterfall + opportunity tags + email harvest + MillionVerifier (`sources.server.ts` directory branch, `local-businesses.functions.ts`).
- **gosom Google Maps adapter**: `src/lib/intelligence/providers/business/google-maps-provider.ts` (ratings/reviews — the only source that has them).
- **ATS/job-board live fan-out** (Greenhouse/Lever/Ashby/Workable/Recruitee/Workday) fed by small catalogs in `data/`.
- **Contact waterfall**: HARVEST → PEOPLE → DERIVE → VERIFY (free-first, paid last), email harvest, inline-contact extraction.
- **DB-first pattern to clone**: `data/investors_complete.jsonl` (1,252 rows) + `local-file-source.ts` + `source-router.decideSource` + `resolveSearchVertical` + tokenizer categories (`business`/`company`/`people` already detected).
- **UI already renders all three row shapes**: `LocalBusinessRow`, `CompanyRow`, `PersonRow` (tables/cards/drawer/Generate pills — built for investors, generic).

## 2. Data layer architecture (offline Python → JSONL → TS ingests)

```
scripts/pipeline/            (Python 3.12, uv, pydantic, duckdb, httpx, pyarrow)
  sources/                   one module per source (fetch, paginate, respect limits)
  normalize/                 address / phone (libphonenumber) / name normalizers (pydantic models)
  resolve/                   deterministic ER: registry_id → domain → name+address rules
  export/                    DuckDB → data/*.jsonl (the ONLY thing Scrapivo reads)
data/
  companies_complete.jsonl   phase 1 output
  local_businesses_{region}.jsonl   phase 2 output (per region)
  people_complete.jsonl      phase 4 output
```

Scrapivo ingests JSONL exactly like investors: zero new runtime deps, DB-first in `source-router`,
live fan-out stays as fallback/blend.

## 3. Build order (each phase = independently shippable JSONL)

### Phase 1 — Companies registry DB (swap OpenCorporates for free bulk)
1. **UK Companies House bulk ZIP** (5.19M live companies, free monthly snapshot: basic data + officers + PSC; no API limits) — best records-per-$0 anywhere.
2. **GLEIF daily concatenated files** (3.4M LEI records, CC0, no key) — global regulated entities with legal address + parents.
3. **SEC EDGAR** (10 req/s, company_tickers.json + submissions) — US reporting companies + officer/filing signals.
4. Normalize → canonical schema (`company_number, name, jurisdiction, status, incorporated, address_raw, address_normalized, sic_codes, domain?, source, last_seen, content_hash`) → DuckDB → `data/companies_complete.jsonl`.
5. ER: exact `company_number` per registry; cross-registry = normalized name + country + (domain when known). Splink deferred.
- Scrapivo side: `companies_complete.jsonl` becomes a DB-first source for company queries (vertical `general`/`company`), with the live web fan-out as blend.

### Phase 2 — Local businesses DB (Overture, not pyrosm)
1. `pip install overturemaps` CLI or DuckDB httpfs; extract per-target-region bboxes from `s3://overturemaps-us-west-2/release/<latest>/theme=places/` (monthly releases; only last 2 retained — archive ours).
2. Filter `confidence >= 0.6`, keep `names.primary, addresses, phones, emails, websites, socials, categories.primary, operating_status, bbox`.
3. Map to `LocalBusinessRow`-shaped JSONL: `name, category, address, phone, email, website, domain, source: "overture", opportunity_tags` (reuse the existing deriveOpportunityTags logic server-side).
4. Link to Phase-1 companies: name-normalized match + address/ postcode overlap + domain match (deterministic first; Splink later).
- Scrapivo side: local queries go **DB-first** (instant, huge, offline) with the existing live OSM/Geoapify/Foursquare waterfall as top-up/blend — `decideSource` already supports `local`.

### Phase 3 — Enrichment + confidence (Tier 3)
1. **gosom self-hosted** (Docker, `GOOGLE_MAPS_SCRAPER_URL`): targeted gap-fill for categories/regions Overture covers poorly; brings ratings/review_count. botasaurus stack noted as fallback backend only.
2. Email patterns: port **ai-outreach-engine's learned domain-pattern cache** (per-domain `first@/first.last@/flast@…`, hit-count incremented only on verified-valid) into the existing harvest waterfall; port **email-scraper's** crawl options (depth/page caps, cross-domain flag) into our harvester. Phone validation via **libphonenumber-js**.
3. **Confidence scoring** (openleads schema, code not copied — licence): `confidence 0–100` + `tier: safe|risky|bad` + `reasons[]` from source quality (registry > Overture > gosom > web-scrape) × validation results (website live, MX, email verified, phone valid). Surfaces as the existing `opportunity_tags`/`why_match` style fields.
4. OpenCorporates: optional key for 50/day verification lookups (company-number ↔ status confirmation) — enrichment only.

### Phase 4 — People (founders/executives)
1. **YC directory** (`yc-oss.github.io/api/companies/all.json` — the same source freehire's `cmd/import-yc` uses): company + one-liner + batch + website; founders where published.
2. **startups.gallery** (sitemap-crawlable, be gentle) and **workatastartup** (robots permits; scrape gently, respect their terms) — founder/exec names + roles + socials.
3. **Wikidata** (already integrated live) + **Scout-style profile harvest** through the existing page-enrichment/stealth worker: headline → company → domain → MX → email-pattern → verify (the Scout pipeline, our code).
4. Schema = existing `PersonRow` + provenance: `name, role, company, domain, linkedin, socials[], email?, email_verified?, source, evidence, confidence, last_seen, content_hash` → `data/people_complete.jsonl`.
- Scrapivo side: people queries go DB-first when the tokenizer says `people`, live fan-out blends. The People table already has Name/Role/Company/Location/Email/Social/Why match/Generate columns.

### Phase 5 — Ops (only when the above are earning)
1. Incremental updates: DuckDB tables track `last_seen` + `content_hash`; nightly diff → upsert/stale-mark; JSONL re-export.
2. Orchestration: plain scripts + scheduled runs first; **Prefect** (not Airflow) if DAGs get complex.
3. Logging/metrics per run (rows in/out, error rates per source).
4. Distributed scraping (Celery/queues) and cloud deploy (Docker) — defer until a single machine can't keep up.

## 4. freehire quick wins (no pipeline needed — do first, same week)
1. `data/workday_tenants.json`: **2 rows → 6,539** (freehire `sources/workday.yml`, board = `host/site`, directly usable against Workday CXS).
2. `data/company_ats_tenants.json`: **24 rows → thousands** (from `freehire/sources_normalized.json`, 93,379 company→ATS pairs; same `{company, provider, board}` shape — it's where our format came from).
3. Re-run `scripts/build-job-board-catalog.mts` with raised caps (greenhouse alone has 7,202 boards vs our 540 total).
4. Lift freehire's `ats_boards.py` VALIDATORS map (exact public ATS API URL per provider) as our tenant-probe layer.
5. Optional live fallback: freehire.me public API `GET /api/v1/jobs` (keyless).

## 5. Licences (all green light except the noted skips)
- Companies House/GLEIF/EDGAR: open, bulk-downloadable. Overture Places: CDLA-Permissive 2.0 (+ Apache/CC0 sources), no share-alike. OSM-derived fields inside Overture are pre-packaged by Overture. gosom: MIT. freehire: MIT. botasaurus: MIT (not used).
- **Not reusable**: openleads (PolyForm Noncommercial), prospector (MIT/AGPL conflict). pyrosm skipped (Overture supersedes).

## 6. Suggested first build slice
Phase-2 Overture extract for ONE region (e.g. Texas or UK) + `local_businesses.jsonl` ingest + DB-first local
branch + one Phase-4 people source (YC) — demonstrates the full loop (search → DB hits → contacts →
Generate) with real data in days, then widen regions and stack the registries.
