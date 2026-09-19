# Gate 2B index backfill plan

No production migration or bulk load was executed.

## Current and target coverage

| Entity | Current index | Physical | Stage target |
|---|---:|---:|---:|
| People | 399,397 | 484,325 | Reconcile priority US/GB/CA/IN physical set: 399,560 rows before dedupe |
| Companies | 79,014 | 1,602,141 | 682,555 safely US-routable rows; do not invent geography for 919,586 unmapped rows |
| Businesses | 609,387 | 16,338,186 | 4,893,733 physical rows in US/GB/CA/IN, loaded country by country |
| Investors | 0 | 8,076 | No index now; S3 latency is acceptable |

## Schema

Review and apply `supabase/migrations/20260919000000_gate2b_retrieval_indexes.sql` during a controlled maintenance window. It adds:

- `(country, role_norm, quality_score DESC)` for country-wide people searches;
- trigram indexes for people role/industry and company category aliases.

## Loader guarantees

- Read-only S3 LIST/GET operations.
- 20,000-row memory-bounded chunks.
- Stable `registry_key` and content hash.
- Insert/update/unchanged diff before writes.
- `ON CONFLICT` idempotency.
- Per-chunk commit enables resume after interruption.
- `--dry-run` performs zero writes.
- Country scope and per-country counts are reported.

## Required dry runs

```powershell
rtk py -3 scripts/pipeline/store.py --pg --dry-run --people-s3 --only person-s3 --scope US,GB,CA,IN --s3-profile scrapivo
rtk py -3 scripts/pipeline/store.py --pg --dry-run --company-s3 --only company-s3 --scope US,GB,CA,IN --s3-profile scrapivo
rtk py -3 scripts/pipeline/store.py --pg --dry-run --only business --scope US,GB,CA,IN
```

The 20-row company smoke dry run completed with 20 valid, 20 would-insert, 0 failed, and zero writes in 35.56 s.

## Production sequence requiring explicit approval

1. Apply schema migration.
2. Load people by priority scope.
3. Load safely geo-routable companies. Keep unmapped macro-location rows out of geo certification.
4. Load businesses one country at a time: CA, GB, US, IN. Verify counts and query latency after each country.
5. Re-run golden existence and quantity tests after every stage.

```powershell
# Requires PG_DSN or DATABASE_URL and explicit production approval.
rtk py -3 scripts/pipeline/store.py --pg --people-s3 --only person-s3 --scope US,GB,CA,IN --s3-profile scrapivo
rtk py -3 scripts/pipeline/store.py --pg --company-s3 --only company-s3 --scope US,GB,CA,IN --s3-profile scrapivo
rtk py -3 scripts/pipeline/store.py --pg --only business --scope CA
rtk py -3 scripts/pipeline/store.py --pg --only business --scope GB
rtk py -3 scripts/pipeline/store.py --pg --only business --scope US
rtk py -3 scripts/pipeline/store.py --pg --only business --scope IN
```

Stop and investigate if failed rows exceed 0.1%, country counts exceed physical bounds, or golden searches regress. Re-running the same command is the resume and rollback-safe recovery path because writes are idempotent. Database backup/PITR is the rollback mechanism for an approved production load.

