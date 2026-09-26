# Runtime drop evidence — existing logs only

No new search was run for this audit. Most recent preserved runs: `tmp/v1-A6.log`, `tmp/v1-B4.log`, `tmp/v1-C4.log`. A's previous completed-but-zero run, `tmp/v1-A5.log`, and the older A2/B2/C2 logs are useful context. “Discovered” source artifacts, browser memory candidates, and core deduped rows are different counters.

## A — Austin plumbers / no website (`v1-A6.log`)

| Stage | Observed count |
|---|---:|
| DB discovery | 10 pg-index rows; 11 S3 rows in prior completed A5 run. A6 lists both engines but does not emit a final DB row count. |
| OSM discovery | NOT INSTRUMENTED in A6; run cancelled before a completed live trace. A2 had 58 OSM hits; A5 had 7. |
| Normalized / post-Spec | NOT INSTRUMENTED in A6 (no final `spec-run` trace). |
| Research seeds | 10 supplied, 10 accepted, 10 resolved (`browser-live action=seed`). |
| Researched | 2 `Researching` progress events; aggregate distinct candidate count NOT INSTRUMENTED after cancellation. |
| Website checks | 3 `Verifying website absence` progress events. |
| Enriched | NOT INSTRUMENTED. |
| Qualified / final | 0 / 0; `SEARCH_CANCELLED` at 149,141 ms. |

**Last nonzero stage:** browser research began for indexed seeds. **First observable loss to zero:** `browser-live.server.ts:discoverWithBrowser` receives the run abort while verification is incomplete, then `spec-search.functions.ts:runSpecSearchCore` catches `SEARCH_CANCELLED` and returns an empty `rows` response. One official destination was found, which correctly contradicts absence for that candidate. In A5, 10 candidates were researched and 20 check actions occurred, but none gained qualifying bounded absence evidence; `qualify.ts:qualifyLead` returned `NO_CLAIM_EVIDENCE` and 0 rows. A6 additionally shows one successful structured search followed by empty/fallback searches before cancellation.

## B — global SaaS founders (`v1-B4.log`)

| Stage | Observed count |
|---|---:|
| Source discovery | 15 direct-http rows; 4 browser memory candidates; provider scan 19 artifacts. |
| Initial browser seeds | 6 supplied, 2 accepted, 0 resolved at seed time. |
| Core normalized/merged | 17 raw candidates; 11 post-Spec matches (6 filtered/deduped between these counters). |
| Researched | 2 browser candidates (`browser-live status=partial`). |
| Enriched | Adapter success count NOT INSTRUMENTED; 9 still `pendingEnrichment`. |
| Complete / qualification input | 2. One rejected: Renji Bijoy, `EMPLOYMENT_UNPROVEN` (missing organization entity ID on claim). |
| Qualified / final | 1 / 1, Harry Stebbings; 101,551 ms. |

**Last nonzero stage:** final result delivery. **First observable candidate reduction:** `live-gapfill.ts:runLiveGapfill` passes only six initial non-no-site rows, then `browser-live.server.ts:discoverWithBrowser` accepts two provisional source seeds. Later the core falls from 17 raw candidates to 11 post-Spec matches and leaves nine pending enrichment. The exact contribution of dedupe versus each individual `rowSatisfiesSpec` condition is NOT INSTRUMENTED. B2 (older) had 0 final rows; B4 establishes that one founder can traverse the full path.

## C — Toronto SaaS companies (`v1-C4.log`)

| Stage | Observed count |
|---|---:|
| DB/index | 0 pg-index; S3 tier timed out after 5,000 ms. |
| Source discovery | 15 direct-http rows; 7 browser memory candidates; provider scan 22 artifacts. |
| Initial browser seeds | 4 supplied, 3 accepted, 0 resolved at seed time. |
| Core normalized/merged | 19 raw candidates; 14 post-Spec matches (5 filtered/deduped between counters). |
| Researched | 2 browser candidates (`browser-live status=partial`). |
| Enriched | Adapter success count NOT INSTRUMENTED; 12 still `pendingEnrichment`. |
| Complete / qualification input | 2; 0 qualification rejects. |
| Qualified / final | 2 / 2, Blue J Legal and VendorPM; 94,174 ms. Both have official sites and public phones; one has a public email. |

**Last nonzero stage:** final result delivery. **First observable candidate reduction:** `browser-live.server.ts` accepts three of four initial seeds, followed by merge/Spec filtering from 19 raw to 14 post-Spec matches. Twelve remain pending enrichment, and only two enter final qualification. Individual field-level reasons for those 12 are NOT INSTRUMENTED. C3 (older) returned zero with generic heading candidates; C4's final two rows show that path was partially repaired.

## What the counters cannot prove

`retrievalTrace.rawCandidates` combines DB rows and live rows after some merges; it is not a count of unique real-world entities. `pendingEnrichment` is the leftover incomplete pool, not an adapter failure count. Browser `verified` is a memory status, while core `qualified_count` counts delivered rows. None of the three logs records per-candidate transformations at every boundary; the drop ledger identifies the code where uninstrumented loss can occur.
