# CURRENT RELEASE STATUS

FINAL CURRENT CHECKPOINT (2026-09-25; supersedes older entries below):
- Initial core is TESTABLE: background Vite `http://127.0.0.1:8082`, SearXNG Docker `scrapivo-searxng` port 8888, existing `.env`/auth account.
- Founder UI PASS: `Find SaaS founders globally who may need help with AI automation.` 8 structured rows, 95,189 ms, pg-index + free web + browser, evidence/why_match. No verified direct founder contacts; source is list post. Artifact `reports/ship-it/find-saas-founders-globally-who-may-need-help-with-ai-automation-/result.json`.
- Local UI PASS: `Find HVAC companies in Edmonton.` 3 rows, 160,117 ms, pg-index + S3 + OSM + browser, 3 phones, 1 email, OSM record evidence. Artifact `reports/ship-it/find-hvac-companies-in-edmonton-/result.json`.
- Jobs UI PASS from earlier: `Find remote AI automation jobs in Canada.` 2 structured remote Canadian roles with employer/job URL/evidence. Artifact `reports/ship-it/find-remote-ai-automation-jobs-in-canada-/result.json`.
- Contact enrichment adapter actually invoked on 4 official Edmonton business sites; returned within 2s each, no new email. Existing OSM contact fields preserved. List-source publisher contact crawling now skipped.
- Focused release suite 172/172 PASS before last two narrow edits; pipe-card targeted test 1/1 PASS; list-source skip direct check PASS. Do not claim full suite/typecheck green.
- Verified failures: GTA HVAC 0 after metro routing; Edmonton HVAC without websites 0 because no defensible absence evidence; NYC copywriter/social 0 because no subject-bound discussion evidence. All settled; do not fabricate results.
- Next action: hand off exact manual steps. No new feature work. For full V1, target provider coverage of failed scenarios and founder contact path separately.

LATEST VERIFIED CHECKPOINT (supersedes older entries below):
- Jobs UI PASS after location theorem fix: 2 structured remote Canadian AI-automation postings, employer/URL/evidence. `reports/ship-it/find-remote-ai-automation-jobs-in-canada-/result.json`. Founder UI earlier 10 rows but harness selector failed (now corrected); normal Edmonton HVAC UI PASS 44 rows. Release freeze: rerun founder, focused tests, cancellation if feasible. GTA/no-site/copywriter remain FAIL and must be reported honestly.
- Jobs UI rerun run_6fa4a011 found real AI & Automation Manager at Superior Plus and a nerdwallet role, but theorem rejected LOCATION_MISMATCH for composite Canadian location. Job provider country inference + theorem country field gate patched; focused jobs/location tests 37/37 PASS. Next rerun jobs UI; if still fails, inspect exact qualification code once, then release freeze.
- Copywriter NYC UI FAIL: correct role/location/topic reached live; 15 live candidates, 4 post-filter, all rejected NO_CLAIM_EVIDENCE because job/directory/article pages lacked named person discussion. Browser timed out at 120s after targeted Erik Smolin research. Do not weaken evidence gate. Next jobs UI query.
- GTA HVAC remains FAIL after category, clarifier, metro routing, and OSM targeting fixes: stored CA partition returned 0 HVAC Toronto rows; narrow OSM tags 0, browser 0, live web 15 all filtered. Stop spending on GTA; move copywriter/jobs. Do not claim V1 complete.
- Normal Edmonton HVAC UI rerun PASS after provenance patch: 44 rows, identity evidence count 1 per sampled row, grounded why_match, phones. Artifact refreshed `reports/ship-it/find-hvac-companies-in-edmonton-/result.json`. OSM broad category remapping reduced noise. Next run GTA HVAC original acceptance.
- Third no-site UI run run_3b04573b settled in 175333ms with NO_QUALIFIED_RESULTS. Browser attempted targeted named-business queries, timed out at its 120s cap, 0 verified. No explicit website-absence evidence found. Broad OSM tags were incorrectly mapped to HVAC; `craftFromTag` now preserves actual tag unless HVAC-related. No-site remains FAIL but does not fabricate absence.
- Focused source/browser regression after patch: 34/34 PASS. Next: rerun normal Edmonton HVAC for evidence/provenance, then GTA/copywriter/jobs if time.
- Second no-site UI run timed out at harness 210s during a Vite program reload caused by editing `need-phrase.ts` mid-request; no server response captured. Browser seeds now bounded to at most six relevant URL-less rows, no-site research queries added, focused 73/73 tests pass. Next: rerun no-site with no code edits during request.
- No-site first UI run run_c72510ea returned NO_QUALIFIED_RESULTS (78 OSM candidates, zero proof of website absence). That run started before evidence patches and skipped browser because missing OSM tag had been counted as a verified absence. Removed that false claim and added explicit qualification guard. Next rerun must verify browser attempted.
- Added OSM record URL identity evidence and DB stored-record identity evidence for local business rows; focused tests m8+m9 passed, m7 had one stale structured research-query assertion (67/68 total).
- Founder UI/backend run_4246b54a returned 10 structured named founder rows; founder harness failed only on a text selector, since corrected. Founder contact routes remain weak.
- `Find HVAC companies in Edmonton.` PASSED real UI Playwright harness: run_d00581d9, 50 Edmonton business rows with phones/websites. Artifact: reports/ship-it/find-hvac-companies-in-edmonton-/result.json.
- Current blocker: `Find HVAC businesses in Edmonton without websites.` untested; OSM no-website evidence wrongly treats absent tag as proof. Local rows lack evidence arrays.
- EXACT NEXT ACTION: inspect `src/lib/search/live-gapfill.ts` defaultOsm; correct false absence claim; run constrained Edmonton query.

