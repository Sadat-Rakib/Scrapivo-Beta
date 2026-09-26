# Gate 2A — Full Data Coverage & Inventory Audit

Audit date: 2026-09-18. This is a read-only inventory assembled from S3 object listings, Parquet footers/full-column scans already captured in the audit artifacts, read-only PostgREST counts, and an 18-query representative retrieval probe. Metrics are labelled by evidence strength; no sampled metric is presented as an exact corpus total.

## Executive answer

Scrapivo physically owns four measured logical corpora in S3: 16,338,186 local businesses, 1,602,141 companies, 484,325 people, and 8,076 investors. The company and people single-file objects duplicate the respective partitioned logical row counts and are not added again. The application-accessible Postgres index is materially thinner for businesses and companies, unavailable for investors/jobs, and the representative direct-S3 retrieval path produced usable output only for 2 of 6 local-business probes.

## Evidence and physical inventory

| Corpus | S3 objects | Physical rows | Size | Status |
| --- | ---: | ---: | ---: | --- |
| Local businesses | 91 | 16,338,186 **EXACT** | 1,793,647,463 bytes | `processed/local-businesses/by_country/` |
| Companies | 110 | 1,602,141 **EXACT** | 355,129,771 bytes | `processed/companies_by_initial/` |
| People | 362 | 484,325 **EXACT** | 62,039,368 bytes | `processed/people_by_country/` |
| Investors | 1 | 8,076 **EXACT** | 1,844,423 bytes | `processed/investors/investor.parquet` |
| Companies single-file copy | 1 | 1,602,141 **EXACT** | 354,965,502 bytes | duplicate logical row count; not additive |
| People single-file copy | 1 | 484,325 **EXACT** | 67,787,388 bytes | duplicate logical row count; not additive |
| Gazetteer | 1 JSON object | 199,113 locality keys **EXACT** | 4,683,692 bytes | 90 country keys |
| Jobs | none under `processed/` **EXACT** | no stored corpus found | — | live-only / unavailable as stored data |

S3 access was successful through read-only LIST/HEAD/RANGE GET. The `processed/` root contained no jobs prefix. No S3 writes were performed.

## Local businesses

- 16,338,186 rows **EXACT** across 90 countries, 248,031 distinct locality values, and 1,939 categories.
- Geography is broad but uneven: the largest country partitions are US 2,093,733; Brazil 2,000,000; India 2,000,000. The full city count is exact; top-city counts are available in the supporting profile artifact.
- Website: 10,086,954 (61.74%) **EXACT**; no website: 6,251,232 (38.26%) **EXACT**; phone: 12,139,621 (74.30%) **EXACT**; email: 0 (0%) **EXACT**; at least one observed contact channel: 14,171,719 (86.74%) **EXACT**.
- Junk-flagged: 650,371 (3.98%) **EXACT**. This is a source flag, not a validated quality score.
- Duplicate registry-id rows: 302 **EXACT**. Domain non-uniqueness has an upper-bound signal of 10,491,009 rows; it is not a deduplicated business count.
- Routability: 228,206 of 248,030 unique locality values match gazetteer keys (92.01%) **EXACT**; 19,824 locality values / 1,590,564 rows are unmatched **EXACT**. Non-Latin locality spellings are prominent in the unmatched examples.
- Category completeness: 96.83% in the 455,000-row bounded per-file profile **SAMPLED**. Phone 67.85%, website 52.30%, and any contact 79.90% in that same profile are **SAMPLED**; exact global field totals above supersede them where available.

## Companies

- 1,602,141 rows **EXACT**; 69 distinct `location` strings and 515,607 distinct category strings **EXACT**. Locations are frequently macro/metro labels rather than normalized country/city, so country/city coverage is **UNKNOWN** as a standalone physical field.
- Website, email, and phone are populated on all 1,602,141 rows **EXACT**; LinkedIn on 1,446,814 (90.31%) and another social on 1,302,165 (81.28%) **EXACT**. Presence is not deliverability/uniqueness.
- Description: 1,602,140 rows; funding value: 93,670 (5.85%) **EXACT**. No reliable physical-stage or technology coverage metric was present in the completed profile; both are **UNKNOWN**.
- One duplicate external id and 551 extra repeated nonblank website rows were measured **EXACT**.
- Common category strings include Dental/Health Care/Medical, Information Technology/Software, Real Estate, Manufacturing, and Education. Category strings serve as the available industry/category representation; separate normalized industry/niche fields are **UNKNOWN**.

## People

- 484,325 rows **EXACT**, spanning 219 countries, 10,144 cities, 110,732 titles, and 168 industries **EXACT**.
- All rows have company/employer, website, email, and phone fields populated **EXACT**. Personal or company LinkedIn is present on 484,307 (99.996%); another social on 415,967 (85.89%) **EXACT**. The bounded profile specifically finds personal LinkedIn on 89.89% **EXACT** over the same corpus scan.
- Title is the role/title representation; a separate normalized role/niche/category column is **UNKNOWN** in physical S3.
- Measured duplicate signals: 84,969 extra rows sharing a personal-LinkedIn value and 369,272 extra rows sharing a website **EXACT**. Shared employer websites are expected, so neither metric is a person-duplicate count.
- Largest country coverage is United States 351,216, followed by India 25,048 and Canada 16,904. Common titles include Financial Advisor, Owner, CEO, President, Founder, and Manager; financial services is the largest industry.

