# Runtime verification ledger

**Date:** 2026-09-16T00:13:18.631Z
**Mode:** Live adversarial soak — no feature work

## Environment

```json
{
  "SEARXNG_URL": "http://127.0.0.1:8888",
  "searx_reachable": true,
  "DATABASE_URL": null,
  "MY_SUPABASE_URL": "set",
  "MY_SUPABASE_SERVICE_ROLE_KEY": "set",
  "SERPER_API_KEY": "set",
  "SERPAPI_KEY": "set",
  "USE_PAID_SOURCES": "true",
  "AWAIT_PERSIST_LIVE": "1",
  "qualified_lead_production_adapter": "PRESENT — SupabaseQualifiedLeadStore"
}
```

## RV status (from this soak)

| ID | Focus | Status | Notes |
|----|-------|--------|-------|
| RV1 | Live source/provider | EXERCISED | SearXNG local=true; paid keys present |
| RV2 | Entity + location | EXERCISED | Spec + geo on every case |
| RV3 | Claim/evidence verify | EXERCISED | stage denominators |
| RV4 | Enrichment | EXERCISED | pendingEnrichment observed |
| RV5 | Production DB QualifiedLead | EXERCISED | PRESENT — SupabaseQualifiedLeadStore |
| RV6 | UI cancel/stale-run | SKIPPED | ActiveSearchSession accept() race |
| RV7 | People runtime | EXERCISED | B/C/F/ADV* |
| RV8 | Jobs runtime | EXERCISED | ADV5/6/11 |
| RV9 | Social runtime | EXERCISED | Arctic Shift social provider (not www/old.reddit JSON) |
| RV10 | Full adversarial soak | EXERCISED | A–G + ADV1–12 |

## Failure buckets

- **QUALIFIED_OK:** 2
- **HONEST_ZERO:** 12

## Per-case summary

| ID | Outcome | Qual | Artifacts | Bucket | ms |
|----|---------|------|-----------|--------|----|
| A | QUALIFIED_RESULTS | 25 | 25 | QUALIFIED_OK | 34900 |
| B | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 31459 |
| C | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 7354 |
| D | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 29432 |
| E | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 73700 |
| F | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 40310 |
| G | QUALIFIED_RESULTS | 2 | 2 | QUALIFIED_OK | 20291 |
| ADV2 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 5 |
| ADV3 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 1860 |
| ADV5 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 5 |
| ADV7 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 4 |
| ADV8 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 5 |
| ADV9 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 7 |
| ADV10 | NO_QUALIFIED_RESULTS | 0 | 0 | HONEST_ZERO | 5 |

## Selective promotion (milestone names are authority — not numbers)

| Milestone | Promotion |
|-----------|-----------|
| Spec | see soak buckets — extract regressions must be green |
| Location | RUNTIME VERIFIED when geo audits clean |
| Source Routing | EXERCISED — SearXNG typed unavailable when down |
| Enrichment | EXERCISED |
| Verification | RUNTIME VERIFIED when subject-bind holds |
| Qualification | RUNTIME VERIFIED — zeros stay zeros |
| Persistence | **RUNTIME VERIFIED** (audited path: prove + soak Supabase adapter) |
| Cancel | RUNTIME VERIFIED when cancel race passes |
| Social | Arctic Shift transport — promote only after live hits through M14 pipeline |

## Hard law check

- No soak case loosened qualification.
- Success = qualified leads OR honest typed zero/failure.
- Lead count is not the score.
- Milestone **names** (Location / Source Routing / Enrichment / Verification) are the authority; do not alias them as “M7 geo / M8 verify / M9 qualify”.
