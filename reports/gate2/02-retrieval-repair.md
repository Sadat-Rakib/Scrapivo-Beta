# Gate 2B stored retrieval repair

Date: 2026-09-19

## Outcome

Stored retrieval now returns verified people, companies, businesses, and investors without live-source substitution. Final certification produced 19 PASS and 9 VALID_EMPTY cases, with no BUG, WRONG_RESULT, or TIMEOUT cases. Three additional special-case probes passed: no-website, email-and-phone required, and a location-less constrained person search.

## Root causes and fixes

### People

Before: six direct S3 probes returned zero candidates.

Root causes:

1. City queries could be routed as country partition names. `location_kind` and `location_country` were not consistently used to separate country pruning from city filtering.
2. Role extraction recognized person entities but omitted their role for common titles. `designer`, `software engineer`, and `sales manager` entered the person path without a role. `copywriter` was not a person noun.
3. Final validation used raw substring matching rather than the reader's token/plural-aware role matcher.
4. Country-wide founder index queries used `%founder%` plus quality ordering. Without a country-role index this could hit the database statement timeout.

Fixes:

- Country partitions now resolve from country name, abbreviation, or ISO. City searches use the city filter inside the resolved country shard.
- Open role extraction now covers writers/copywriters and common compound roles. Final validation reuses `personRoleMatches`.
- Founder index queries use exact normalized `role_norm = 'founder'`.
- Proposed migration adds country-role and trigram indexes. It was not applied in production.

After:

- Direct S3: founder Canada 6/6, copywriter US 6/6, software engineer India 6/6, designer UK 6/6, sales Singapore 6/6.
- Indexed certification: founders Canada 50, copywriters Canada 1, designers London 3, sales managers New York 37.
- Software engineers Toronto is VALID_EMPTY: the CA shard scanned all 16,904 rows and contained no match.
- Location-less `copywriters` returned 5 qualified rows after a bounded, size-ordered 12-shard scan.

### Companies

Before: S3 returned 12 candidates across six probes, then zero usable rows.

Root causes:

1. The local JSONL company loader hard-coded email, phone, and LinkedIn to null. Those fields therefore disappeared before indexed retrieval even though S3 parquet populated them.
2. Query vocabulary did not match physical categories: `SaaS` versus `Software`, `Healthcare` versus `Health Care`, and unsafe two-character `AI` substring matching.
3. Company identity and contact fields needed to survive canonical mapping before completeness and qualification.
4. Physical company location has only 69 coarse labels. It does not support arbitrary city claims.

Fixes:

- `to_pg_company_parquet` maps physical website, email, phone, LinkedIn, category, description, and quality fields.
- S3 and index mappers preserve website/email/phone through sanitize, completeness, and qualification.
- Shared category aliases map SaaS/software, AI/artificial intelligence, healthcare/health care, fintech, and e-commerce without broad substring errors.
- Index category queries use an OR over safe aliases.

After:

- Golden company `S & A` was rediscovered from its name partition with website, email, phone, location, and category preserved.
- Healthcare companies Chicago returned 4 indexed rows.
- AI Toronto, SaaS London, construction Calgary, and manufacturing Pune are VALID_EMPTY under current stored location coverage.
- Data-derived count: 682,555 company rows are safely US-routable; 919,586 have macro/unmapped locations. No CA/GB/IN city-level claims are justified by this corpus.

### Businesses

Root causes:

- Gazetteer fallback could select noisy country files for namesake places.
- ASCII-only normalization broke diacritic routing.
- Large-file ordering could spend the scan budget on the wrong country.
- Category variants and plurals did not share one matcher.

Fixes:

- Gazetteer routing constrains country queries to ISO stems and city queries to the known home country.
- Locality equality is Unicode-safe and diacritic-normalized.
- Exact city filtering occurs during the scan. No global fallback scan is allowed.
- Category families and craft normalization are shared by S3, index, and final validation.
- No-website opportunity is preserved before completeness. Explicit email/phone requirements are pushed into index candidate supply.

After:

- Golden Austin restaurant search returned 5 rows after scanning 93 rows.
- Restaurants Austin returned 50; plumbers Pune returned 13.
- São Paulo restaurants returned 4 display-ready rows; 2 more remained pending enrichment.
- HVAC Toronto and dentists Edmonton are VALID_EMPTY after their correct country partitions were checked.

### Investors

The 8,076-row S3 file is small enough for direct filtered reads. No index is justified yet.

- SaaS: 50
- AI: 50
- seed: 50
- fintech: 50
- Golden `Aaref Hilaly`: rediscovered exactly

## Completeness, quantity, and diagnostics

- Retrieval trace records raw candidates, post-spec rows, complete rows, pending enrichment, qualification rejects, returned rows, and a typed zero reason.
- Added zero reasons include `NO_INDEX_COVERAGE`, `NO_CATEGORY_MATCH`, and `NO_ROLE_MATCH` while retaining partition, location, timeout, source, completeness, and qualification reasons.
- Optional contact fields do not reject a valid person with another public contact route.
- Explicit email/phone requirements remain mandatory and are pushed into indexed candidate selection.
- Page size is separate from candidate supply. Austin restaurants returned 50 from a 51-row probe and reported `hasMore=true`; `totalAvailable` remains null.

## Test matrix

Certification artifact: `reports/gate2/02-retrieval-certification.json`.

- PASS: 19 certification cases plus 3 special probes.
- VALID_EMPTY: 9.
- BUG: 0.
- WRONG_RESULT: 0.
- TIMEOUT: 0.

Special cases:

- Quantity 50: PASS, 50 returned, `hasMore=true`.
- No website: PASS, 10 qualified, no pending enrichment.
- Email and phone required: PASS, 7 qualified; 4 candidates rejected after phone/contact verification.
- Diacritic location: PASS, 4 returned for São Paulo.
- Location-less constrained person: PASS, 5 returned.
- Excluded-location and radius semantics remain parser-level limitations; no false stored rows were certified for them.

Final regression suite: 151 tests passed across 10 files. An earlier contact-regex failure was found and fixed.

## Performance

- Indexed matrix: usually 116-946 ms; slowest successful cold query 3.68 s.
- Golden S3: person 5.51 s, company 9.31 s, business 7.76 s, investor 1.05 s.
- Empty HVAC Toronto S3 fallback: 16.43 s for 400,000 rows.
- Location-less copywriter S3 scan: 15.09 s for 299,372 rows.
- São Paulo diacritic fallback: 49.13 s for 1,039,334 rows.

The slow cases remain partition-bounded, not global scans. Expanding the hot index is the latency fix; increasing scan limits is not.

## Index decision

Use Postgres candidate index first, S3 canonical fallback second, and live retrieval only for genuine stored-data gaps. Keep investors on S3 until query volume or latency evidence justifies `idx_investors`.

Current coverage:

- businesses: 609,387 / 16,338,186 physical
- companies: 79,014 / 1,602,141 physical
- people: 399,397 / 484,325 physical
- investors: no index / 8,076 physical

Production schema migration and large backfills were not run.

## Remaining limitations

- Company corpus uses coarse geographic labels; 919,586 rows cannot support city-level search without a better source.
- Business S3 fallback can still take 16-49 seconds on million-row country shards.
- Radius and negative-location constraints are not represented in current `SearchSpec`.
- Marketing agencies route to company taxonomy, not local-business taxonomy. No Gate 1 semantic change was made.
- Jobs remain without a stored corpus and are outside Gate 2B.
