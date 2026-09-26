# S3_MIGRATION_REPORT — DRY-RUN ONLY (nothing uploaded, nothing deleted)

Generated 2026-09-07 by `python tools/s3_migrate.py --dry-run --profile scrapivo`.
Mode performed **zero S3 calls** (offline categorize + measure). Manifest:
`reports/S3_MIGRATION_MANIFEST.json`.

## Totals

- Files to upload: **103** | Bytes: **14,496,672,963 (13.50 GiB)**
- Sidecars kept local (NOT migrated): 4
  (`company_ats_tenants.json.prev`, `investors_complete.jsonl.pre-bio-backfill.bak`,
  `job_boards_catalog.json.prev`, `workday_tenants.json.prev`)

## Destination prefixes (filenames preserved, bucket stays private)

| prefix | files | MiB |
|---|---|---|
| `raw/local-businesses/` | 91 | 12861.2 |
| `raw/companies/` | 2 (`companies_complete.jsonl` 239MB + `BasicCompanyDataAsOneFile.zip` 470MB) | 708.9 |
| `raw/other/` | 7 (duckdb 216MB, city map 22MB, manifests/catalogs) | 238.2 |
| `raw/investors/` | 2 (`investors_merged.json` 15.8MB + `investors_complete.jsonl` 1.1MB) | 16.9 |
| `raw/people/` | 1 (`people_complete.jsonl` 15KB) | 0.0 |

Largest 10: `in` 1662MB, `br` 1603MB, `us` 1577MB, `BasicCompanyDataAsOneFile.zip` 470MB,
`de/gb/fr/jp/es/ca` ~313–318MB each.

## Upload procedure (requires approval + `scrapivo` auth; NOT run)

1. `python tools/s3_migrate.py --upload --profile scrapivo` — multipart via
   `upload_file` (automatic), 4 retries w/ backoff, skip-identical by HEAD size
   compare, no overwrite unless `--overwrite`, verify HEAD after each file.
2. `python tools/s3_migrate.py --verify --profile scrapivo` — local vs remote size check.
3. Re-run `--upload` safely resumes (identical files skipped).

## Risks / rollback

- Upload is additive only; raw objects never overwritten without explicit `--overwrite`;
  local files never deleted (tool has no delete path).
- 13.5 GiB transfer time on residential uplink is the main cost; resumable.
- Rollback = delete uploaded keys only (explicit command, needs approval).
