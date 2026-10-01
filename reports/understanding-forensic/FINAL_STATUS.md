# Scrapivo MVP input-understanding forensic status

## BASELINE HEAD

`main` at `7805e75e452d925a6d88e3db880622fdb2f35207` (`fix(deploy): move scheduled jobs from Vercel to Supabase`). `git branch -vv` showed `main` tracking `origin/main` at the same commit. Existing unrelated changes: modified `freehire`; untracked `.kilo/`, `reports/core-forensic/`, `reports/core-pipeline-audit*`, several `reports/gate2/browser-sessions/live-run_*`, and `scrapivo-core-forensic.zip`. None were staged or overwritten. This pass added diagnostic files under `reports/understanding-forensic/`, dated verifier files under `reports/understanding/`, and a concurrent helper left `reports/mvp-input-forensic/`.

## RELEVANT FILES

Full path/role/symbol/caller/consumer map: [RELEVANT_FILES.md](RELEVANT_FILES.md). Hottest files: `src/routes/_authenticated/discover.tsx`, `src/lib/understanding/{fallback,extract.server,validate,to-search-spec,clarify-state}.ts`, `src/lib/search/{search-spec,search-spec-extract,query-readiness,mode-gate,clarifier,activity-presenter,live-gapfill}.ts`, `src/lib/spec-search.functions.ts`, `src/components/discover/{clarify-panel,scrapy-browser,discover-welcome-hero}.tsx`, `src/lib/search/scrapy-browser.server.ts`, `src/lib/research-agent/playwright-browser.server.ts`.

## CURRENT UNDERSTANDING PIPELINE

`Discover.beginSearch` accepts raw composer text. `SPEC_SEARCH_ENABLED` selects `runSpecBranch`/`runSpecSearch`; unreadable/off flag selects the separate legacy `runSearch` path. Spec path calls `runSpecSearchCore`, then `understandSearchSpec`. That races provider `extractFrameLLM` against a 12-second deterministic fallback, validates the frame, and calls `frameToSearchSpec`. The bridge also runs legacy `extractSearchSpec(raw)` and overlays selected frame fields. `runSpecSearchCore` merges clarification answers into criteria, computes missing fields, applies bare-query readiness and mode gates, then runs indexed/structured sources and optional live gapfill. Live gapfill browses when verified candidate count is below target. Candidate qualification reads SearchSpec criteria and signal flags. The attached frame is used by some research-agent planning, but active spec search does not apply all its requested output or evidence fields.

The frame-native `understandQuery`/`answerClarification`/`patchFrame` path exists for the inspector. It is not the main Discover search path. A new composer turn resets `pendingQuery` and answers. Legacy `runSearch` separately uses `classifyQuery`, `clarifier`, and `playbook-planner`.

### Complex-query boundary trace

Query: “Find me D2C brands in Dhaka, Bangladesh that are doing marketing, have an online presence, are active, and give me their websites, phone numbers, emails and socials. Check when they last posted.” Exact snapshots: [TRACE.jsonl](TRACE.jsonl).

| Boundary | Observed belief |
| --- | --- |
| Raw | D2C brands, Dhaka/Bangladesh, marketing/online activity, website/phone/email/social, last post |
| Live provider frame (`groq:openai/gpt-oss-20b`, no fallback; two validation repairs) | `business`, Dhaka/Bangladesh, relation `offers_service=marketing`, positive website/active constraints; no D2C business model, social freshness, or contact requirements; four required fields present |
| Deterministic frame | `company`, Dhaka/BD, category `d2c brands`, required website/phone/email/socials; no marketing/activity/last-post requirement |
| Legacy extractor | `company`, `business_model=d2c`, `industry=marketing`, Dhaka/BD |
| Live-frame SearchSpec | `business`, D2C restored by legacy parser, Dhaka, category `marketing`; no required contact criteria or last-post/live requirement; ready |
| Readiness/planner input | `missing=[]`, `signal_required=false`, no goal question; planner cannot require last-post check or requested contacts from executable criteria |

First loss of D2C model and correct target category in live path is model output; legacy extraction recovers only D2C. Live parser reads marketing as a service the brands offer and has no last-post check. First loss of contact output requirements from deterministic path is frame-to-spec conversion. Activity/freshness is already missing or too weak at extraction.

## STRESS TEST CORPUS

