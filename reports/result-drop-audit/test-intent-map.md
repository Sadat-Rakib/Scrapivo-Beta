# Focused test intent map

Included tests are executable specifications, not evidence that current public web searches succeed. They use fixtures, fake browser adapters, injectable providers, or mocked rows; none is the live A/B/C runtime acceptance path.

| Test file | What it claims to verify | Mocked or real | Drop boundary covered |
|---|---|---|---|
| `src/lib/search/browser-live.server.test.ts` | Snippet/list fanout, source provenance, identity extraction, official site/contact resolution, no-site research, blocked pages | Fake browser and observed-page fixtures | Browser memory creation/research/URL semantics |
| `src/lib/search/browser-live-fallback.test.ts` | Named entity extraction when model extraction unavailable; list remains source | Fixture text/model fallback | Source → entity fanout |
| `src/lib/search/__tests__/live-browser-integration.test.ts` | OSM/Overture seeds reach browser, source/browser merge, web failure, cancellation | Injected OSM/web/browser adapters | `runLiveGapfill` seed filter and merge |
| `src/lib/search/__tests__/osm-no-website-seed.test.ts` | OSM missing site and directory URL remain unverified research seeds | Synthetic OSM elements | OSM mapping |
| `src/lib/search/__tests__/research-candidate-semantics.test.ts` | Source vs official destination, contact site, two exact checks, OSM/Overture absence evidence | Constructed SpecRows and injected research | No-site evidence gate |
| `src/lib/search/__tests__/candidate-merge.test.ts` | Shared IDs merge fields/evidence; unrelated article subjects stay separate | Constructed rows | Candidate dedupe/merge |
| `src/lib/search/__tests__/pipeline-phases.test.ts` | Completeness, capped enrichment promotion, why-match/signal behavior | Injected enrichment function and rows | Core completeness → enrichment → qualification |
| `src/lib/search/__tests__/m8-enrichment.test.ts` | Query-aware tiers, optional vs required contact, no-site restrictions, adapter failure/caps | Injected adapters/fixtures; production-shaped path is still mocked | Enrichment eligibility/merge/final gate |
| `src/lib/search/__tests__/m9-verification.test.ts` | Subject, claim type/parameters, time, provenance, and currentness evidence gates | Constructed evidence; production-shaped path is mocked | Claim verification |
| `src/lib/search/__tests__/milestone1-theorem.test.ts` | Stable entity/list-page/required-field theorem and typed outcomes | Constructed candidates | Qualification theorem |
| `src/lib/search/__tests__/m12-people.test.ts` | Founder role, company relation, currentness, identity collision and location | Constructed people/evidence | Person qualification |
| `src/lib/search/__tests__/m11-ui-run.test.ts` | Run cancellation, stale response rejection, QualifiedLead projection and evidence retention | Simulated server responses/client state | Final UI delivery gate |

The tests can pass with well-formed synthetic candidates while real web candidates fail earlier at source selection, sparse extraction, browser budgets, or post-browser `rowSatisfiesSpec`. The latest runtime logs in `runtime-drop-evidence.md` are the evidence for those real boundaries.
