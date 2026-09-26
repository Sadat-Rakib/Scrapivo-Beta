# Universal Audit — Current System Map

Generated as part of Phase A. Status vocabulary: `COMPLETE | PARTIAL | BROKEN | MISSING | REDUNDANT | UNKNOWN`.

## Topology

```
Discover UI (discover.tsx)
  ├─ SPEC path (default ON): runSpecSearch → runSpecSearchCore
  │    ├─ extractSearchSpec + clarifier / mode-gate
  │    ├─ coverage-selector → hot-index / S3 parquet / provider tier
  │    ├─ completeness + enrich-incomplete
  │    └─ live-gapfill (OSM business | jobs | ELSE live-none)
  └─ LEGACY path (SPEC_SEARCH_ENABLED=false): runSearch → searchAllSources
       └─ Reddit/HN/LinkedIn/SearXNG/jobs/gov/news/stealth/…
```

Dual stack: **Scrapivo** (this app) + **freehire/** (Go ATS catalogue — separate product).

## Module inventory (Scrapivo)

| Area | Count | Status | Notes |
|------|------:|--------|-------|
| `src/lib/search/*` | 72 | PARTIAL | Rich live adapters; many unused by spec path |
| `src/lib/local/*` | 2 | PARTIAL | Overture JSONL + gazetteer |
| `src/lib/jobs/*` | 14 | PARTIAL | Fleet + JobSpy optional |
| `src/lib/contact/*` | ~15 | PARTIAL | Scout-style harvest / verify |
| `src/lib/intelligence/*` | 4 | PARTIAL | evidence, entity-resolve, personalize |
| `workers/stealth-worker` | 1 | PARTIAL | Playwright LinkedIn/IG/FB |
| `workers/scrape-worker` | 1 | PARTIAL | Crawl4AI enrichment |
| `data/local_businesses_*.jsonl` | 91 | PARTIAL | Country extracts |
| `data/coverage-matrix.json` | 1 | PARTIAL | Measured S3; companies/people `declaredProviders: []` |
| Scout / OpenMagpie / Harken repos | 0 | MISSING | Patterns only (CROSS_APP doc) |
| JobSpy binary | 0 | THIN | HTTP adapter only |
| browser-use agent | 0 | DEFERRED | LATER_WORK.md |

See `inventory-index.json` for full file lists.

## Orchestration status

| Capability | Status | Proof |
|------------|--------|-------|
| Spec-first SearchSpec | PARTIAL | `search-spec-extract.ts` — ASCII geo, craft gaps, SIGNAL_HINT narrow |
| Coverage selector | PARTIAL | ON in prod; company/person no live providers declared |
| Hot / S3 retrieve | PARTIAL | Works for covered geos; thin elsewhere |
| Live business (OSM) | PARTIAL | `live-gapfill` + coverage provider |
| Live company/person | BROKEN | `engine: "live-none"` |
| Live jobs | PARTIAL | Jobs fleet; HTML entities in titles |
| Legacy `searchAllSources` | REDUNDANT on default path | Still called when flag off / fallback |
| Enrich-before-show | BROKEN for business/company | Name-only completeness |
| Why-match | PARTIAL | Empty for thin browsing; jobs = "Open role" |
| Evidence provenance | PARTIAL | intelligence/evidence exists; Discover list underuses |

## Coverage summary (S3 matrix, untested live = UNKNOWN)

| Entity | Geos in matrix | With measured rows > 0 | Declared live providers |
|--------|---------------:|-----------------------:|-------------------------|
| businesses | 91 | 37 | osm-nominatim, osm-overpass |
| companies | 110 | 42 | _(none)_ |
| people | 219 | 219 | _(none)_ |

People row counts exist in matrix but **live discovery still absent** on thin filter misses (e.g. SaaS founders NY industry filter → 0).

## Database / schema (high level)

| Store | Role | Evidence fields |
|-------|------|-----------------|
| Supabase Postgres | Auth, CRM, investors, jobs cache, cross-app intelligence | Mixed; see migrations `202608*` |
| DuckDB `data/pipeline.duckdb` | Offline ETL | Pipeline working store |
| S3 parquet / JSONL | Canonical directory dumps | Identity keys; limited provenance |
| freehire Postgres | Job catalogue | Separate product |

Evidence-first model (URL + timestamp + confidence per field) is **PARTIAL** — contact provenance exists; Discover SpecRow why_match often null.

## Freehire (separate)

Ingest/enrich/search-drain/embed/Telegram — job aggregator. Bridged via `src/lib/jobs/freehire-source.ts`. Not a substitute for Scrapivo company/person live discovery.
