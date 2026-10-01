# Cross-category matrix (Task 16)

Each query ran through the product core (`runSpecSearchCore`, as after "Search with defaults"), worker runtime, headed Chromium, local no-persist. Verdicts: PASS = qualified rows with a clean evidence audit; HONEST_ZERO = no qualified rows, every candidate accounted for, no error; FAIL = crash, evidence mismatch, row without evidence, or an unaccounted streamed lead.

PASS 5 · HONEST_ZERO 17 · FAIL 2 (of 24)

| # | Category | Query | Verdict | Rows | Secs | Streamed | Ledger | Reason / note |
|---|---|---|---|---|---|---|---|---|
| m01 | people | B2B SaaS founders with public contact details | PASS | 2 | 121 | 2 | returned=2 rejected=2 incomplete=6 | RESULTS; Some sources could not be searched this time (Public source), so results may be incomplete.; rejects {"MISSING_QUERY_REQUIRED":2} |
| m02 | people | Founders of fintech startups in Berlin | HONEST_ZERO | 0 | 39 | 0 |  | SOURCE_UNAVAILABLE |
| m03 | people | CTOs at logistics companies in Toronto | HONEST_ZERO | 0 | 94 | 0 |  | SOURCE_UNAVAILABLE |
| m04 | people | Heads of marketing at DTC brands in London | HONEST_ZERO | 0 | 37 | 0 |  | SOURCE_UNAVAILABLE |
| m05 | company | SaaS companies in Toronto with public contact details | HONEST_ZERO | 0 | 93 | 0 | rejected=1 incomplete=5 | FAILED_QUALIFICATION; Some sources could not be searched this time (Available records, Public source), so results may be incomplete.; rejects {"MISSING_QUERY_REQUIRED":1} |
| m06 | company | Cybersecurity companies in Austin hiring engineers | HONEST_ZERO | 0 | 92 | 0 | rejected=3 | TIMEOUT; Some sources could not be searched this time (Public websites, The web, Available records), so results may be incomplete.; rejects {"PROVISIONAL_ENTITY":3} |
| m07 | company | Marketing agencies in Bristol with websites | FAIL | 0 | 130 | 4 | unaccounted=4 | 4 streamed lead(s) unaccounted; FILTERED_BY_SPEC; Some sources could not be searched this time (Available records), so results may be incomplete. |
| m08 | company | AI startups in Paris that raised funding this year | HONEST_ZERO | 0 | 98 | 0 | rejected=3 | TIMEOUT; Some sources could not be searched this time (Public websites, The web, Available records), so results may be incomplete.; rejects {"PROVISIONAL_ENTITY":3} |
| m09 | local | Restaurants in Calgary, Alberta with official websites | PASS | 10 | 83 | 0 | returned=10 qualified_more=36 | RESULTS; Some sources could not be searched this time (Available records), so results may be incomplete. |
| m10 | local | Plumbers in Camrose, Alberta without a website, with phone numbers | HONEST_ZERO | 0 | 132 | 0 | rejected=3 | FAILED_QUALIFICATION; rejects {"NO_CLAIM_EVIDENCE":2,"CLAIM_PARAMETER_MISMATCH":1} |
| m11 | local | Dentists in Portland, Oregon with phone numbers | PASS | 10 | 65 | 0 | returned=10 qualified_more=59 rejected=36 incomplete=31 | RESULTS; Some sources could not be searched this time (Available records), so results may be incomplete.; rejects {"MISSING_QUERY_REQUIRED":36} |
| m12 | local | Coffee roasters in Copenhagen with email addresses | HONEST_ZERO | 0 | 141 | 0 |  | FILTERED_BY_SPEC |
| m13 | job | Remote senior frontend developer jobs | HONEST_ZERO | 0 | 131 | 0 |  | FILTERED_BY_SPEC |
| m14 | job | Data engineer jobs in Berlin | PASS | 2 | 128 | 0 | returned=2 | RESULTS; Some sources could not be searched this time (Public websites), so results may be incomplete. |
| m15 | investor | Seed investors in fintech in London | HONEST_ZERO | 0 | 110 | 0 |  | TIMEOUT; Some sources could not be searched this time (Public websites), so results may be incomplete. |
| m16 | investor | Angel investors in Toronto | HONEST_ZERO | 0 | 111 | 0 |  | TIMEOUT; Some sources could not be searched this time (Public websites), so results may be incomplete. |
| m17 | signal | SaaS founders talking about churn on LinkedIn | HONEST_ZERO | 0 | 19 | 0 |  |  |
| m18 | signal | Companies looking for a Shopify developer | HONEST_ZERO | 0 | 100 | 0 | rejected=11 | FAILED_QUALIFICATION; rejects {"NO_CLAIM_EVIDENCE":11} |
| m19 | chat | hi cobblers arequippa pls | FAIL | 0 | 131 | 1 | unaccounted=1 | 1 streamed lead(s) unaccounted; FILTERED_BY_SPEC |
| m20 | chat | need some founders round vinlius tryna bring on localistaion manager ppl rn | HONEST_ZERO | 0 | 78 | 0 | rejected=2 | FAILED_QUALIFICATION; rejects {"CLAIM_TYPE_MISMATCH":2} |
| m21 | edge | Find 10 SaaS founders globally who may need help with AI automation | PASS | 10 | 124 | 10 | returned=10 | RESULTS |
| m22 | edge | Law firms in Ontario | HONEST_ZERO | 0 | 263 | 0 |  | TIMEOUT; Some sources could not be searched this time (Public websites, The web), so results may be incomplete. |
| m23 | edge | Yoga studios near Brooklyn with Instagram | HONEST_ZERO | 0 | 124 | 0 |  | FILTERED_BY_SPEC; Some sources could not be searched this time (Available records), so results may be incomplete. |
| m24 | founder | Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact | HONEST_ZERO | 0 | 54 | 0 |  | SOURCE_UNAVAILABLE; Some sources could not be searched this time (Available records), so results may be incomplete. |

