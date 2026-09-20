# Gate 2B-final storage architecture

Status: architecture and first implementation complete; full mechanical build, cutover, and cleanup pending.

## Decision

AWS S3 remains canonical. Search uses immutable, rebuildable derived objects under
`derived/search-index/versions/<version>/`; `derived/search-index/active.json` is the
only mutable pointer. Supabase remains the application database. Cloudflare R2 is
supported through the same S3-compatible adapter but is neither configured nor
required.

The selected index is a deterministic binary posting layer plus compact Zstandard
Parquet document blocks. Posting objects contain exact normalized terms and
delta-varint document IDs with quality/contact flags. Document rows contain the
search/display subset and canonical locator (`source_object`, `source_row`, stable
registry key). A normal query reads bounded posting ranges and derived document row
ranges; it does not scan canonical country files.

Redundant compound postings were removed. Multi-filter queries intersect independent
country/city/category/role postings, materially reducing bytes while preserving exact
precision. The manifest header is also the deterministic coverage catalog: an absent
term or shard produces `NO_DATA`/`NO_COVERAGE` without a canonical scan.

## Supabase forensics

Read-only accounting found 651,930,771 bytes (621.73 MiB) on the 500 MB Free plan.
The three rebuildable `idx_*` relations occupy 634,699,776 bytes:

| Relation | Rows | Table | Indexes | Total | Classification |
|---|---:|---:|---:|---:|---|
| `idx_businesses` | 609,387 | 257,220,608 | 129,908,736 | 387,227,648 | derived |
| `idx_people` | 399,397 | 145,121,280 | 65,765,376 | 210,960,384 | derived |
| `idx_companies` | 79,014 | 15,949,824 | 20,520,960 | 36,511,744 | derived |

Public non-index application relations total 4,595,712 bytes. `qualified_leads`,
search history, source health, AI cache, auth, user data, and unknown objects are not
cleanup candidates. No Supabase mutation occurred. If the derived relations are
removed after certified cutover, projected database size is about 17.2 MB; provider
quota accounting may lag. Exact DDL/index definitions are captured in
`04-supabase-before-cleanup.json` and the existing migration.

## Shape benchmark

Representative Bahrain business data (7,937 eligible rows), query `restaurant +
Manama`:

| Shape | Bytes/record | Objects | Cold | Warm median | Query bytes |
|---|---:|---:|---:|---:|---:|
| partitioned compact row shards | 247.24 | 232 | 19.55 ms | 4.30 ms | 13,132 |
| binary postings + Parquet documents | 138.93 | 1,092 | 16.89 ms | 0.19 ms | 435 posting bytes |

Binary postings won on size, warm latency, exact intersection, and range-read behavior.
Two hash hex characters cap each entity/dimension at 256 objects; full-corpus sizing
must be reported from the completed build rather than extrapolated as fact.

## First implementation proof

The corrected v3 subset covered five canonical objects and four entities:

- 43,765 physical rows = 43,331 searchable + 434 quarantined.
- 0 duplicate, 0 unindexable, 0 failed, 0 unaccounted.
- 6,407,687 posting bytes; 3,272,695 document bytes; 3,860 posting objects.
- Build 81.7 s. Resume respected all five checkpoints, reprocessed zero partitions,
  preserved counts, and completed in 65.5 s (posting finalization only).
- Seeded rediscovery: 500 businesses + 200 people + 200 companies + 100 investors =
  1,000/1,000 passed, 0 unexplained failures, 0 wrong results.
- Quantity 100 passed for all four entities.
- Local posting lookup p50 1.72 ms, p95 24.79 ms, max 38.88 ms.
- Canonical reads: 0. AI calls: 0.

The builder is partition-checkpointed, transactionally stages postings, reconciles
every row, writes the complete manifest last, verifies uploaded size/checksum, refuses
immutable-key conflicts, and compare-guards activation. An explicit manifest override
supports pre-activation certification. Runtime cutover remains feature-gated off and
the Gate 2B legacy fallback remains intact.

## Build and cutover safety

Local capacity is the only current execution blocker. The C: drive had 41,877,504
bytes free after obsolete test artifacts were removed. The verified subset consumed
about 22.9 MB of artifact plus checkpoint state for 43,765 physical rows; a conservative
linear full-build working estimate is 9.65 GB, with at least 20 GB required for safe
temporary/finalization headroom. No unrelated files were removed. The full build must
not start until that headroom exists or `--output-dir` and `--checkpoint-dir` point to
another writable volume with equivalent capacity.

The full build must use a fresh version. Uploading is limited to the derived version
prefix. Do not pass `--activate` initially. After full reconciliation and seeded
certification, certify S3 range reads using the explicit manifest key, then activate
with `--expected-active-version` (or an omitted expected value only for the first
activation). Only then enable the object-index feature.

The `idx_*` drop must be a later versioned migration. It is forbidden until the new
path is active, all counts reconcile, random rediscovery has zero unexplained failures,
rollback is proven, and no runtime dependency remains. No cleanup migration has been
created or executed yet, deliberately.

## Determinism and AI

Normalization, aliases, posting construction, lookup, filtering, radius, exclusions,
pagination, catalog decisions, and certification are deterministic. Stored retrieval
tests mock the AI router to throw. Subset build/certification reported zero AI calls.

## Remaining work

Only the long-running full build/upload, full certification/report materialization,
atomic cutover, gated Supabase cleanup, final provider size measurement, and final
regression execution remain. These are mechanical and must not be represented as
complete before their artifacts exist.

## Terra continuation

After providing a writable working volume with at least 20 GB free, run a fresh full
version without activation:

```powershell
rtk proxy "C:\Users\mirsa\AppData\Local\Programs\Python\Python313\python.exe" scripts/pipeline/build_search_index.py --version 2026-09-20-v1 --output-dir <WORK_VOLUME>\scrapivo-index --checkpoint-dir <WORK_VOLUME>\scrapivo-checkpoints --bucket-hex-chars 2 --s3-profile scrapivo --upload
```

Then certify and materialize reconciliation:

```powershell
rtk proxy "C:\Users\mirsa\AppData\Local\Programs\Python\Python313\python.exe" scripts/pipeline/certify_search_index.py --build <WORK_VOLUME>\scrapivo-index\2026-09-20-v1 --seed 9172601 --output reports/gate2/04-full-index-certification.json --reconciliation-output reports/gate2/04-index-reconciliation.json
```

Do not activate or drop Supabase indexes unless this exits zero, S3 pre-activation
runtime certification passes, and every reconciliation row has `reconciled=true`.
