# FIX SPRINT STATUS — CLOSED (final handoff)

Branch: `rc/mvp-local-testing-baseline`. Sprint started ~08:22 MDT Oct 1 @ `d10892d`; closed Oct 2. No push, no main changes.

## Outcome
All 16 defect classes (C1–C16) closed — FIXED with live proof, except C12 (PARTIAL, deferred with reason). All gates green: full vitest NEW_FAILURES=0, typecheck 43 frozen, build + bundle clean, E2E matrix 9/9 rerun cases green, mobile 390/375/360 green, persistence + watch-lifecycle proofs green. Verdict: **READY (local MVP baseline)** — see `FINAL_STATUS.md`.

## What finished (this session's tail end)
- C6: candidate-ledger `absorbed` fate + `merged()` method; `mergeReportPairs` funneled at all 3 merge sites (src/lib/search/candidate-ledger.ts, candidate-merge.ts, spec-search.functions.ts).
- C9: enrichZeroNarrative unit tests (src/lib/search/__tests__/full-v1-additions.test.ts).
- 9 vt NEW regressions bisected + fixed: df383d1 SERP gate starvation (browser-live.server.ts starvation fallback + triage `score > -50`), 7bfc657 unobserved-seed echo post-cancel (browser-live.server.ts `unobserved` flag), 01d2b68 force-bypass of explicit unresolved amounts (spec-clarification.ts).
- Zero-outcome honesty: hasMore/moreAvailableMessage require delivered rows (spec-search.functions.ts, pagination tests repaired 8/8).
- m360 thin-ask-on-zero limbo: zero chrome applied unconditionally (src/routes/_authenticated/discover.tsx).
- C7 residual: ThinkingSteps render-phase setState fixed + component test (src/components/discover/thinking-steps.tsx).
- Harness: raced-settle honest recording + `[role=button]` selector modernization (tools/qa-run.mts); watch lifecycle probe (tools/qa-watch-auth-probe.mts).
- vitest sweep: foreign `Cotly/` excluded (vitest.config.ts).
- E2E proofs: matrix M03 M05 S01 I01 I02 P04 L05 P02 R03 all green; C1/C15/persist/watch-lifecycle scripts green; stray "Plumbers in Edmonton" watch deleted (zero artifacts).