100 frozen cases in [CORPUS.json](CORPUS.json): 40 pre-existing seeded holdout, 40 seeded chaos (typos/slang/casing/punctuation), and 20 targeted queries. Seed `27491`. Families cover local businesses, brands/companies, people/founders, investors, jobs, and opportunity intent. Targeted cases include Camrose, Dhaka, Chattogram, Tartu, Southeast Asia, Bandar Seri Begawan, Muscat, Cluj-Napoca, Tbilisi, Kigali, Surabaya, Porto, Cebu, Chiang Mai, Medellín, Pune, and Lusaka; negation, AND/OR, placeholders, social freshness, contacts, explicit/absent goal, remote/hybrid, salary, and a follow-up pair. Cases were fixed before product edits; no product edits occurred. The existing corpus generator predates this audit. An independent helper was requested for architecture-blind query generation but produced a file map instead; these 20 targeted cases were authored in this pass, so they are not independent of the investigator.

Run: `npx tsx reports/understanding-forensic/stress.mts`. Case-level expected concepts, actual frame, SearchSpec, and checks are in [STRESS_RESULTS.json](STRESS_RESULTS.json). The scorer compares concepts and normalized substrings, not prose. Strict checks can reject defensible ambiguous entity choices, so interpret rates as diagnostic, not certification. The 100-case run measures deterministic fallback, not the LLM. One separate live LLM trace confirms a real provider semantic miss.

Existing focused Gate 1 verifier at the same seed: holdout `40/40`, chaos `34/40` (all six failed on location; pair distinctions `5/5` in each set). Its expectations cover only selected axes and do not prove complete understanding. Original focused Vitest set: 196 pass, one fail. A current-HEAD rerun of four focused test files produced 232 pass, one fail. The same failure is `understanding.test.ts:114` asserting that `to-search-spec.ts` must not import legacy `extractSearchSpec`; it currently does. A separate direct probe reproduced a deterministic extraction crash on `$100,000` salary; the frozen corpus includes `$120,000` as M09 and scores the crash.

## SCORECARD

Strict fully correct: **60/100**. Denominators vary because only labelled fields are graded. Selected field scores:

| Concept | Correct / labelled |
| --- | ---: |
| Extraction completed | 99/100 |
| Task | 2/2 |
| Entity | 42/44 |
| Subtype | 1/3 |
| Location (frame) | 75/83 |
| Location (SearchSpec) | 68/79 |
| Category / industry / role | 2/3; 1/3; 3/3 |
| Business model / mode | 2/2; 10/10 |
| Relation / signal | 61/61; 15/17 |
| Filters / negation | 6/6; 6/9 |
| Contacts and requested outputs in frame | 7/11 |
| Required outputs as executable spec criteria | 2/11 |
| Placeholders / multiple locations | 0/3; 0/3 |
| Remote / salary / recent social activity among returned frames | 1/1; 1/1; 2/4 |
| General clarification / goal clarification | 10/12; 2/4 |
| Composer conversation merge | 0/1 |
| Labelled SearchSpec preservation (all spec checks per case) | 61/89 |

False clarification example: M19 “research only: restaurants in Lusaka” can ask mode/entity. Missed clarification examples: M02 absent purpose, M06/M07 unresolved amount. M18 asks a generic question while failing to ask the material missing size. Invented fields include M06 location `paying`, M03 no-website opportunity, and M13 positive agency model despite exclusion. Wrong defaults include implicit `looking` from `find me`/`need`, and `geo_scope=worldwide` from remote even when an unrelated location was misread. These counts are examples, not a population estimate.

## PASS EXAMPLES

- M03 understands plumbers, Austin, and `needs_service`; no redundant seller question. Separate no-website inference still fails.
- M05 bare investors triggers a useful targeting question, though frame-native and runtime wording differ.
- M20 “I sell SEO” reaches spec `mode=selling` and `offer=seo`, with no runtime purpose re-ask.
- Seeded holdout cases pass their existing selected-axis checks; this does not cover full SearchSpec preservation.

## FAIL EXAMPLES

- M01 colloquial D2C skincare brands becomes a person hiring; phone and recent-post checks disappear.
- M04 Camrose business request loses Camrose and social freshness.
- M06 “remote react jobs paying this much” invents place `paying`, omits salary clarification, and proceeds.
- M09 formatted `$120,000` salary crashes deterministic frame extraction with `quantity.requested=0` validation failure.
- M10 `Chattogram or Dhaka, not agencies` keeps one city and drops exclusion.
- M13 `exclude staffing agencies` yields positive `business_model=agency`.
- M17 `NOT already funded` retains positive recent funding; requested email/socials disappear.
- M19 explicit “research only” can trigger an unnecessary question and loses restaurant category.

