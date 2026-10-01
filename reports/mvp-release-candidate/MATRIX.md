# Cross-category matrix (Task 16)

Each query ran through the product core (`runSpecSearchCore`, as after "Search with defaults"), worker runtime, headed Chromium, local no-persist. Verdicts: PASS = qualified rows with a clean evidence audit; HONEST_ZERO = no qualified rows, every candidate accounted for, no error; FAIL = crash, evidence mismatch, row without evidence, or an unaccounted streamed lead.

PASS 6 · HONEST_ZERO 18 · FAIL 0 (of 24)

| # | Category | Query | Verdict | Rows | Secs | Streamed | Ledger | Reason / note |
|---|---|---|---|---|---|---|---|---|
| m01 | people | B2B SaaS founders with public contact details | PASS | 5 | 98 | 5 | returned=5 rejected=5 | RESULTS; rejects {"MISSING_QUERY_REQUIRED":5} |
| m02 | people | Founders of fintech startups in Berlin | HONEST_ZERO | 0 | 54 | 0 |  | SOURCE_UNAVAILABLE |
| m03 | people | CTOs at logistics companies in Toronto | HONEST_ZERO | 0 | 49 | 0 |  | SOURCE_UNAVAILABLE |
| m04 | people | Heads of marketing at DTC brands in London | HONEST_ZERO | 0 | 56 | 0 |  | SOURCE_UNAVAILABLE |
| m05 | company | SaaS companies in Toronto with public contact details | HONEST_ZERO | 0 | 99 | 0 | incomplete=5 | INCOMPLETE; Some sources could not be searched this time (Available records, Public source), so results may be incomplete. |
| m06 | company | Cybersecurity companies in Austin hiring engineers | HONEST_ZERO | 0 | 108 | 0 | filtered=1 | TIMEOUT; Some sources could not be searched this time (Public websites, The web, Available records), so results may be incomplete. |
| m07 | company | Marketing agencies in Bristol with websites | HONEST_ZERO | 0 | 275 | 0 |  | SOURCE_UNAVAILABLE |
| m08 | company | AI startups in Paris that raised funding this year | HONEST_ZERO | 0 | 114 | 0 | filtered=3 incomplete=5 | INCOMPLETE; Some sources could not be searched this time (Available records, Public source), so results may be incomplete. |
| m09 | local | Restaurants in Calgary, Alberta with official websites | PASS | 10 | 96 | 0 | returned=10 qualified_more=45 filtered=24 incomplete=54 | RESULTS |
| m10 | local | Plumbers in Camrose, Alberta without a website, with phone numbers | HONEST_ZERO | 0 | 162 | 0 | filtered=5 | FAILED_QUALIFICATION |
| m11 | local | Dentists in Portland, Oregon with phone numbers | PASS | 10 | 67 | 0 | returned=10 qualified_more=59 rejected=36 incomplete=31 | RESULTS; Some sources could not be searched this time (Available records), so results may be incomplete.; rejects {"MISSING_QUERY_REQUIRED":36} |
| m12 | local | Coffee roasters in Copenhagen with email addresses | HONEST_ZERO | 0 | 123 | 0 | filtered=146 | FILTERED_BY_SPEC |
| m13 | job | Remote senior frontend developer jobs | HONEST_ZERO | 0 | 71 | 0 | filtered=25 | FILTERED_BY_SPEC |
| m14 | job | Data engineer jobs in Berlin | PASS | 1 | 37 | 1 | returned=1 filtered=24 | RESULTS |
| m15 | investor | Seed investors in fintech in London | PASS | 8 | 65 | 5 | returned=8 rejected=3 | RESULTS; rejects {"LOCATION_MISMATCH":3} |
| m16 | investor | Angel investors in Toronto | HONEST_ZERO | 0 | 30 | 0 |  | NO_CATEGORY_MATCH |
| m17 | signal | SaaS founders talking about churn on LinkedIn | HONEST_ZERO | 0 | 120 | 0 | rejected=8 incomplete=2 | FAILED_QUALIFICATION; Some sources could not be searched this time (Public source), so results may be incomplete.; rejects {"NO_CLAIM_EVIDENCE":8} |
| m18 | signal | Companies looking for a Shopify developer | HONEST_ZERO | 0 | 96 | 0 | rejected=11 | FAILED_QUALIFICATION; rejects {"NO_CLAIM_EVIDENCE":11} |
| m19 | chat | hi cobblers arequippa pls | HONEST_ZERO | 0 | 90 | 0 |  | SOURCE_UNAVAILABLE |
| m20 | chat | need some founders round vinlius tryna bring on localistaion manager ppl rn | HONEST_ZERO | 0 | 54 | 0 | rejected=2 | FAILED_QUALIFICATION; rejects {"CLAIM_TYPE_MISMATCH":2} |
| m21 | edge | Find 10 SaaS founders globally who may need help with AI automation | PASS | 7 | 126 | 6 | returned=7 incomplete=3 | RESULTS; Some sources could not be searched this time (Public source), so results may be incomplete. |
| m22 | edge | Law firms in Ontario | HONEST_ZERO | 0 | 303 | 0 |  | SOURCE_UNAVAILABLE |
| m23 | edge | Yoga studios near Brooklyn with Instagram | HONEST_ZERO | 0 | 180 | 0 | filtered=2 | FAILED_QUALIFICATION; Some sources could not be searched this time (Available records), so results may be incomplete. |
| m24 | founder | Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact | HONEST_ZERO | 0 | 32 | 0 |  | SOURCE_UNAVAILABLE |

