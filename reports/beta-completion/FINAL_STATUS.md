# SCRAPIVO INITIAL BETA STATUS (Beta Completion Pass)

**READY FOR BETA (core engine) — live-network batteries still open, see KNOWN LIMITATIONS.**

Scope: this pass closed the remaining core-engine gaps and wired the frozen
principle **source registry = knowledge · real-time search = adaptability ·
browser = last-mile tool**. Feature ideation is frozen after this pass; next
mode is beta testing → failure triage → surgical fixes.

## SOURCE INTELLIGENCE
- `src/lib/sources/registry.ts` — SourceDefinition catalog: ATS families, job
  feeds, search classes (searxng/browser/paid-serp), db/osm/company-registry,
  official-sites, community; decisions (allowed / needs_key / needs_review /
  disabled), limits, attribution, never-contact host list.
- `src/lib/sources/recognize.ts` — URL/source recognition (ATS board + job id,
  blocked hosts, canonical job URLs). Wired into browser research pre-contact:
  never-contact hosts refused without any request; recognized ATS boards are
  recorded as `structured_job_source_recognition` evidence (ats/board/job id/
  canonical key) so the jobs pipeline uses the structured feed instead of
  browsing the human site.
- Registry decisions now gate the source plan (`source-plan.ts:
  registryBlockedProviderIds`): disabled/needs_review mapped providers cannot
  be planned (beta spec §64). Job feed/ATS gating stays inside the jobs
  pipeline.

## JOB COVERAGE
| ATS family | implemented | tested (fixtures) | live smoke | notes |
|---|---|---|---|---|
| Greenhouse | yes (prior) | yes | prior pass | — |
| Lever | yes (prior) | yes | prior pass | — |
| Ashby | yes (prior) | yes | prior pass | — |
| Workable | yes (prior) | yes | prior pass | — |
| Recruitee | yes (prior) | yes | prior pass | — |
| SmartRecruiters | yes (prior) | yes | prior pass | — |
| **Personio** | **yes (this pass)** | 24-test extension suite | **pending** | XML `<workzag-jobs>`, .de/.com, DNS-label slug guard |
| **Teamtailor** | **yes (this pass)** | same | **pending** | RSS pagination, .na fallback |
| **Gem** | **yes (this pass)** | same | **pending** | JSON, next_page follow, unknown-schema-safe |
| Workday | partial | yes | — | needs_review in registry — not planned by default |

Board directory seeds (`seeds/board-directory-2026-09-25.json`, 3,581 rows,
MIT JobSync lists) wired as DISCOVERY SEEDS only (`pooledBoardsFor`): seed-live
rows first, unverified rows only as spare-cap backfill, verified lazily by the
provider fetch itself; an unverified board is never advertised as a live
employer. Missing facts normalize to null; no invented defaults.

## BROWSER
- Goal-conditioned page relevance gate before any extraction (§23–25); THIN
  stays with the read ladders; friction verdicts (challenge/login/rate-limit/
  blocked) stay with the pre-existing Take-Control handoff so `captcha`
  rejection + CAPTCHA_DETECTED / HUMAN_ACTION_REQUIRED events keep working.
- Per-candidate page-waste budget; host-level verdicts degrade the whole
  domain for the run, never counted as "zero results".
- Domain pacer (per-host concurrency 1, min-gap + jitter, crawl-delay,
  Retry-After with 60s cap → HostPaceError fail-fast, friction-driven host
  blocks) wired into both the HTTP acquisition fetch and browser navigation.
- Recognized blocked/never-contact hosts are refused before any contact;
  degraded sources surface as SOURCE_DEGRADED, not empty results.
- No CAPTCHA solving, no fingerprint/stealth evasion, no auth bypass.

## SIGNALS
- WS7B Custom Signal Compiler V1 shipped end-to-end:
  `spec.custom_signal_text` → `compileCustomSignal` (Zod-validated
  observable indicators / search queries / evidence rules / negative
  indicators) → `runDeepSignalPass({ customSignal })` with a custom hunter on
  the same ladder and unchanged verification floor. Compile failure degrades
  to the default hunter; it can never kill the search.

## UNDERSTANDING / CLARIFY
- Unchanged this pass; 30 failing tests in the understanding/clarification
  cluster (mode-gate, offer-taxonomy, step2-resolver, coverage-planned,
  pagination, entity-taxonomy, thin-ask, provider-osm, phone-safety,
  understanding, jobs-spec-questions) were PROVEN pre-existing by running the
  identical subset at HEAD `dc7a9f2` via `git stash` A/B — they are the §21/§22
  gaps and are the first beta-testing triage targets.

## TESTS
- New/changed suites: 85/85 targeted + 35/35 research-agent + 22/22
  pacing/page/registry + 69/69 jobs + board-seeds 9/9 — all green.
- Full suite: 1,316 passed / 34 failed — 30 pre-existing (proven at HEAD),
  1 pre-existing (proven at HEAD isolated), 3 load-order timeouts that pass
  isolated (flake, not regression). Zero regressions introduced by this pass.
- Typecheck: 43 errors, all pre-existing (test-file type drift +
  research-agent.functions serialization signatures); zero in pass files.
- vitest config exclude repaired (had lost `**/node_modules/**` → vendored
  maplibre tests executed; `.agents/**`, `local-business-finder/**` added).

## LIVE VALIDATION — OPEN
- §54 real-query battery, §56 source-failure battery, §57 browser navigation
  battery: NOT executed against the live internet this session.
- Live smoke for Personio/Teamtailor/Gem: pending (fixtures only).
- Per §74 honesty rule: live smoke evidence in this file comes only from the
  prior data-asset pass; this pass adds none.

## DEFERRED (unchanged cuts)
Phone-type classification (LATER_WORK), Telegram, web push, CRM integrations,
multi-step outreach campaigns, generic desktop VM, mascot polish, extra
notification channels, custom-signal DSL beyond V1.

## KNOWN LIMITATIONS
- Live-network behaviors (Retry-After waits, robots delays, seed lazy
  verification, structured-feed yield at volume) are implemented and
  unit-tested offline but not yet validated against the live web.
- Registry↔plan mapping covers 6 confident 1:1 provider pairs; feed/ATS
  policy enforcement lives in the jobs pipeline, not the plan layer.
- The 30-test understanding/clarification cluster remains red (pre-existing)
  and will surface as clarification-quality issues in beta.
- `freehire` submodule churn + generated `routeTree.gen.ts` left uncommitted.

## NEXT STEP (beta mode)
1. Live smoke: one known board per new ATS family; hostile stand-in for
   429/Retry-After and challenge behavior.
2. Run §54 real queries on the dev server; classify failures per §71 and fix
   the subsystem, never the query string.
3. Triage the pre-existing understanding cluster.