## FAILURE CLUSTERS

Dominant classes: number-extractor crash, entity collision, geography span contamination, placeholder blindness, multi-location collapse, negation reversal, no-website overinference, model omission, frame-to-spec deliverable loss, goal-gate underreach, separate clarification systems, and composer follow-up reset. Do not attribute all failures to the model: most scored cases used deterministic fallback, and several losses occur after a correct frame.

## ROOT CAUSES

[ROOT_CAUSES.md](ROOT_CAUSES.md) ties each cluster to runtime cases, exact boundary, responsible symbol, and mechanism.

## CLARIFICATION FAILURES

Current frame blocker list does not include user purpose or numeric placeholders. `SearchSpec.computeMissing` requires only a small entity-specific set. `query-readiness` targets selected bare nouns. `mode-gate` is bypassed for actionable frames and treats generic `find me`/`need` as browsing. Thus `find plumbers in Austin` acts without a goal question, while an explicit need for website services avoids that question but is wrongly converted to no-website opportunity. Legacy clarifier can ask business-model questions unrelated to broad local-business requests when spec flag is off. Binary clarification accuracy hides wrong-question errors.

## CONVERSATION MEMORY FINDINGS

Panel answers survive as flat `criteria` in `spec-search.functions.ts:1116-1124`. The attached UnderstandingFrame is not patched, so frame/spec can diverge. Composer follow-up is worse: `beginSearch` creates a new turn and clears pending query/answers at `discover.tsx:1549-1582`; “Alberta” becomes a new standalone search. Frame-native `patchFrame` in `understanding.functions.ts` is isolated to the inspector endpoint. No reliable general conversation merge was demonstrated.

## FRAME → SEARCHSPEC LOSSES

`frameToSearchSpec` starts with a second parser, filters/replaces selected semantic fields, and explicitly maps only some frame data. It retains the full frame as `spec.understanding`, but current spec execution does not turn most required contacts, verification, enrichment, output, Boolean/multiple locations, or purpose into enforceable criteria. `research-agent/plan.ts` reads some attached frame required fields on a separate browser path, so “lost” means absent from the active planner/qualification contract, not erased from memory. Check 2/11 executable output requirements and 61/89 strict per-case spec preservation.

## UI PROVIDER-LEAK FINDINGS

Progress source: `runSpecSearchCore` emits action/source/detail; `publishSearchBrowserProgress` calls `presentActivityEvent` before storing; `getSearchBrowserProgress` polls; Discover renders event text. The adapter already exists, but `activity-presenter.ts` maps storage to visible “saved leads” and its internal-name filter omits OSM/OpenStreetMap, Geoapify, Foursquare, S3, DuckDB. Four direct probes in `TRACE.jsonl` show these terms pass through. Result tabs and entity detail render raw source fields outside the presenter. A second loss exists: browser research emits a verified `row`, but `presentActivityEvent` returns no `row`, so the transport discards data needed by Discover's in-progress verified cards. Future adapter boundary: progress publication must preserve safe row data while redacting text; shared public-label mapping must cover every result-source render.

## GUIDED-PILL FINDINGS

`discover-welcome-hero.tsx:4-9,49` stores full executable queries in pill data and calls `onQuickSearch(chip.query)`. “Find local businesses” executes `find plumbers in Austin`; other pills fabricate founders, investors, SaaS companies, and remote frontend jobs. Future pills should set guided category/hint and collect user target, location, purpose.

## MOBILE UI FINDINGS

No authenticated UI/browser surface was available for viewport reproduction; CUA browser inventory was empty and an in-app tab could not be created. [MOBILE_AUDIT.md](MOBILE_AUDIT.md) records attempted 390×844 and 360×740 reproduction without reaching authenticated Discover or capturing a screenshot. `app-shell.tsx` fixes and clips the viewport; `discover.tsx` places the clarifier above the composer outside the conversation scroll region; `clarify-panel.tsx` has no max-height, internal scroll, sticky footer, or safe-area rule. Long question content can consume the usable height. **Viewport successfully tested: none. Runtime severity remains unverified.** Future mobile card/bottom sheet should cap at about 60–70dvh, scroll internally, keep composer and footer reachable, and respect safe area. No layout edit was made.

