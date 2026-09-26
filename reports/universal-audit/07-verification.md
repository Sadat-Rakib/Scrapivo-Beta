# Verification checklist (Phase F)

Mark COMPLETE only with a test id. Soft-pass battery alone is not enough for geo COMPLETE claims.

| # | Check | Test / proof | Status |
|---|-------|--------------|--------|
| 1 | Company/person live ≠ live-none | Battery 2026-09-14 local SearXNG `127.0.0.1:8888` — see live hits below | **PASS** |
| 2 | Arbitrary NL extract | `universal-audit-fills.test.ts` | PASS (unit) |
| 3 | Unicode geo Medellín | same | PASS (unit) |
| 4 | Worldwide no location ask | same + `mentionsPlace` | PASS (unit) |
| 5 | Craft nouns coffee/yoga | same | PASS (unit) |
| 6 | CTO plural + B2B founders → person | same | PASS (unit) |
| 7 | SIGNAL SEO help | same | PASS (unit) |
| 8 | Enrich completeness contact_or_site | `pipeline-phases.test.ts` | PASS (unit) |
| 9 | Why-match browsing businesses | same + deriveWhyMatch | PASS (unit) |
| 10 | Job HTML entities | sanitizeJobText | PASS (unit) |
| 11 | Thinking steps no researching line | `thinking-steps.test.ts` | PASS (unit) |
| 12 | Soft dups + formatPlace | universal-audit-fills | PASS (unit) |
| 13 | Live e2e thin geo | `scripts/battery-spec-inputs.mts` + `tmp/battery-spec-inputs-live.jsonl` | **PASS** |
| 14 | Geo matrix COMPLETE claim | — | NEVER without per-ISO live hit |

## Live-web proof (2026-09-14)

**Setup:** Render `searxng-bgj26.onrender.com` dead (404). Local `searxng/searxng` on `http://127.0.0.1:8888` (JSON on, limiter off). `.env` permanently set to `SEARXNG_URL=http://127.0.0.1:8888` (do not reintroduce the dead Render URL).

**Battery:** `npx tsx --env-file=.env scripts/battery-spec-inputs.mts` → **43/43** soft-pass (exit 0).

**Post-implementation reality check (2026-09-14):** 43/43 ≠ product complete. See [09-post-implementation-reality-check.md](09-post-implementation-reality-check.md) + `tmp/reality-check-traces.jsonl` (Tests A–G). Pre-Phase-1 verdict: **NO — CRITICAL GAPS REMAIN**.

**Phase 1 code (2026-09-14):** Acceptance Tests 1–10 in `src/lib/search/__tests__/phase1-acceptance.test.ts` — **PASS** (vitest). Covers plurals, semantic direction, directory contamination, evidence, why-match, VERIFIED persist gate, social provider on SPEC, funding path, relevance/intent split, free-first skip. A–G live replay + write-back: `tmp/reality-check-traces.jsonl` — persist via Supabase service-role on C/E/F/G (see `09` persist table). Raw `DATABASE_URL` optional (`pg` not installed; host documented in `.env`).

| # | Phase 1 check | Proof | Status |
|---|---------------|-------|--------|
| P1-1 | Plural signals | `phase1-acceptance` Test 1 | **PASS** |
| P1-2 | No industry-from-help | Test 2 | **PASS** |
| P1-3 | Directory contamination | Test 3 + `pipeline-phases` Phase C | **PASS** |
| P1-4 | Evidence schema | Test 4 | **PASS** |
| P1-5 | Evidence-backed why-match | Test 5 | **PASS** |
| P1-6 | VERIFIED ≠ name+url | Test 6 (`isVerifiedForPersist`) | **PASS** (unit); live DB round-trip optional |
| P1-7 | Social provider on SPEC | Test 7 + `social-signal.ts` | **PASS** |
| P1-8 | Funding path | Test 8 | **PASS** |
| P1-9 | relevance / intent / why | Test 9 | **PASS** |
| P1-10 | Free-first no parallel paid | Test 10 + `provider-ladder.ts` | **PASS** |

| id | entity | rows | liveDiscovery | evidence |
|----|--------|-----:|---------------|----------|
| d2c-reykjavik | company | 10 | completed | Live web result · www.instagram.com |
| founders-ny | person | 5 | completed | Live web result · www.linkedin.com |
| founders-lagos | person | 4 | completed | Live web result · foundersbase.com |
| biz-yoga-tbilisi | business | 12 | completed | fitness_centre near Tbilisi (live-osm) |
| biz-antarctica | business | 1 | completed | Live web result · www.facebook.com |
| vague-co | company | 0 | not_required | clarify industry+location (PASS) |
| jobs-bare | job | 12 | not_required | provider-jobs path (PASS; expect=jobs) |

Log: `tmp/battery-spec-inputs-live.jsonl`.

### Soft fails cleared (not live-web regressions)

| Case | Prior fail | Cause | Fix | Re-run |
|------|------------|-------|-----|--------|
| `vague-co` (`yo need companies rn`) | expected clarify; got live-web | `SIGNAL_HINT` matched bare `need` → `signal_required` skipped clarify | Require object after need(ing); unit asserts clarify | **PASS** — clarify, 0 rows |
| `jobs-bare` | expected clarify; got provider-jobs | Battery expect was clarify; role-only jobs are ready by design | Battery expect → `jobs` | **PASS** — 12 provider-jobs rows |

Some thin company cases can still show `db_thin_gapfill_pending` when SearXNG returns empty — path still ran; checklist #13 is proved by the hits above.

## Battery extension

Present in `scripts/battery-spec-inputs.mts`: coffee/yoga/Medellín, worldwide + B2B founders, CTOs Berlin, SEO signal.

## Ops

Storage-full dumps: prefer partitioned S3; live gapfill reduces preload pressure. Documented in `05-gap-matrix.md` OPS row — not blocking live path.

## Env note

`SEARXNG_URL` **must** stay on a live instance. Configured: `http://127.0.0.1:8888` (local Docker). Dead Render host must not remain configured.
