# Geographic coverage matrix

Source: `data/coverage-matrix.json` builtAt `2026-09-11`. Live column = **UNKNOWN** until a battery/e2e hit proves a provider returned rows for that ISO.

## Summary

| Entity | Geos listed | S3 rows measured > 0 | Live providers declared | Spec live path today |
|--------|------------:|---------------------:|-------------------------|----------------------|
| businesses | 91 | 37 | OSM nominatim + overpass | OSM when category+location; web fallback |
| companies | 110 | 42 | SearXNG (`live-web`) when thin/signal | **live-web** (not COMPLETE) |
| people | 219 | 219 | SearXNG (`live-web`) when thin/signal | **live-web** (not COMPLETE) |

> **Stale claim cleared (2026-09-14):** company/person were documented as `live-none`; SPEC path now gapfills via SearXNG. Still **never** mark geo COMPLETE without a per-ISO test — see [09-post-implementation-reality-check.md](09-post-implementation-reality-check.md).

Raw rows: `geo-matrix-raw.json` (420 entries).

## Interpretation rules

- `PARTIAL_DATA` — S3 has measured rows; Discover may still return 0 if filters (industry, business_model, city) reject.
- `FILE_PRESENT_UNMEASURED_OR_EMPTY` — object exists; row count null or 0.
- `NO_S3` — no file; only live can fill (businesses can try OSM; companies/people cannot today).
- **Never mark COMPLETE** without a named test (see `06-verification.md`).

## Alberta / Canada note

Province strings often miss `planIso` (coverage selector) and fall to **legacy S3 gazetteer** — why Alberta no-website can return rows while planned India company hunts fail.

## Expansion path (not claimed complete)

1. Overture country JSONLs already 91 — regenerate missing ISO via `scripts/pipeline/run_overture*.py`.
2. OSM Overpass for any city with Nominatim resolve (global maps).
3. SearXNG webboolean for company/person when S3 thin.
4. Country registries (Companies House already imported for GB; GLEIF/EDGAR/YC for companies).

## Claim discipline

> “Germany business coverage exists” requires: S3 or OSM proof + test id. Until then: UNKNOWN / PARTIAL_DATA only.
