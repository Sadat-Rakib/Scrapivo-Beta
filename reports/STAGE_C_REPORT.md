# STAGE C REPORT — canonical Parquet + verification + first S3 placement (Gate C)

Date: 2026-09-08. Raw S3 + repo code untouched. No app changes. No merges/deletes
of records (dedupe report-only).

## C2. Normalization (`tools/normalize.py`, approved mappings)

- `C:\ScrapivoData\processed\people\person.parquet` — 484,325 rows (67.8 MB)
- `C:\ScrapivoData\processed\companies\company.parquet` — 1,602,141 rows (355.0 MB)
- Canonical fields + quality components + `social_presence` + `activity_status=unknown`
  + provenance per row. Person Phone = Comp/Company Phone only; leading-apostrophe
  phone artifact stripped (found in smoke test, fixed before full run).
- A2 `extra` resolved: Lakta `extra` is 100% the literal string "Crunchbase icon"
  (UI scrape artifact, zero information) → document-dropped per pre-approval.

## C3. Verification (`reports/STAGE_C_VERIFICATION.md`) — PASS

- Counts: 484,325 + 1,602,141 = 2,086,466 == split complete total. PASS.
- Gate-field nulls: 0.00% on all 13 required columns (both entities). PASS.
- Quality: people 434,881 @100 / 48,852 @80; companies 1,444,182 @100 / 155,299 @80.
- Dedupe REPORT (no merges): people email 65,415 groups/173,552 rows; people
  linkedin 54,550/139,519; company email 9,416/20,244; company website 478/1,029.
  Overlap is cross-file (expected); merge policy needs your approval (Stage D/E input).
- Samples verified human-readable (e.g. Gerald Adasavage / Green Automation;
  37PropertyGroup / Consulting-Property-Management).

## C4. S3 placement — 89/89 uploaded-verified, then 1 self-found bug fixed

- `processed/people/person.parquet`, `processed/companies/company.parquet` ✓
- 87 incomplete CSVs → `incomplete/people|companies/` ✓ (`reports/STAGE_C_UPLOAD.json`)
- Bug: uploader first wrote `incomplete/person|company/` (singular); all 87 moved
  to locked plural prefixes with copy-verify-delete; 0 bad-prefix keys remain.
  Uploader patched so re-runs are correct.

## Gate-C approvals needed

1. Accept canonical Parquet + verification?
2. Dedupe merge policy: keep report-only, or approve deterministic merge rules?
3. Approve Stage D (query layer + investor/outreach app fixes) and/or business index?
