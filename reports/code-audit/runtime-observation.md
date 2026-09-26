# Runtime Observation

Query: SaaS founders globally need help with AI automation

Evidence from reports/ship-it/SESSION-STATE.md:
- Browser run_8e30eead: timeout, 10 candidates, 0 verified; pg-index attempted, 0 rows.
- Run_bdd61af9: SearXNG 29 results, browser 9 candidates, final 0.
- Rejection codes: PROVISIONAL_ENTITY or ENTITY_TYPE_MISMATCH.
- Later patched founder UI pass exists: 8 structured rows, 95,189 ms, pg-index + free web + browser. No verified direct founder contacts; source is list post.

Evidence from reports/ship-it/vite.log:
- browser-live logged DuckDuckGo searches.
- browser-live logged observed_founder_card events.
- browser-live completed with candidates:10 and verified:0 for one run.

Relevant code boundary:
- browser-live.server.ts computes verified count by running qualifyLead(row, spec, evidence).
- spec-search.functions.ts runs final qualification/rejection summary with qualifyLead again.
