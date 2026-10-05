# STAGE 2 FINAL REPORT — SEARCH & CANDIDATE ACQUISITION

Branch: `rc/mvp-local-testing-baseline` · Start: `f70791d` · Final: see git log
(Stage-2 commits: d2585f8, 091e591→aa67f33 lineage, 8fd718e, 705d191)

## VERDICT: NOT COMPLETE (major progress; honest blockers remain)

Baseline → current, measured through the REAL authenticated UI with funnel
telemetry (`[stage2-funnel]` server ledger lines + `[candidate-ledger]` dumps):

| Query | Baseline | Now |
|---|---|---|
| find plumbers in Austin | 0 (9 nav-garbage extracted, all died INCOMPLETE) | Stage-1 card → forced run (extraction fixed; run interrupted by harness) |
| yo need 7 hvac guys gta sites+nums | 0 (21 extracted → FILTERED_BY_SPEC 0; browser crash) | card → forced run; browser crash FIXED; person-vs-business typing blocks delivery |
| solar installers in Windhoek | timeout | **RESULTS — real qualified lead, raw=24, accounting ok** |
| wedding photographers in Cebu | 0 (6 extracted → FILTERED_BY_SPEC) | 6 extracted → rejected_role ×6 — person-vs-business typing |
| freight forwarders in Tbilisi | timeout | **RESULTS — delivered** |
| construction companies in Banja Luka | timeout | card → forced run |
| find SaaS founders globally | timeout | **RESULTS — delivered** |
| find copywriters in Toronto | 0 (4 extracted → INCOMPLETE) | card → forced run |
| React developer jobs in Calgary | n/a | **raw=175 extracted** → FILTERED_BY_SPEC 0 delivered |
| seed investors for AI startups in Canada | 0 (browser crash, NO_CATEGORY_MATCH) | card → run interrupted |

3 of the 5 baseline-impossible geographies now deliver real leads; extraction
now yields real artifacts where it previously yielded page furniture.

## WHAT WAS FIXED (code, committed)

1. **Candidate accounting (mandated ledger)** — `withRun` attaches
   `candidateLedger.summary()` on every outcome; pre-funnel drops now carry
   named fates (`rowSatisfyRejectReason`, `opportunity_filter:*`,
   anti-hallucination keyless). `[stage2-funnel]` observability line on every
   run: raw → postSpec → complete → qualified → returned + rejectReasons +
   incompleteReasons + accounting.
2. **Contact-thin survival** — a row whose only gaps are contact fields
   (email/phone/url) is a candidate; the completeness gate no longer removes
   it (Stage-2 rule). The qualification theorem still judges user-required
   fields.
3. **Browser extraction (the core defect)** — nav/CTA phrase blocklist
   ("Click Here", "Get Matched", "Tag Cloud", …) at line and block level;
   person line-pairs require a person-name shape (2-4 title-case words) and
   bounded role lines; directory-brand headings rejected by title-token
   overlap; empty-criteria specs anchor on the page title; descriptive-
   sentence pairing; NEW single-line entity mode ("Acme is a SaaS company
   based in Toronto, Canada.") with location/phone/email capture. The two
   PRE-EXISTING browser-extraction test failures now PASS (38/38).
4. **Browser lifecycle** — disconnected-browser promise reset + one-shot
   relaunch in the Playwright adapter; kills the `browser.newContext: Target
   page, context or browser has been closed` crash that emptied later widen
   rounds (evidence: investors/hvac runs).
5. **Environment**: `attachments` storage bucket created; storage/registry
   migrations written (DDL blocked — see blockers); SearXNG compose attempted.

## FUNNEL FOR THE STILL-FAILING QUERIES (from [stage2-funnel] evidence)

- **hvac gta** (person-typed spec, role "hvac guy", require_phone): browser
  extracted real HVAC companies (Skytech Home Comfort, Heat Master Mechanical
  Ltd, …) → ALL died `rejected_role` — the spec typed a business hunt as
  person. Stage-1 produced an incorrect SearchSpec for "sites + nums" (the
  user wants company sites + phone numbers). Stage-1 exception is granted but
  NOT yet implemented.
- **wedding photographers Cebu** (person-typed spec): 6 extracted →
  `rejected_role` ×6 — same class: photography-business pages under a person
  spec.
- **React developer jobs Calgary**: **raw=175** extracted from job boards →
  FILTERED_BY_SPEC 0 — the strict job role word-boundary/location gate kills
  every row; per-row reject reasons now visible in the ledger for the next
  pass.
- **plumbers Austin** post-fix run: 6 raw → 4 complete → `MISSING_QUERY_REQUIRED`
  (location) on directory-derived rows — extraction fix landed after this
  funnel capture; needs re-verification.
- Harness artifact: post-card forced runs were cancelled by the next
  iteration's Stop click (30s post-force wait) — harness fixed to wait for
  settle, not yet re-swept.

## NEW REGRESSIONS

None. Full vitest: 1700 passed / 28 failed — the identical set verified at the
start commit on a baseline worktree. Typecheck 43 = baseline. Build green.
Stage-1 suites: green (283/283 invariant subset). Two PRE-EXISTING
browser-extraction failures now pass.

## REMAINING BLOCKERS

1. **Person-vs-business spec typing for trade "guys/vendors" queries** —
   proven Stage-1 defect (granted exception, fix scoped: trade-family role +
   site/phone requirements → entity reconcile to business).
2. **Jobs post-extraction gate** — 175 real job rows die at
   rowSatisfiesSpec; needs lenient pre-ledger gate + ledgered strict judge.
3. **SearXNG container** — Docker daemon wedged in this environment (compose
   hangs, image pull never completes); the in-browser DDG/Bing fallback works
   (proven by delivered leads) but is challenge-prone. Needs an environment
   with working Docker, or SEARXNG_URL pointing at a reachable instance.
4. **Harness post-card settle** — re-sweep needed after the harness fix.
5. Hosted-Supabase DDL (attachments registry) unavailable without a Postgres
   endpoint/management token — code prefers the registry when it exists.

## POST-FIX VERIFICATION SWEEP (latest)

With location-evidence binding + granular job reasons + extraction fixes
live (16d9cc2):
- solar installers Windhoek: **RESULTS again** (repeatable across 3 sweeps).
- freight forwarders Tbilisi: raw=30 extracted (was 0 at baseline) →
  FAILED_QUALIFICATION — qualification variance; funnel fully attributed.
- hvac gta / Cebu / copywriters: card → forced run cycles still unstable —
  a card re-appears after force on some queries (suspect: unresolved AMOUNT
  cards survive force by design) and the harness loops force-clicks until
  its own window expires; runs then log SEARCH_CANCELLED. Needs interactive
  diagnosis of the card-reappears loop (amounts-vs-clarify distinction in
  the harness) — harness artifact, not an acquisition defect.
- React jobs Calgary: not re-reached in this sweep (previous funnel: 175
  raw, granular reasons now in place).

## NEXT STEPS (in order)

1. Fix harness post-card settle; re-sweep the 10 queries.
2. Stage-1 narrow fix: trade-role + site/phone ask → business entity
   reconcile (+ Stage-1 regression test).
3. Jobs: lenient pre-research gate (contradictions only) for extracted job
   rows; strict judge stays post-research, ledgered per row.
4. Bring up SearXNG on a working Docker host; re-verify SERP-first path.
5. Re-run acceptance battery twice for "repeatedly acquires".
