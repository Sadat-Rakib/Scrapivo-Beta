# Test triage — KNOWN_RED (Task 13)

Input: `KNOWN_RED.json` (60 entries, 14 files, frozen from baseline B at pass start).
Runs (all `--maxWorkers=1`):

- Current tree, twice: `vt.mjs` with `VT_SHOW_KNOWN=1`, plus a direct JSON run.
- HEAD 7805e75 in `C:\scrapivo-baseline\head`.
- Baseline B re-run for `candidate-survival` + `thin-ask`, to confirm the "fixed" entries were not load flakes.

A throwaway probe calling `runSpecSearchCore` with the tests' own fakes confirmed the root causes. It has been deleted.

Class rule: if it passes now → **fixed in this pass**. Otherwise, if it fails at HEAD → **pre-existing at HEAD**. Otherwise (passes at HEAD, or the file is absent there) → **introduced before this pass**.

## Counts

| Class | Entries |
|---|---|
| pre-existing at HEAD | 28 |
| introduced before this pass | 29 |
| fixed in this pass | 3 |
| **total** | **60** |

Current tree on these 14 files: 300 tests, 244 pass, 56 fail, plus 1 suite-level failure. `knownRedHit=57`, `NEW_FAILURES=0`.
RELEASE-RELEVANT: **1** (candidate-survival #5, see below).

## Per file group

| File | # | Class | Root cause | Release relevance |
|---|---|---|---|---|
| `src/lib/__tests__/coverage-planned.test.ts` | 4 | pre-existing ×4 | Stale fixtures. The S3 fake rows have no website, phone or email, and the qualification gate drops rows with no contact channel. Probe: the row fails with `FAILED_QUALIFICATION`; the same row with a website or phone gives `RESULTS`. | not release-blocking |
| `src/lib/__tests__/pagination.test.ts` | 3 | pre-existing ×3 | Same contact-less fixtures, so the paging slice is never exercised (coverage gap). | not release-blocking |
| `src/lib/__tests__/phone-safety.test.ts` | 1 | pre-existing ×1 | The row's only contact is a wrong-country phone. It gets hidden, which leaves no contact, so the row is dropped before the `phoneStatus` assertion. The `checkPhone` unit tests pass. | not release-blocking |
| `src/lib/__tests__/mode-gate.test.ts` | 5 | pre-existing ×4 (#5–#8), introduced ×1 (#9) | Old Phase 1.3 mode/offer/site gate contract. At HEAD, bare and "selling" queries already retrieve without asking. Now the purpose gate asks `entity_purpose` first, including for "find me dentists in Pune" (#9). | not release-blocking (product call: browsing-signal queries now get the purpose question) |
| `src/lib/__tests__/offer-taxonomy.test.ts` | 11 | pre-existing ×11 | Offering-aware follow-ups (`entity_site`/`entity_channel`, `stale_site` derivation, offer inference from "without a website") are no longer produced. The NoSite fixture has no contact. `no_website` now requires verified website-absence evidence. | not release-blocking |
| `src/lib/__tests__/spec-search.test.ts` | 7 | introduced ×7 | Purpose gate. "I need SaaS founders in New York" and "find me dentists in Pune" stop at `entity_purpose` before retrieval. The index/S3 fakes are never called and rows are `[]`. #29's TypeError is `rows[0]` being undefined. | not release-blocking |
| `src/lib/understanding/understanding.test.ts` | 16 | introduced ×16 | Purpose gate. A new `user_context.objective` blocker (`missing_purpose`) was added to `clarify-state.ts` `blockers()` after HEAD. The tests still assert `clarification.needed=false` for plain discovery. | not release-blocking |
| `src/lib/search/__tests__/candidate-survival.test.ts` | 2 | introduced ×1 (#48), fixed ×1 (#49) | #48: "globally" is parsed as a stated location, so `qualifyLead` demotes a valid founder (details below). | **RELEASE-RELEVANT** (#48) |
| `src/lib/search/__tests__/entity-taxonomy.test.ts` | 1 | pre-existing ×1 | For "bro i need businesses…", the legacy `extractSearchSpec` now reports `missing=['location']`; category is no longer listed. This is the legacy parser, not the app's understanding path. | not release-blocking |
| `src/lib/search/__tests__/jobs-spec-questions.test.ts` | 1 | pre-existing ×1 | Seniority stays inside the role string ("senior frontend developer"), so thin-ask re-asks `entity_seniority` (HEAD re-asked location). Minor real bug that only shows on empty results. | not release-blocking |
| `src/lib/search/__tests__/m4-entity-resolve.test.ts` | 1 | pre-existing ×1 | The OSM no-website fixture has no structured website-absence verification, so `qualifyLead` returns `potential_match` (`NO_CLAIM_EVIDENCE`) and 0 rows come back. This is the intended stricter policy. | not release-blocking |
| `src/lib/search/__tests__/step2-resolver.test.ts` | 5 | introduced ×3 (#53–#55), pre-existing ×2 (#56, #57) | #53–#55: purpose gate stops before retrieval (rows `[]`, `not_required`, `needs_clarification`). #56: `no_website` rows lack verification. #57: same legacy `extractSearchSpec` slot change as entity-taxonomy. | not release-blocking |
| `src/lib/search/__tests__/thin-ask.test.ts` | 2 | fixed ×2 | Failed in B, pass now. | n/a |
| `Promotional Videos/motion-reel-kit/.claude/skills/motion-reel/engine/lib/motion.test.js` | 1 | introduced ×1 (absent at HEAD) | Environment/config. It is a plain Node script (`require` + asserts, no `describe`/`it`) that the vitest include glob picks up, so vitest reports "No test suite found". | not release-blocking |

## Shared causes (count of entries)

- **Purpose gate** (`user_context.objective` → "What are you trying to do with these results?"): 27 introduced entries, plus the current message on mode-gate #5/#6. This is an intended product change and the tests are stale. Answers like `{mode:"looking"}` satisfy the gate.
- **Contact-completeness qualification** (fixture rows with no website/phone/email are dropped): coverage-planned, pagination, phone-safety, offer-taxonomy #14/#19.
- **Verified website-absence policy** for `no_website`: offer-taxonomy #12/#18, m4 #52, step2 #56.
- **Superseded mode/offer/site/channel follow-up gate** (already gone at HEAD): mode-gate #5–#8, offer-taxonomy #11/#13/#15/#16/#17/#20.

## RELEASE-RELEVANT

`candidate-survival.test.ts` :: "5: 'may need help' is not buying intent; missing optional email does not reject a valid founder"

- The probe ran "Find 10 SaaS founders globally who may need help with AI automation". The resulting spec has `location=globally`, `location_kind=stated`, `location_id=geo:stated:globally`. It does not get `geo_scope=worldwide`.
- `qualifyLead` on the test's founder returns `potential_match` with reject code `MISSING_QUERY_REQUIRED` ("missing query-required: location").
- Impact: on the main path (understanding → qualification), candidates with no location are demoted for "…globally" queries. The qualified grid hides `potential_match` by default, so these queries can come back empty.
- Scope of the check: verified on the deterministic understanding path (the test env, no LLM). The LLM-frame path was not verified. "worldwide" was not probed.
- Related: `source-plan.ts` `usefulLocation()` only treats `worldwide|global|anywhere` as unbounded, not "globally".

## Fixed in this pass (3)

All three passed at HEAD and failed in B. The B re-run at `--maxWorkers=1` reproduced the failures, so they are deterministic. All three pass in both current-tree runs.

- `src/lib/search/__tests__/candidate-survival.test.ts` :: candidate survival — deadline vs cancellation 10: hard deadline finalizes already-qualified candidates instead of returning zero
- `src/lib/search/__tests__/thin-ask.test.ts` :: thin-ask end to end (stubs, no network) thin person search stays honest-empty without asking seniority
- `src/lib/search/__tests__/thin-ask.test.ts` :: thin-ask end to end (stubs, no network) rich search stays quiet (no thin questions when rows found)

## Side observations (not in KNOWN_RED)

- `Promotional Videos/film/lib/motion.test.js` is a second copy of the same non-vitest script, and it is also collected. It will show up as a NEW suite failure in full runs. Suggest adding `"Promotional Videos/**"` to `test.exclude` (not done, out of scope).
- HEAD had 1 more failure in these files that is not in KNOWN_RED: understanding.test.ts "to-search-spec.ts reaches nothing but the AI router". It was fixed before this pass.
- The jobs spec for "remote senior frontend developer jobs in Berlin" also carries `industry="remote senior frontend developer job"` and `geo_scope=worldwide` next to `location=Berlin`. This looks like a parse defect; its effect on results was not verified.

## vitest.config.ts change

- Added `".kilo/**"` to `test.exclude`. `coverage.exclude` and everything else are unchanged.
- Verified with `vitest list --filesOnly --maxWorkers=1`: 158 test files collected, 0 under `.kilo/`. There are 8,113 `*.test.*`/`*.spec.*` files on disk under `.kilo/`.

## Follow-up (done after triage)

- The "globally" bug is fixed in `normalizeSearchFrame` (`src/lib/understanding/to-search-spec.ts`): "globally", "worldwide", "anywhere in the world" and similar become `geo_scope=worldwide`, never a stated place. candidate-survival #5 now passes; regression case in `src/lib/understanding/founder-path.test.ts`. Stress stays 100/100.
- `Promotional Videos/**` is excluded from vitest discovery (plain Node scripts named `*.test.js`, not suites).

## Still open

- Update the stale tests: add a purpose answer, add contact fields to fixtures, add verified-absence fixtures.
