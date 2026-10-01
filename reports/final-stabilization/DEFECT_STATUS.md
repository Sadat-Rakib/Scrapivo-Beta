# DEFECT_STATUS — final stabilization

Branch: `rc/mvp-local-testing-baseline` · Sprint start HEAD: `d10892d`
Baseline: vitest 1498/1568 pass · 55 KNOWN_RED · typecheck 43 frozen errors · bundle clean · NEW_FAILURES=0

Statuses: FIXED · PARTIAL · NOT A BUG · DEFERRED WITH REASON · BLOCKED EXTERNALLY · IN PROGRESS

| Defect | Status | Root cause | Fix surface | Proof |
|---|---|---|---|---|
| C1 profile edit not persisted | IN PROGRESS | `updateMyProfile` = UPDATE not UPSERT; no-row users get 0-rows success + toast; `sender_name` never written | worker: profile.functions.ts, profile.tsx | qa-profile-edit.mts |
| C3 clarify dead-loop | IN PROGRESS (core landed) | (a) `decideSpecClarification` ignored `force` in unresolved/scope/relation branches; (b) `syncClarification`→`initState` discarded `answered`/`asked` each HTTP round so blockers re-fired; (c) thin-ask re-attached `clarify` to every identical zero result and client re-armed it before the outcome toast; (d) client armed clarify on outcome-bearing responses | spec-clarification.ts (force=proceed), clarify-state.ts + frame.ts (answered/asked travel in frame), spec-search.functions.ts (thin-ask force guard), discover.tsx (thin-ask once per turn, blocking vs outcome clarify split). applyClarificationToFrame unresolved-clearing pending (waits for parser worker on to-search-spec.ts) | focused vitest + qa-run M05/S01/I01 rerun |
| C5 contact self-proof | IN PROGRESS | `contact_page_url` = guessed `/contact` URL satisfied `contact`; proof source_url == the claim itself; no excerpt/evidence | worker: canonical-contract.ts :408, browser-live contact block (require observed email/phone + real Evidence item + verification_status), browser-research.ts computeResearchNeeds | public-contact-requirement.test.ts rewritten |
| C6 ledger unaccounted | IN PROGRESS | No retrieved-total accounting; entity_id re-mint strands streamed entries; mergeDuplicateCandidates drops rows unledgered | worker: candidate-ledger.ts accounting + resilient identities; candidate-merge.ts merge report; funnel call sites in spec-search.functions.ts (mine) | candidate-ledger invariant tests |
| C7 React console errors | IN PROGRESS | Nested `<button>` in lead-card; raw-value keys collide | worker: lead-card.tsx, result-tabs.tsx, entity-detail-panel.tsx; discover.tsx zero-state keys (mine, pending) | component vitest + Discover console |
| C8 gapfill junk queries | PENDING | buildResearchPlan discoveryQueries include literal `"startup"` filler; gapfill = first discoveryQuery, not derived from unmet criteria | source-plan.ts :346-430, live-gapfill.ts :605 | planner tests |
| C9 zero screen generic | FIXED (code) | Trace narrative existed but ignored candidate-ledger "found but unproven" story; sourceHealth summary often absent | outcome-ui.ts `enrichZeroNarrative` + discover.tsx wiring | manual + narrative unit test (pending) |
| C10 streamed-verified rows vanish | IN PROGRESS | Stream event said "Candidate verified" before strict gate; dedupe/identity-mutation removes rows with no per-row ledger trail | worker: announceVerified split (Candidate found/provisional vs verified); ledger merge report + funnel ledgering (mine) | browser-live.server.test.ts |
| C11 intent signal dropped | IN PROGRESS | relation `custom` (complaining/asking/recommendations) absent from EVIDENCE_BY_RELATION, MODE_BY_RELATION and spec signalRequired list; SOCIAL_TOPIC regex missed complain/frustrated/struggle/rant | worker PARSER: vocab.ts, to-search-spec.ts, fallback.ts + corpus cases | understanding vitest + I02 rerun |
| C12 tautological evidence | PENDING | DB rows mint identity evidence restating own fields; why-match = evidence[0] identity | spec-search.functions.ts identity-evidence minting, evidence.ts whyMatchFromEvidence, claim-aware qualification | delivered-row inspection |
| C13 place-span glue | IN PROGRESS | takePlaceSpan swallows activity tokens; plausiblePlace passes "building fintech"; WORLDWIDE_PLACE misses glued prefix | worker PARSER: lexicon.ts stop-tokens, fallback.ts, to-search-spec.ts prefix strip + corpus | M03 case corpus |
| C14 Stop unclickable during browsing | FIXED (UI) | Stop button sat under live narration/activity re-rendering every 1.5s poll → Playwright stability never satisfied (45s actionability timeout). Visible ≠ activable. | discover.tsx: single viewport-anchored floating Stop (fixed bottom-4 right-4 z-50), inline control removed | X01/X02 rerun |
| C15 wrong-password silent | IN PROGRESS | Toast-only feedback (short-lived sonner) read as silent; repair() catch swallowed | worker: auth.tsx inline role=alert + loading-state fix | qa-auth-lifecycle.mts |
| C16 no project/ICP/watch lifecycle | PENDING | deleteIcp/deleteSavedSearch/deleteList exist server-side with NO UI callers; no deleteProject fn; watches have no pause column | projects.functions.ts (deleteProject), projects pages, watches-hero (pause), watch-scheduler (enabled filter) | E2E persistence tests then cleanup |

## NEXT EXACT ACTION
1. Wait PARSER/UI-1 workers → review diffs → relaunch CONTACT + LEDGER workers (concurrency-blocked).
2. applyClarificationToFrame: clear matching unresolved entries + accept geo_scope answers (after PARSER lands).
3. C12 + C6 funnel ledgering in spec-search.functions.ts (mine).
4. C16 lifecycle (worker), C8 gapfill (worker or self), browser pacing/triage (self), challenge takeover surfacing (self).
5. Focused tests → gates → incremental commits per family.
