# Phase 1 evidence — extraction cause telemetry (P1-C)

Run: `evidence/runs/{B2,D2}.json` (post-1daac8e), funnel lines `logs/dev-live.log` (2026-10-02).

## B2 — construction companies Banja Luka
- 3 browser queries, each: SERP ok, 10 links observed, 3 accepted, **2 navigated -> 0 pagesExtractable**.
- `extractionCauses: {}` on every query — **the LLM extractor was never invoked**. The two navigated pages were dropped at the readPage/classification boundary (page-content/page-classification drop), before extraction.
- Verdict: EXTRACTION_EMPTY here is a PAGE-SELECTION/CLASSIFICATION drop, not provider quota, not model failure. The page-outcome trace events (`kind:"page"`) name the specific classification but are not yet aggregated into the funnel (additive follow-up).
- B2 also did NOT settle (633s, settled=false) — the Phase 3 hang family again.

## D2 — manufacturing businesses Da Nang
- Query 1: 4 links accepted, 3-4 navigated, **extractor ran: `model_ok` x1**, 13 entities extracted -> 10 normalized -> **0 emitted -> CANDIDATE_EMISSION_FAILED**.
- Query 2: 1 entity -> 0 normalized (`NORMALIZATION_REJECTED`) — the normalization reasons now name it.
- Widen query: navigation_failed.
- Verdict: the model worked (no quota failure). The zero moved downstream to the **emission gate** (10 normalized rows remembered -> 0 emitted) — a separate boundary to autopsy (identity resolution / rowEvent gating), exactly what this telemetry was built to expose.

## Conclusion
- Model quota/provider failure: NOT confirmed (model_ok observed on D2).
- Product code change beyond telemetry: not justified for the extraction layer itself. The telemetry moved both zeros to their real boundaries: B2 = page classification, D2 = emission gate. Both are the next audit targets, distinct from P1-C.
