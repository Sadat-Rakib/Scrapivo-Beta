# CockroachDB Bulk-IMPORT Benchmark — 50k Businesses Slice

Date: 2026-09-11. Cluster: `scrapivo-db` (Basic, aws us-west-2).
Question: is `IMPORT INTO` from our existing S3 data economically viable vs the
transactional loader, and can the full corpus live on this cluster?

## Method (all constraints honored)

- S3 read-only on sources (`GET`/`LIST` only); new `bench_import/` prefix for staged files.
- Slice: `processed/local-businesses/by_country/bg.parquet` (45,000 rows) +
  `bh.parquet` (8,773 rows) → normalized with the **unmodified production
  normalizer** (`scripts/pipeline/store.py:to_pg_row`, scope BG+BH, source
  `overture` from the `evidence` column) → deduped, sorted by `registry_key`,
  first 50,000 rows staged as `bench_import/bench_50k.parquet` (7.3 MB, Parquet,
  exact `idx_businesses` column order minus `last_seen` which defaults to `NOW()`).
  Staging: 53,773 seen / 53,773 valid / 0 failed / 0 out-of-scope / 0 dupes.
- Tables: `idx_businesses_bench` = full production mirror (PK + all 4 secondary
  indexes incl. GIN trigram — all created cleanly) and `idx_businesses_bench_base`
  (PK only, for the base-vs-index split). No production table touched.
- Trial: 1,000-row file into disposable `idx_bench_validate`, verified, dropped —
  bench tables empty before the measured window. (Finding: `row_limit` is not a
  valid option for `PARQUET` imports; a separate 1k file was used instead.)
- Window: BEFORE snapshot → `IMPORT INTO bench (50k)` → `IMPORT INTO base (5k)` →
  AFTER snapshot. Trial/DDL cost falls outside the window by design.
- Auth: S3 `SPECIFIED` credentials (static profile keys) in the IMPORT URL;
  `PARQUET DATA` (preview feature) worked with zero adaptations on v26.2.5.

## Raw results

IMPORT job outputs (job_id, status, fraction, rows, index_entries, bytes):

- main50k: `succeeded`, 1.0, **rows=50000, index_entries=1140229, bytes=106606377**, 8.6 s (~5.8k rows/s)
- base5k: `succeeded`, 1.0, **rows=5000, index_entries=0, bytes=1698695**, 4.0 s (job-overhead dominated)

Console meters (user-read, the ground truth):

| | RU used | Storage used |
|---|---|---|
| BEFORE | 45.53M / 60M | 1.39 GiB / 6 GiB |
| AFTER | 45.54M / 60M | 1.51 GiB / 6 GiB |
| **Delta (55k rows)** | **≈0.01M ≈ 10,000 RU** | **≈0.12 GiB ≈ 129 MB** |

## Computed economics (the measured IMPORT result is authoritative)

- **RU/row (IMPORT, full production schema+indexes): ≈0.18 RU/row**
  (console displays 2 decimals, so the delta is 1k–19k RU ⇒ per-row range
  ~0.02–0.35 RU/row; upper bound still tiny).
- RU/100k ≈ **18k** · RU/1M ≈ **180k**.
- Storage/row ≈ **2.1 KB/row** blended (job bytes agree: 2,132 B/row full vs
  meter 129 MB/55k ≈ 2.34 KB/row — same ballpark given meter granularity).
- Storage/100k ≈ **210 MB** · Storage/1M ≈ **2.1 GB**.

## Base-vs-index split (job `bytes` + `index_entries`, meter corroborates)

- Base table (PK only): **~340 B/row** written, 0 secondary index entries.
- Full table: **~2,132 B/row**, 1,140,229 index entries / 50k rows =
  **~22.8 index entries/row** — the GIN trigram on `name_normalized` dominates.
- Index maintenance ≈ **84%** of written bytes. (Per-object `pg_relation_size`
  is unavailable on CockroachDB — attempted, `unknown function` — so the split
  uses IMPORT job accounting, corroborated by the storage meter.)

## Comparison (benchmark only, not ground truth)

Historical transactional path ≈45.5M RU / ~683k rows ≈ **~66 RU/row** — but that
figure bundles diff `SELECT`s, full-table idempotency re-scans, and `COUNT(*)`
batteries, so it is an all-in comparison point, not a pure per-row cost.
IMPORT at ~0.18 RU/row is on the order of **~350x cheaper per row** for ingestion.

## 16M extrapolation and verdict

- **RU: SOLVED by IMPORT.** 16.3M businesses × ~0.2 RU/row ≈ **3–6M RU** —
  fits comfortably in the monthly budget (the transactional path would need ~1B RU).
- **Storage: BINDING CONSTRAINT, IMPORT cannot fix.** 16.3M × ~2.1 KB/row ≈
  **~34 GiB vs the 6 GiB ceiling.** The full businesses corpus cannot live on
  this cluster regardless of ingestion method. (PK-only would be ~5.5 GiB but a
  table without retrieval indexes is useless for search.)
- Practical fits on this cluster: e.g. ~2M fully-indexed businesses (~4.2 GiB),
  or the current eval slices. The full 16M+ corpus stays on S3 (source of truth)
  + local/Supabase indexed slices until a larger store is provisioned.

## Caveats

- Meter rounding (±0.005M RU, ±0.01 GiB) dominates the small RU delta; the
  direction and order of magnitude are robust, the second digit is not.
- Fixed IMPORT job overhead amortizes better at 50k than 5k rows; the 5k base
  arm slightly overstates base per-row RU.
- Trial (~1k rows) and DDL RU fall outside the window; the final `DROP TABLE`
  cost (DDL, negligible) falls after the AFTER snapshot by design.
- Staged files kept for reproducibility: `bench_import/bench_50k.parquet`
  (sha256 `b0da58f1…5c8b18c`), `bench_5k.parquet`, `bench_1k.parquet`.
  Driver scripts: `%LOCALAPPDATA%\Temp\opencode\bench_{stage,trial,ddl,main,crdb}.py`.

## Cleanup

- `idx_businesses_bench` and `idx_businesses_bench_base` dropped after this
  report was written; verified absent. No production data, index, or S3 source
  was created, modified, or deleted at any point. **Stopped — no further loads.**