Working:
- Vite on 127.0.0.1:8082; existing SearXNG container on port 8888; paid sources disabled.
- Real UI harness signs in and submits; SearXNG and browser return real candidates.
- Founder request settles; corrected understanding reached UI. No infinite pending observed.

Current blocker:
- Latest founder run had eight final candidates, all search/list/company pages or provisional pages; rejection was valid. Browser founder cards lacked industry and were filtered before qualification.
- Narrow founder-card and explicit SaaS-cohort evidence patch is saved. Real UI rerun underway; result pending.

Last verified query:
- Find SaaS founders globally who may need help with AI automation.
- FAIL: NO_QUALIFIED_RESULTS; 25 live scanned, 24 returned to filter, 8 post-filter, 8 qualification rejects, 0 final rows.
- Started 2026-09-25T10:16:08.519Z; elapsed 208262ms; actual server response arrived before harness timeout.
- Artifacts: reports/ship-it/find-saas-founders-globally-who-may-need-help-with-ai-automation-/{result.json,runtime.json,page.png,rendered.txt}.
- Browser run_8e30eead: timeout, 10 candidates, 0 verified; pg-index attempted, 0 rows.
- Run_bdd61af9: SearXNG 29 results, browser 9 candidates, final 0. Rejection codes are PROVISIONAL_ENTITY or ENTITY_TYPE_MISMATCH.
- Prior real public page replay: five named founder cards now pass rowSatisfiesSpec and qualifyLead after patch. This is diagnostic replay, not UI acceptance.

Tests:
- Browser/integration: 28/28 passed. Enrichment/integration: 27/27 passed. Spec/enrichment: 41/41 passed.
- Three original failures classified: two stale exact query/order assertions; website URL contradiction now retained and rejected explicitly.
- Typecheck baseline: 44 errors; see typecheck-ascii.log.

Files changed this session:
- src/lib/understanding/to-search-spec.ts; src/lib/search/search-spec.ts; src/lib/spec-search.functions.ts (saved agent bridge).
- src/lib/search/source-plan.ts; src/lib/search/qualify.ts; src/lib/search/browser-live.server.ts (topic propagation, grounded discussion, zero absent intent).
- src/lib/search/browser-live.server.ts (founder card/cohort extraction, resolved seed filter, profile research).
- src/lib/understanding/to-search-spec.ts (industry preservation); src/lib/search/enrichment-run.ts (shared contact budget); vite.config.ts (ignore test artifacts).
- e2e/ship-it.spec.ts; reports/ship-it/run-runtime.ps1; reports/ship-it logs.

Known P0:
- Founder usable UI output fails qualification; corrected understanding integration verified through UI.

Known P1:
- HVAC, copywriter, jobs unverified; cancellation runtime proof outstanding.

Deferred:
- Broad type cleanup, optional persistence, UI polish, coverage expansion.

EXACT NEXT ACTION:
- Current real founder UI rerun is session 81949. Check `reports/ship-it/ship-runtime.log` and last `[spec-run]` in `reports/ship-it/vite.log`.
- If founder rows survive, move immediately to Edmonton HVAC normal and without-website queries.
- Prior agents hit usage limits; no new delegation.
