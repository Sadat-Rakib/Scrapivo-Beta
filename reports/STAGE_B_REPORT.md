# STAGE B REPORT — mapping sign-off + reconciliation + S3 layout (Gate B)

Date: 2026-09-08. Zero S3 writes performed in Stage B. No app code touched.

## B1. Mapping approvals (done)

All 4 `reports/mappings/s3_cohort_*.json` now `approved:true, approver:user,
date:2026-09-08` with `ambiguity_resolutions` recorded (A1 corporate-wins,
A2 inspect-first, A3 fallback-evidence, A4 dup-closed, A5 report-only,
campaign DEFERRED). Bug fixed en route: apollo mapping file had two
concatenated JSON objects (invalid); rewritten as one valid object, verified
parseable. All 4 re-validated with `json.load`.

## B2. Reconciliation re-check (done, independent recount)

Streaming recount of `C:\ScrapivoData\splits\` (66 pairs, headers excluded):
complete=886,633, incomplete=943,564, total=1,830,197 — matches
SPLIT_VERIFICATION exactly. PASS. Repo contains zero bulk files (splits/ dir
removed). `C:\ScrapivoData\processed\` empty (no canonical output in Stage A).

## B3. S3 layout check (done, read-only)

Bucket reachable via profile `scrapivo` (us-east-2). 88 top-level objects, all at
bucket root. Required prefixes (raw/ processed/ incomplete/ signals/ reports/
exports/) do not exist yet — created implicitly on first Stage-C upload. No writes made.

## IMPORTANT FINDING: 21 new crunchbase chunks arrived after profiling

Earlier inventory recorded 62 objects; profiler saw 67; bucket now holds 88.
The 26 keys absent from the original inventory include 5 already profiled/split
(1m-1.1m, 1.9m-2.0m, 2.0m-2.1m, 2.1m-2.2m, 2.8m-2.87m — uploaded mid-session) plus
**21 completely new, unprofiled chunks**: crunchbase_0-100k, 100k-200k,
200k-1m series, 1.1m-1.6m series, 2.2m-2.8m series (~57 MB each, ~100k rows each,
≈2.1M additional company rows). Same 41-col family expected (verify at profiling).

## Gate-B questions for approval

1. Accept Stage A as verified for the 67-file cohort (886,633 / 943,564 / 0 loss)?
2. New 21 chunks: (a) run Stage A2 now (profile→census→split→verify, same gates),
   or (b) proceed to Stage C on the 67 and fold new chunks in afterward? Recommended: (a).
3. Proceed to Stage C (canonical Parquet + verification → first S3 placement)?