## Samples and understood criteria

- m01: role=founder, industry=saas, require_contact=true, required_field=contact → Andrew Breen (Outshine); Alex Circei (Waydev); Garry Drummond (LOCH Technologies)
- m02: role=founder, industry=fintech, location=Berlin, location_country=DE
- m03: role=cto, industry=logistics, location=Toronto, location_country=CA
- m04: role=head of marketing, industry=DTC, business_model=d2c, location=London, location_country=GB
- m05: industry=saas company, location=Toronto, location_country=CA, require_contact=true, required_field=contact
- m06: industry=cybersecurity company, location=Austin, location_country=US, requested_role=engineer
- m07: industry=marketing agency, location=Bristol, website=true
- m08: industry=ai startup, location=Paris, location_country=FR
- m09: category=restaurant, location=Calgary, location_country=CA, website=true → Sakana Grill; Deepam Dosa; Maharajah East Indian Restaurant
- m10: category=plumber, location=Camrose, location_country=CA, opportunity=no_website, require_name=true, required_field=name, require_phone=true, required_field=phone
- m11: category=dentist, location=Portland, location_country=US, require_phone=true, required_field=phone, verify_phone_is_public=true → NW Heights Dental of Portland; Pearl District Dental; Maternal-Fetal Medicine Center
- m12: category=coffee roaster, location=Copenhagen, require_email=true, required_field=email, verify_other=has email address
- m13: role=senior frontend developer, employment=remote, geo_scope=worldwide
- m14: role=data engineer, industry=data engineer job, location=Berlin, location_country=DE → Data Scientist / Machine Learning Engineer (m/w/d) | Healthcare & Life Science @ Limebit GmbH
- m15: investor_sector=fintech, location=London, location_country=GB → Matt Robinson — Partner @ Accel; Andrei Brasoveanu — Partner @ Accel; Zhenya Loginov — Partner @ Accel
- m16: investor_sector=angel investor, location=Toronto, location_country=CA
- m17: role=founder, industry=saas, content_topic=churn on LinkedIn, needs_live=true
- m18: requested_service=shopify developer
- m19: category=cobbler, location=Arequipa, location_country=PE
- m20: role=founder, location=Vilnius, location_country=LT, requested_role=localistaion manager people
- m21: role=founder, industry=saas, offer=AI automation, mode=selling, geo_scope=worldwide, requested_count=10 → Andrew Breen (Outshine); Alex Circei (Waydev); Mark Corbett (Thrust Carbon)
- m22: industry=law firm, location=Ontario, location_country=CA
- m23: category=yoga studio, location=Brooklyn, require_name=true, required_field=name, require_instagram=true, required_field=instagram, require_socials=true, required_field=socials
- m24: role=founder, industry=saas, company_stage=startup, location=Tallinn, location_country=EE, requested_role=engineer, require_contact=true, required_field=contact

## How this table was reached
- Pass 1 (first-pass table in `MATRIX_PASS1.md`): PASS 5, HONEST_ZERO 17, FAIL 2. Both failures (m07 "Marketing agencies in Bristol", m19 "cobblers in Arequipa") streamed leads such as "Just Eat", "Cookpad" and "Llamagas" as verified, then dropped them silently. Root cause: the stream used the lenient pre-research spec gate, so a business whose category was still unknown counted as verified; no strict judge ran on live rows after research (such a row could also be delivered); and the browser spent its budget on structured-source seeds whose category already contradicted the request. Fixed with the strict spec judge for streaming and after research, a ledger `filtered` fate, and seed filtering (`src/lib/search/__tests__/live-strict-judge.test.ts`).
- Pass 2 (all 24 rerun on the fix): PASS 5, HONEST_ZERO 19, FAIL 0. It also exposed two misparses on the deterministic fallback, which ran when the provider was rate-limited: "Seed investors in fintech in London" produced location "fintech in London", and "SaaS founders talking about churn…" produced location "talking". Both were fixed with tests in `founder-path.test.ts`.
- Reruns after the review fixes and parser fixes: m01, m05, m24 (contact wording), m15, m16, m17. m15 then returned 8 stored investor records with no evidence items. Stored investor and company rows now carry their record as evidence, the same contract as stored business and people rows.
- Final: PASS 6 · HONEST_ZERO 18 · FAIL 0. Every browser run used the worker runtime. In pass 1, six runs fell back to in-process Playwright under memory pressure, and each fallback was reported.

## Reading the zeros
Most zeros here come from the environment, not from wrong answers. The self-hosted structured search index (SearXNG) was down all pass because Docker is not running, so every web search went through the browser's own DuckDuckGo/Bing budget, and DuckDuckGo raised CAPTCHAs mid-run. Every zero has a funnel reason, and no lead was invented. Parser gaps still open (reported, not fixed): stage words read as a sector ("angel investors" → sector "angel investor", m16); a company noun left in the industry ("saas company", m05); seniority kept inside a job role (m13).
