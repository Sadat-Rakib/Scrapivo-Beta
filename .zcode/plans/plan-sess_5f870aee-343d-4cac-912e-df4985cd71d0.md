# FIX-ROUND-3 — directory-intent routing, hallucination filters, drawer polish, CSV datasets

All root causes identified from the Pune screenshots + prior verified evidence. Build order 1→6, verify each step (tsc + tests + probes) before the next.

## 1. Directory-intent → local vertical (the "Pune" question bug)
Root cause: "find me businesses in Pune without websites" gets `intentMode = directory_smb` correctly (entity noun "businesses", no demand verb), but the VERTICAL detector (`isLocalBusinessHunt`) only matches "local businesses" phrases/trade words — "businesses" alone misses → generic plan lines ("scanning company pages…") + generic questions (years of experience / ideal buyer) fired.
- Export `isDirectoryQuery` from query-classifier; `resolveSearchVertical` maps directory intent (business/company/firm/agency nouns, no demand verb, no investor marker) → **"local"**. Fixes plan lines ("scanning local directories…") for every "businesses/companies/agencies in X" query.
- `buildClarifyingQuestions` local gate becomes `isLocalBusinessHunt(classified) || isDirectoryQuery(classified)` → the opportunity-filter question fires instead of experience/ideal-buyer. Geography skipped when a place is stated (Pune ✓).
- `prepareDynamicQuestions` needs no change — it routes via `resolveSearchVertical`.

## 2. Hallucination filters for local results (wrong businesses, wrong phones)
Root cause: the DB returned 0 for Pune (craft "website" matched no category → no location-only fallback) → live web rows blended in unfiltered: digital-marketing agencies WITH websites, US phone prefixes on Indian businesses.
- **Two-pass DB fallback** in the file source: pass 1 = craft+location; if too few rows, pass 2 = location-only (+ opportunity filter, city bonus) — "businesses in Pune without websites" then returns Pune businesses WITHOUT websites of any category.
- **Opportunity filter applied to the merged directory branch**: `no_website` drops live rows that have a website; `has_phone`/`sales_ready` similarly (refs already flow via prefs.localOpportunity).
- **Phone-country sanity**: when the query country is known (city map gives ISO2), a phone whose prefix contradicts it (+1 on an Indian business) is dropped from the row — never shown.
- Web-boolean rows stay OUT of the Local segment (they're posts) — verify and keep.

## 3. Local drawer: real About + readability
- **Composed About**: replace the address-dump with a sentence built from structured fields — "{Category} business in {City}{, Region}" + an evidence line from the tags ("No website found — reachable by phone/email instead."), never fabricated.
- **Readability polish**: larger business name, category as a colored chip, section grouping (Business / Contact / Opportunity), tag pills restyled, more spacing — targeted styling only.

## 4. Jobs relevance (wrong "jobs" cards)
- In the JOB_DISCOVERY merge, job-native leads (jobcatalog, freehire, ATS boards) get a ranking boost so they outrank generic web-search cards; web-search rows that aren't job-URL-shaped get demoted for jobs-goal queries.

## 5. Your CSV datasets — yes, hand them over
- New importer `scripts/pipeline/sources/csv_people.py` + runner: drop your per-country CSVs in `data/imports/` and it maps the exact schema from your Albania sample (Full name, Industry, Job title, Emails, Mobile/Phone, Company Name/Website/Industry/Size, Location/Locality/Region/Country, LinkedIn/Facebook/Twitter/GitHub URLs, Skills, Summary, Years Experience) into `PersonRecord` rows → merged into `data/people_complete.jsonl` (dedupe by LinkedIn slug), companies parsed into `companies_complete.jsonl` where present. Old data is fine — provenance + confidence mark it.
- People DB blend: people-vertical queries blend `people_complete.jsonl` rows into the People segment (investor-branch pattern), so your CSV people become first-class results.

## 6. Verification
tsc + tests after each step; server probes: the exact Pune query (file source two-pass + filters), Camrose, London, Berlin; then browser E2E: plan lines/questions for "find me businesses in Pune without websites", Local section quality (no websites, right country phones), drawer About + readability, jobs results relevance, transcript two-input behavior.

Sources already researched for templates remain in use; the local pitch drafts will consume the new no_website tag directly.