# LEAD COUNTS + FILES + TOOLS + SYSTEM FLOWS (generated 2026-09-08)

Decisions locked this round: (1) truly-empty rows go to incomplete/needs-enrichment,
never deleted; (2) the byte-identical duplicate file is EXCLUDED from ingest
(SHA256 match confirmed, both `cd55292d…`; raw objects stay in S3 untouched).

## 1. How many leads (exact counts, verified today)

### New S3 CSV cohort (ingestible = complete rows under locked gates)

| entity | complete (ingest) | incomplete (enrich) | total |
|---|---|---|---|
| PEOPLE | **484,325** net (488,894 gross − 4,569 dup file excluded) | 591,125 + 99,354 empty→incomplete | 1,080,019 |
| COMPANIES | **402,308** (Crunchbase chunks ~51–58% each) | 305,184 (+47,496 Lakta, 0% — no email/phone cols) | 754,988 |

Excluded from ingest, preserved in raw: duplicate
`apollo (5)…deliverable…(1)_CATEGORIZED.csv` (4,810 rows); 12 zero-complete files
(Coaches, Contractors, CXO-112924, Lending, Healthcare-per-rule, splinters, Lakta)
flow whole to incomplete.

### Existing corpora (reference + matching + current app sources)

| corpus | rows (exact line counts today) | role |
|---|---|---|
| Local businesses (Overture, 91 files) | **16,337,934** (us/in/br 2.0M each; 400k ×8; 130k ×22; long tail) | business search + signal matching |
| Investors clean (`investors_complete.jsonl`) | 1,252 | investor search (shadow path today) |
| Investors merged (`investors_merged.json`) | 8,098 | investor search (live path today) + raw for canonicalization |
| Companies registry (`companies_complete.jsonl`) | 315,208 | hiring-blend + company matching |
| People stub (`people_complete.jsonl`) | 27 | negligible; superseded by new cohort |

**Top-tier ingestible total on day one: ~484k people + ~402k companies + 16.3M
business places + ~1.3k–8k investors** (≈17.2M records addressable; quality-ranked,
dedupe-report pending at ingest).

## 2. What files feed what

- Ingest: 55 person CSVs + 8 crunchbase CSVs (minus 1 dup) → canonical person/company
  → `processed/{people,companies}/` (Parquet) + `incomplete/` splits.
- Reference/matching (never deleted): Overture business JSONL, registry JSONL,
  investor JSONs, Lakta, zero-complete CSVs.
- App code paths (unchanged so far): `src/lib/investors/search.ts` (merged bundle),
  `local-file-source.ts` (clean JSONL), `companies/local-file-source.ts`,
  `local/businesses-file-source.ts` + OSM fallback, `outreach-draft.ts` (+P0 fix pending).

## 3. What tools

Built: `tools/local_inventory.py` (local 13.5 GiB audit), `tools/s3_migrate.py`
(dry-run done; `--upload --verify` pending your migration approval),
`tools/profile_s3_csvs.py` (67 profiles), `tools/completeness_census.py` (this census).
Infra: S3 private bucket (us-east-2, profile `scrapivo`), DuckDB/Python streaming
(no full-RAM), Parquet for processed, existing SearXNG + free sources for signals.

## 4. System behavior — input → what happens

**Static people query** — e.g. `startup founders in Canada` →
intent: person, role=founder, location=CA, no signal required →
canonical person index filter (title/industry/country) → rank by quality score →
cards with `why_relevant` from matched facts only.

**Static company query** — e.g. `SaaS companies in UK` →
canonical company index (industry/location/employees) → same treatment.

**Business query** — e.g. `plumbers in Austin` →
business index (category + locality, Overture 16.3M + OSM live fallback) →
rank craft-match + phone/site presence → cards with Maps/contact actions.

**Investor query** — e.g. `VCs investing in SaaS` →
canonical investor set (post-fix loader) → stage/sector/check-band filters →
rank image/completeness/relevance.

**Signal-required query** — e.g. `companies looking for website developers`,
`businesses hiring web developers` →
intent parser sets `signal_required=true, types=[service_request/hiring],
recency≤90d` → static candidates narrowed → `signals/verified` join
(candidate state never shown as fact) → rank signal recency+confidence first →
`why_relevant` cites the post/URL/date or stays silent if none.

**Outreach** — deterministic templates from real row data now; LLM only for shown
leads, grounded in stored facts/signals (P0 dispatch fix + vertical mapper pending).

## 5. Next stages (each needs approval)

Split → S3 `processed/`+`incomplete/` → normalize → index → investor-loader +
outreach fixes → signal layer → random-search test battery.