## AGENTIC BROWSER PRODUCTION FINDINGS

`runSpecSearchCore` enters live gapfill if signal/live need exists or indexed results are thin (`spec-search.functions.ts:1977-1989`). `live-gapfill.ts:702-705` invokes browser below desired verified count. Default adapter is in-process Playwright (`browser-live.server.ts:12`); it dynamically imports `playwright-core` and launches Chromium (`playwright-browser.server.ts:43-44`). UI polls process-local browser session by run and owner; `ScrapyBrowser` returns null until `pagesVisited > 0` (`scrapy-browser.tsx:63`). Discover further renders it only inside an active-search panel with at least one progress event (`discover.tsx:2202-2281`) and clears the run ID when the search ends (`:840-842`). Thus a completed browser run leaves no persistent mini-browser view. Process-local progress and session registries may not survive cross-instance polling on Vercel; that is a hypothesis, not a measured production failure. `vercel.json` declares no browser install/runtime configuration. An external worker client requires URL/token, but search for its server functions found no Discover caller. A startup script can set worker env vars; this is not proof they are configured or used.

`https://scrapivo-beta.vercel.app` returned HTTP 200 from Vercel. [PRODUCTION_ACCESS.md](PRODUCTION_ACCESS.md) records read-only Vercel identity, deployment, environment-name, and log checks. A current rerun confirmed production deployment `scrapivo-beta-2221m0i0w`, hidden-value `BROWSER_WORKER_URL`/`BROWSER_WORKER_TOKEN` environment entries, and a bounded log response with a spec-run clarification but no browser launch/session event. The variable names do not establish that the worker is reachable or used by Discover. Public HTTP and available logs did not expose an authenticated browser run, session, or screenshot. Therefore the exact reason the mini-browser is absent in production is **not verified**. Evidence supports possible “not triggered”, runtime failure, process-local event loss, or UI hidden before first page; it does not select one. `BROWSER_STATUS: UNKNOWN`.

## EXACT HOT FILES

Implementation pass should start with `fallback.ts`, `extract.server.ts`, `to-search-spec.ts`, `search-spec.ts`, `query-readiness.ts`, `mode-gate.ts`, `spec-search.functions.ts`, and `discover.tsx`, then the four UI boundaries `activity-presenter.ts`, `discover-welcome-hero.tsx`, `clarify-panel.tsx`, `scrapy-browser.tsx`. Browser remediation must wait for production attempt/log evidence.

## WHAT SHOULD NOT BE REWRITTEN

Keep source acquisition, ranking, qualification, index/S3 tiers, browser adapter architecture, production data, and SearchSpec schema untouched in this diagnostic pass. The next pass should preserve known working searches and use boundary tests before changing semantic contracts. Existing frame provenance and attached `spec.understanding` are useful; do not discard them based on the current failed mappings.

## RECOMMENDED MINIMAL IMPLEMENTATION PLAN

1. Define acceptance examples for target constraints, goal/purpose, requested outputs, required evidence, unresolved values, and follow-up merging. Decide the smallest representation change only after those tests.
2. Fix parser and validator only for evidenced classes (place spans, negation, placeholders, Boolean locations, colloquial entities). Test against frozen corpus and live provider outputs.
3. Make one readiness decision consume explicit purpose and material unresolved fields; suppress questions for already stated goals. Preserve original request through composer and panel follow-ups.
4. Ensure every required frame concept reaches active planner/qualification inputs; remove contradictory legacy overlays only when preservation tests pass.
5. Redact progress and result-source labels at shared presentation boundaries; change pills to guided hints; constrain mobile clarification layout.
6. Run authenticated production browser probe with source-selection diagnostic, worker/Chromium logs, session ID, progress polling, and screenshot state. Fix only the first evidenced failing boundary.

## RECOMMENDED REGRESSION TESTS

Keep 100 frozen cases as a holdout. Add focused tests for A–F clarification scenarios, `need website services` versus `no website`, absent versus explicit purpose, placeholders, two-location OR, negated agency/funding, contact and last-post preservation, composer follow-up, redaction of exact provider strings, mobile 390×844 and 360×740 clarification, and a production browser event/session smoke. Run provider cases separately and never credit fallback answers as LLM passes.