## Files saved
Ledgers: reports/final-stabilization/{DEFECT_STATUS,TEST_RESULTS}.md · reports/full-e2e-validation/{FINAL_STATUS.md, DEFECTS.md, WRITE_CLEANUP.md, FIX_SPRINT_STATUS.md} · evidence/runs/*.json(+.response.txt) · evidence/{persistence,profile-edit,auth-lifecycle,watch-auth-probe}.json · evidence/gates-fix-final.json · logs/*.

## Failed / not done
- BrowserNavigationPolicy NOT wired into browser-live — DEFERRED WITH REASON (yield cut vs inert clamp; nav-loop restructure risk). Ledgered in DEFECT_STATUS.md.
- C12 claim-aware evidence beyond contact — deferred (C5 covers trust-critical path).

## Tail-end sweep (Oct 2, "finish everything remaining")
- Radix DialogTitle a11y warnings (L05 2×): FIXED — sr-only titles on the three untitled sheets (app-shell navigation + chat history, discover mobile detail). L05 live rerun: 0 warnings, behavior unchanged (settled, 1 delivered).
- qa-run `savedTitle` domain-line quirk: FIXED (evidence labeling only).
- `.kiro/freehire` spec stale `[~]` markers reset to `[ ]` and committed — the spec is explicitly a separate, not-started workstream (needs Docker/Meilisearch live + its own sessions; not completable "properly" inside this sprint).
- Gates re-verified after the sweep: typecheck 43 frozen, vt NEW_FAILURES=0, L05 green.

## MVP-recovery pass (Oct 2, after the "finish everything" sweep)
- PRD recon: P0–P7 already met with evidence; gaps were widening, BUG-09 letter, SearXNG preflight, dev funnel diagnostics, and the PRD-mandated `reports/mvp-recovery/` artifacts.
- Landed `a70d148`: bounded interactive widening (shared job-engine semantics, ≤3 passes, constraints never loosened), OSM contact extraction (multi-value phones, `contact:mobile`, `url` fallback — **L05 live 1 → 34 delivered**), delivery-predicting widen metric, `scaledRunBudgetMs` widening reserve + first-pass floor, BUG-09 scroll fix, SearXNG startup preflight (worker+app), dev-gated funnel dump with perSource diagnostics.
- `reports/mvp-recovery/` created: PIPELINE_MAP.md (real path, file:line-cited), ROOT_CAUSE_REPORT.md (9 PRD questions), FINAL_STATUS.md (§63 format).
- **OPEN (the one named blocker, see mvp-recovery/FINAL_STATUS.md MVP VERDICT):** widen loop does not engage when the initial acquisition falters (W1: stored 0 → yelp bot-wall → NO_QUALIFIED_RESULTS, no widen pass); SSR console is not observable in this dev setup, so the next fix is progress-registry widening events + an initial-phase/ widening budget split.
- **Incident note:** a stray `git checkout -- spec-search.functions.ts` during a watcher test wiped the uncommitted widening wiring; it was fully re-applied from the implementation agent's record and committed (`a70d148`). Lesson applied: commit immediately after verification, never leave large uncommitted work.

## Local-testing recovery directive pass (Oct 2, PRD phases 1/3/4)
- `360fef6` **Phase 1** — entity type vs trade separated: a business entity carrying org fields (website/phone/category/location) survives normalization even with an unseen trade; person/job/investor gates unchanged. Regression tests: unseen-trade business accepted, person-kind without signals still rejected.
- `1bcb6f8` **Phase 3** — staged browser page allocation: SERP links classified direct-vs-directory (static host list, classification only — not a blocklist); per-pass scheduling 3 direct + 1 directory (was a flat 2), rejection reasons preserved. Test: 10-link SERP → 4 scheduled, direct sites first, directory last, cap 6.
- `e474494` **Phase 4** — widen passes re-run only the specific trade tags; the generic office=company fallback gets its one bounded shot on the initial pass (Windhoek pass-2 188-artifact re-flood eliminated). Mississauga behavior preserved (initial pass unchanged).
- Full gate: **NEW_FAILURES = 0** (1600/1666, 51 KNOWN_RED frozen) — `logs/vt-v2final.txt`.

## Open queue (next iteration, evidence-first)
1. **Phase 9** — informal-query understanding: N2 ("anyone doing solar installation around Windhoek?…") asked the ENTITY question ("people, companies, local businesses, or investors?") — the activity/entity extraction from "doing X around Y" shapes must reach the spec before clarify (evidence: `evidence/runs/N2.json` clarify block). Distinct from the fixed dead-loop.
2. Composer stop button (Phase 8) + worker takeover handshake probe (Phase 10).
3. The six PRD V2 acceptance queries through the real UI with funnel+ledger capture; MVP re-grade per Phase 12.
4. Server cold starts take 60-90s on this machine — warm before first traffic (transient FATALs otherwise).

## Browser-live forensic pass (Oct 2, PRD V2)
- WS1 DONE (`68c744c`, `2d0341a`): per-query browser funnel — serp/links/links-rejected(+reasons)/pages/extraction/normalization(+reasons)/emitted, stage-classified, surfaced on retrievalTrace.providers[browser-live].queryFunnel + dev `[browser-funnel]` lines. Every zero names its stage.
- Windhoek browser zero DECODED: SERPs return 10 links each → per-query page **cap visits only 2** → extraction works (8-9 entities on directory pages) → **ENTITY_TYPE_MISMATCH killed all** (kind regex had no solar/installer words) → fixed `77b9cb6`; a candidate then emitted ("Densys Renewable Energy") and died at the pre-research gate — `craftMatches("renewable energy","solar panel installer")` was a false contradiction → trade-family matching landed `6bf6d31` (strict post-research gate unchanged).
- OPEN (next iteration, in order): WS3 OSM low-yield failover (generic office=company pool floods the funnel — book LOW_YIELD, reserve budget for browser); WS4 redundant clarify ("What should they be doing?" for an explicit activity — understanding must carry activity into the spec pre-clarify); WS5 composer stop button (replace the floating pill); WS6 worker takeover handshake probe; the six PRD V2 acceptance queries through the real UI; docs normalization per WS8.
- Verdict (evidence-backed): **NOT READY FOR USER LOCAL TESTING** — browser acquisition converts 9 searches into 0-1 candidates; the causes are now named and fixed layer by layer (cap starvation + kind vocabulary + category families), but a full acceptance pass with delivered > 0 on browser-supplied queries has not been observed yet.
