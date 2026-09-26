# STAGE A2 REPORT — 21 new crunchbase chunks (Gate A2)

Date: 2026-09-08. Same pipeline, same gates. Zero S3 writes. No app changes.

## Results

- Profiled 21 new files: all identical 41-col crunchbase family, entity override
  company (0.85) applied → 29 company-41 files total, 88 profiles overall.
- Census: 88 files, 3,935,007 rows, 2,091,035 complete.
- Splits: 87 pairs (dup excluded), complete=2,086,466, incomplete=1,843,731,
  total=3,930,197. Independent streaming recount matches exactly
  (census − dup 4,810/4,569 reconciles). Unexplained loss: 0.

## Combined corpus after A2

| entity | complete (ingest) | incomplete (enrich later) |
|---|---|---|
| People | 484,325 (unchanged) | 591,125 + blanks |
| Companies | ~1,602,141 (402,308 + ~1.2M new) | ~1.25M |

## Company-threshold input for Stage C (distributions observed)

Crunchbase chunks complete at 51–58% under the locked gate (name + website +
location + category + email AND phone + social-any). Lakta remains 0% (no
email/phone columns — structurally incomplete, preserved). Proposal for Stage C:
keep the locked gate as the sufficient line; score distribution (QUALITY_PREVIEW
pattern) calibrates ranking, not the line. No preset changed without approval.

## STOP — awaiting approval for Stage C (canonical Parquet + verification → first
S3 processed/incomplete placement). `C:\ScrapivoData\processed\` still empty.
