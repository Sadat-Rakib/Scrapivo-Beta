# Phase G — Integrate last (deferred)

Per plan: integrate only after Phase F re-audit. CRITICAL fills (E) and unit verification (F) are done; full product assemble is **deferred**.

## Done now (tiny unblocks from E)

- Removed “Researching: hot index → S3 → providers” thinking line
- Hide anon · 0 engagement on canonical/directory detail chrome
- Spec path live-web for company/person (+ business OSM→web fallback)
- Thin threshold (`THIN_COMPLETE = 5`) re-triggers live gapfill

## Explicitly deferred (do not claim done)

| Item | Why deferred |
|------|----------------|
| Full unified card/detail redesign | Plan non-goal until re-audit |
| Write-back verified discoveries into store | Needs live proof + storage ops |
| Source health monitoring dashboard | Ops track |
| Scout / OpenMagpie / Harken clone | Prefer in-tree; research in `06-solutions.md` |
| Agentic browser-use | Only after live-web fails thin geos in prod |

## Re-entry criteria

1. Battery soft-pass ≥ existing baseline with new cases (`founders-b2b-india`, `founders-worldwide`)
2. Prod smoke: company hunt in thin geo returns `engine=live-web` with evidence URL
3. Then open a dedicated integrate change — not this audit window
