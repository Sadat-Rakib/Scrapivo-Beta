# Actual candidate lifecycle

`[X]` means the branch can remove a candidate from eventual output. `[R]` means current code gives it some research/enrichment path. This is the active Spec path, not a proposed design.

```text
/discover submit → authenticated runSpecSearch → understand SearchSpec
  ├─ [X] clarification/mode gate → no search rows yet
  └─ DB/index/S3 retrieval
       ├─ [X] source SQL/coverage/timeouts/early-stop: never fetched
       ├─ [X] rowSatisfiesSpec + opportunity + indexed-key filters
       ├─ complete ────────────────┐
       └─ incomplete [R] capped site-contact enrichment
                         [R] all merged DB rows → query-aware enrichment
                                      │
                         qualified DB count decides live need
                                      │
                      OSM / SearXNG source discovery
                       ├─ [X] adapter filters/caps
                       ├─ [R] structured no-site / first-six research seeds
                       │      └─ [X] seed eligibility, browser memory cap,
                       │              source-page cap, page/query/time budget
                       │              └─ [R] identity/destination/evidence research
                       │                      └─ returned candidate memory
                       └─ source rows ───────────┘
                                      │
                     mergeDuplicateCandidates
                                      │
                     [X] live rowSatisfiesSpec
                                      │
                     sanitize + completeness split
                       ├─ incomplete [R] capped site-contact pass
                       │     └─ [X] still incomplete → pendingEnrichment,
                       │             excluded from final qualification
                       └─ complete [R] query-aware enrichment
                                      │
                         [X] qualifyLead / theorem /
                             no-site, person, signal, evidence gates
                                      │
                         qualified rows only
                                      │
                     soft-duplicate mark → pagination [X]
                                      │
                         SpecSearchResult.rows
                                      │
                     [X] stale run/turn response check
                                      │
                     [X] QualifiedLead re-projection gate
                                      │
                     local-business or lead turn state
                                      │
                     [X] conditional/folded result section
                                      │
                         visible card/table
```

A6 reached the `[R]` no-site browser branch and then cancelled before evidence/qualification. B4 and C4 each traversed to visible **server rows** for a small subset; UI card rendering was not exercised by those core logs.