## Investors

- 8,076 rows **EXACT**, 7,439 individual and 637 firm records; 240 raw country values and 560 cities **EXACT**. These are heterogeneous geography strings (countries, states, regions, unknown), not clean ISO-country coverage.
- Website 7,485 (92.68%); email 2,458 (30.44%); LinkedIn 7,438; bio 4,240; sectors 5,262; stages 5,334; check size 4,002 **EXACT**.
- Sector and stage data exist; top sectors include Fintech, SaaS, Consumer, AI, Enterprise, and Health. IDs have no duplicates; repeated website and LinkedIn values are source-level signals only.
- `idx_investors` is absent (HTTP 404), so current indexed retrieval coverage is 0 **EXACT**. No investor retrieval probe was run because no index/backend was exposed.

## Jobs

No persistent jobs corpus was found: S3 `processed/` has no jobs prefix and `idx_jobs` returns HTTP 404 **EXACT**. Jobs are therefore live-only / unavailable as stored data. Stored title, location, company, date, salary, and URL coverage are **UNKNOWN** because there are no stored job rows to measure.

## S3 versus Postgres index

| Entity | S3 physical rows | `idx_*` rows | Indexed share of S3 | Important index field coverage |
| --- | ---: | ---: | ---: | --- |
| Local businesses | 16,338,186 **EXACT** | 609,387 **EXACT** | 3.73% | country/city 100%; category 96.31%; website 73.51%; phone 82.64%; email 0% |
| Companies | 1,602,141 **EXACT** | 79,014 **EXACT** | 4.93% | country 99.97%; city 89.87%; category 6.06%; website 6.05%; email/phone 0% |
| People | 484,325 **EXACT** | 399,397 **EXACT** | 82.46% | country/role 100%; city 26.51%; email/phone 100%; LinkedIn 100% |
| Investors | 8,076 **EXACT** | unavailable (404) | 0% | no index |
| Jobs | none | unavailable (404) | — | no corpus/index |

Postgres index access was successful for businesses, companies, and people through read-only HTTP counts. Country aggregation profiling returned HTTP 400, so index country distributions are **UNKNOWN**.

## Current effective retrieval coverage

The completed 18-query matrix intentionally forced the S3-Parquet path (`USE_INDEXED_SEARCH=false`) and disabled live gapfill implementation. It is a **SAMPLED** reachability test, not a census or a test of every production flag.

| Entity | Queries | Any S3 DB hit | Stored candidates | Complete usable / returned | Readout |
| --- | ---: | ---: | ---: | ---: | --- |
| Local businesses | 6 | 3 | 12 | 10 / 10 | Only Austin restaurants and Pune plumbers returned five each; other ready queries were empty or incomplete. |
| People | 6 | 0 | 0 | 0 / 0 | No usable result; four queries requested live gapfill and two stopped at clarification. |
| Companies | 6 | 2 | 12 | 0 / 0 | Two queries found six candidates each but none passed complete/usable output. All six requested live gapfill. |

Thus the stored corpus is much larger than the demonstrably reachable-and-usable corpus. The probe's effective output was 10 local-business results; this is **SAMPLED / LOWER BOUND**, not an estimate of all retrievable rows.

## Current ingestion behavior

The audit observed S3 partitioned corpora plus duplicate single-file people/company copies and thin `idx_*` tables. No ingestion, persistence, loader, or feature-flag mutation was performed. The audit cannot establish freshness cadence, provenance, or whether the index is intentionally sampled; those are **UNKNOWN** from read-only artifacts.

## Biggest factual coverage gaps

1. No stored jobs corpus or jobs index.
2. Investor corpus is physically present but has no retrieval index.
3. Company physical geography is 69 coarse location strings; normalized country/city and structured stage/technology coverage are not established.
4. Local-business email is exactly zero; 38.26% have no website and 1.59m rows carry non-routable locality strings.
5. Person/company contact fields are highly populated but strongly shared/repeated, so field presence overstates unique actionable-contact coverage.

## Biggest retrieval bottlenecks

1. Index-to-S3 coverage is only 3.73% for businesses and 4.93% for companies.
2. No investor/jobs indexes exist.
3. The sampled direct-S3 person path returned zero candidates across all six probes.
4. Company candidates fail the complete/usable gate even when S3 yields candidates.
5. Location normalization/routability is incomplete, especially for non-Latin locality spellings; the direct S3 path also scanned all 1.6m company rows for an unsuccessful Bergen query.

## Supporting artifacts

- `reports/gate2/_s3-metadata.json`
- `reports/gate2/_profiles.json`
- `reports/gate2/_business-profile.json`
- `reports/gate2/_company-profile.json`
- `reports/gate2/_people-profile.json`
- `reports/gate2/_investor-profile.json`
- `reports/gate2/_gazetteer-profile.json`
- `reports/gate2/_postgres-counts.json`
- `reports/gate2/_postgres-profile.json`
- `reports/gate2/_retrieval-probes.json`
