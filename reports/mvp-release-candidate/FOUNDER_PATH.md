# Founder path (Task 8)

Query: "Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact". Product core (`runSpecSearchCore`, force), worker runtime, headed, local no-persist.

## Understanding: fixed, then verified
Before this task the provider frame (groq gpt-oss-20b) dropped the place and split "public contact" into email AND phone; the deterministic parse kept "Tallinn Estonia" as an unknown place and read the role as "founder of startups".

Fixes (rule tests in `src/lib/understanding/founder-path.test.ts`, 4 cases):
- Provider frame with no location: the deterministic place is recovered when it sat behind a locative preposition and is not an exclusion (`normalizeSearchFrame`).
- "with public contact" / "public contact" / "contact details" = any public channel (`required_field=contact`). Email or phone the user did not name are dropped; "all/full contact details" keeps every channel (stress case M18).
- "Founders of … startups": role `founder`, company stage `startup` (the organisation noun is no part of the title).
- "Tallinn, Estonia" (and "Tallinn Estonia" after the comma is lost) resolves to the city Tallinn, EE through the world gazetteer (Task 12).

Resulting spec (real run): `role=founder, industry=B2B SaaS, company_stage=startup, location=Tallinn (geo:city:tallinn, EE), requested_role=engineer, required_field=contact`, hiring signal required.

## Runtime (runs `founder_tallinn1`, `founder_tallinn2`)
- Runtime: worker (no fallback). Structured web search (self-hosted index) unreachable, reported as a diagnostic; the browser searched DuckDuckGo instead.
- 4 pages read: a directory of Tallinn SaaS companies (vcbacked.co), a co-founder matching page, a relocation page, and one job post.
- Extraction: run 1 hit a provider JSON failure (`json_validate_failed`), which used to stop the model ladder as if our payload were malformed. Fixed in `src/lib/ai/providers.ts` (fails over to the next model; test `src/lib/ai/__tests__/failure-classification.test.ts`). Run 2 extracted normally: the directory names companies, not founders, so no person entity was produced.
- One entity (Startup Wise Guys, a company) was rejected as `ENTITY_TYPE_MISMATCH` for a person search. Correct.
- Outcome: `NO_QUALIFIED_RESULTS`, 0 rows, nothing streamed, ledger `unaccounted: 0`. The user sees the honest zero narrative, not an invented founder.

## Known limitation (not fixed in this pass)
No company-to-founder pivot: a list of Tallinn SaaS companies is not researched company by company for founders and careers pages, and discovery stops after two queries without new candidates (`maxNoProgressQueries: 2`, source plan). Hiring-evidence founders in a small market need that multi-hop research; it is a feature, not a boundary fix. The broader founder gate query ("B2B SaaS founders with public contact details") returns 5 qualified founders on the same runtime (`WORKER_RUNTIME_GATE.md`).