## FILES TO PROVIDE FOR REVIEW

**Understanding core:** `frame.ts`, `extract.server.ts`, `fallback.ts`, `validate.ts`, `lexicon.ts`, `vocab.ts`, `ai/router.server.ts`, `ai/providers.ts`.

**Clarification/dialog:** `clarify-state.ts`, `query-readiness.ts`, `mode-gate.ts`, `clarifier.ts`, `understanding.functions.ts`.

**Frame → SearchSpec:** `to-search-spec.ts`, `search-spec.ts`, `search-spec-extract.ts`, `location-resolver.ts`.

**Conversation state:** `discover.tsx`, `spec-search.functions.ts`; include `search.functions.ts` and `query-classifier.ts` for legacy flag-off behavior.

**Search planner boundary:** `source-plan.ts`, `coverage-selector.ts`, `research-agent/plan.ts`, `browser-research.ts`, `live-gapfill.ts`.

**Progress UI:** `activity-presenter.ts`, `search-browser-progress.server.ts`, `result-tabs.tsx`, `entity-detail-panel.tsx`.

**Guided pills:** `discover-welcome-hero.tsx`.

**Mobile clarification UI:** `clarify-panel.tsx`, `discover.tsx`, `app-shell.tsx`, `unified-composer.tsx`.

**Browser/mini-browser:** `scrapy-browser.tsx`, `scrapy-browser.server.ts`, `browser-live.server.ts`, `playwright-browser.server.ts`, `research-agent.functions.ts`, `vercel.json`, `package.json`.

**Test harness:** this report, [RELEVANT_FILES.md](RELEVANT_FILES.md), [ROOT_CAUSES.md](ROOT_CAUSES.md), `stress.mts`, `trace.mts`, `CORPUS.json`, `STRESS_RESULTS.json`, `TRACE.jsonl`, existing `scripts/verify-understanding.mts` and `src/lib/understanding/corpus.ts`.

All report artifacts, the mobile and production access audits, and 49 scoped source/config/test files are packaged in [REVIEW_BUNDLE.zip](REVIEW_BUNDLE.zip). Exact ZIP members are listed in `BUNDLE_FILES.txt`. No `.env`, credentials, data exports, or production artifacts are included.

## Progress record

Finished: baseline, code map, one live and deterministic end-to-end trace, 100 deterministic stress cases, focused tests, stage clustering, UI/pill/mobile source audit, production browser path audit, review manifest. Saved files: the report artifacts in `reports/understanding-forensic/` plus three dated existing-verifier report/case pairs in `reports/understanding/`. A concurrent diagnostic helper also left three files under `reports/mvp-input-forensic/`; they were not used as the final bundle. Failed: one existing Vitest isolation assertion; one formatted-salary extraction crash; three placeholder and three multi-location stress cases; production browser and mobile runtime confirmation unavailable. Next step: review this report, then authorize a separate surgical implementation pass. No source, search engine, Supabase, S3, commit, push, or deployment change.

Current-HEAD verification: rerunning `rtk npx tsx reports/understanding-forensic/stress.mts` reproduced 60/100 fully correct and the scorecard above. The four focused Vitest files reproduced the same isolation failure (232 pass, one fail). CUA exposed no browser or app surface; an in-app tab request returned `Browser is not available: iab`, so no mobile viewport or authenticated production run was observed. Current source confirms `publishSearchBrowserProgress` already calls `presentActivityEvent`; its incomplete redaction remains the finding.

Runtime verification blocker: the user confirmed that no existing production browser run evidence or authenticated browser session is available. A fresh CUA inventory again returned no apps or browsers. Starting a production search solely to create evidence would conflict with this pass's production-data constraint. The exact production mini-browser cause and measured mobile overflow therefore remain open; the reports make no runtime success or failure claim for those boundaries.

## FINAL VERDICT

UNDERSTANDING ENGINE: PARTIAL

CLARIFICATION POLICY: BROKEN

FRAME → SEARCHSPEC: PARTIAL

CONVERSATION STATE: BROKEN

PROGRESS UI PRIVACY: FAIL

GUIDED SEARCH PILLS: FAIL

MOBILE CLARIFICATION UX: FAIL

PRODUCTION BROWSER: NOT VERIFIED

READY FOR IMPLEMENTATION PASS: NO (production browser cause and mobile runtime symptom need verification; semantic boundaries are ready for scoped test design)