## Samples and understood criteria

- m01: role=founder, industry=saas, require_contact=true, required_field=contact → Andrew Breen (Outshine); Alex Circei (Waydev)
- m02: role=founder, industry=fintech, company_stage=startup, location=Berlin, location_country=DE
- m03: role=cto, industry=logistics, location=Toronto, location_country=CA
- m04: role=head of marketing, industry=DTC, business_model=d2c, location=London, location_country=GB
- m05: industry=SaaS, location=Toronto, location_country=CA, require_contact=true, required_field=contact
- m06: industry=cybersecurity, location=Austin, location_country=US
- m07: category=marketing agency, location=Bristol, website=true
- m08: industry=AI, company_stage=startup, location=Paris, location_country=FR
- m09: category=restaurant, location=Calgary, location_country=CA → Boston Pizza; Great Taste Chinese; Big T's BBQ & Smokehouse
- m10: category=plumber, location=Camrose, location_country=CA, opportunity=no_website, require_phone=true, required_field=phone, verify_no_owned_website=true
- m11: category=dentist, location=Portland, location_country=US, require_phone=true, required_field=phone → NW Heights Dental of Portland; Pearl District Dental; Maternal-Fetal Medicine Center
- m12: category=coffee roaster, location=Copenhagen, require_name=true, required_field=name, require_email=true, required_field=email
- m13: role=senior frontend developer, employment=remote, geo_scope=worldwide
- m14: role=data engineer, location=Berlin, location_country=DE → Data Engineer @ zetaglobal; Senior Data Platform Engineer @ Andercore
- m15: investor_sector=seed investor, location=London, location_country=GB
- m16: investor_sector=angel investor, location=Toronto, location_country=CA
- m17: role=founder, industry=saas, employment=remote, geo_scope=worldwide, content_topic=churn on LinkedIn, needs_live=true
- m18: requested_service=Shopify developer
- m19: category=cobbler, location=Arequipa
- m20: role=founder, location=Vilnius, location_country=LT, requested_role=localization manager
- m21: role=founder, industry=SaaS, offer=AI automation, mode=selling, geo_scope=worldwide, requested_count=10 → Andrew Breen (Outshine); Alex Circei (Waydev); Mark Corbett (Thrust Carbon)
- m22: industry=law firm, location=Ontario, location_country=CA
- m23: category=yoga studio, location=Brooklyn, require_instagram=true, required_field=instagram, require_socials=true, required_field=socials
- m24: role=founder, industry=SaaS, company_stage=startup, location=Tallinn, requested_role=engineer, require_contact=true, required_field=contact, verify_contact_is_current=true
