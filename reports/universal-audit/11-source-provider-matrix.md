# 11 — Source / provider matrix

**Date:** 2026-09-15  
**Mode:** Audit-only

## Active SPEC path

| Source | Entity | Wired | Free-first | Notes |
|--------|--------|-------|------------|-------|
| Postgres `idx_*` | business/company/person | Yes (`USE_INDEXED_SEARCH`) | n/a | Hot index; directory rows need evidence under signal |
| S3 parquet canonical | local biz / companies / people / investors | Yes | n/a | Timeouts observed (Berlin E) |
| OSM Nominatim/Overpass | business + location | Yes | free | Strongest A-path (`no_website`) |
| SearXNG | person/company live-web | Yes (`provider-ladder`) | **primary free** | Flaky 0-hit this audit; FP aggregators when hits |
| Jobs fleet + freehire API | job | Yes | mixed | freehire = jobs only sibling |
| Reddit public search | social_ask | Wired | free | **HTTP 404** this env — fail-closed, no fabricate |
| Paid SERP (Serper etc.) | — | Ladder can skip | paid | Not required when SearXNG works; unused when empty too |

## Legacy / parked (Discover flag off or LATER)

| Source | Status |
|--------|--------|
| `searchAllSources` social/dorks/stealth/news | Legacy Discover / campaigns |
| Playwright stealth worker | Not on Spec request path; no abort API |
| browser-use agentic | Parked (`LATER_WORK.md`) |
| demand-classifier aggregators | **Exists but unused on SPEC live** |

## freehire

Sibling Go ATS catalogue under `freehire/`. Wired into Scrapivo **jobs provider only** — not Discover company/person engine.

## Enrichment sources

| Path | When | Contact harvest |
|------|------|-----------------|
| `enrichSpecRowFromSite` | Incomplete DB rows with URL | Yes (freeOnly) |
| Live gapfill rows | After enrich phase | **Skipped** — SERP URL as identity |

## Env probe (this audit)

| Var | State |
|-----|-------|
| SPEC_SEARCH_ENABLED | true (default / .env) |
| SEARXNG_URL | set |
| SUPABASE_URL | set |
| DATABASE_URL | absent |
| USE_INDEXED_SEARCH | true |
| USE_PAID_SOURCES / SERPER | set (not required on free path) |
