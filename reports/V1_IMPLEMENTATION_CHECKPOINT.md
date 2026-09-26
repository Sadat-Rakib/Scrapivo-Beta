# V1 implementation checkpoint

## Acceptance
Normal `/discover` input must reach DB-first retrieval, targeted enrichment, bounded live candidate discovery/research, evidence-based qualification, deduplicated structured results, and cancellation. Live browser execution and useful returned rows must be demonstrated. Target spend: 3% of weekly allowance (actual usage is not exposed).

## Existing architecture
- `discover.tsx` calls `runSpecSearch`; `spec-search.functions.ts` owns the pipeline.
- `search-spec-extract.ts` produces `SearchSpec`; `source-plan.ts` owns free-first source routing.
- Canonical/indexed readers reuse stored data. Existing enrichment and qualification gates remain authoritative.
- `live-gapfill.ts` connects free providers and `browser-live.server.ts`; browser uses the working agent-browser CLI adapter.
- Browser progress is polled by the UI; verified rows can use existing persistence.

## Ownership and decisions
- Browser worker: extend existing browser with separate discovery and candidate research, bounded memory, quoted evidence.
- Source worker: extend existing source plan with research queries, remove raw-query fallback and unsupported inferred geography/website absence.
- Cancellation worker: owner-scoped server registry, Stop control, stale-response rejection, enrichment cancellation.
- Lead: core integration, cross-source deduplication, evidence safeguards, final review.
- Preserve all prior uncommitted work. No schema replacement or new paid provider.

## Current integration changes
- Known DB candidates receive targeted enrichment before live coverage assessment and become live-research seeds.
- Core passes desired count and the production qualification predicate to live research.
- `candidate-merge.ts` merges supported identities and preserves/rebinds their evidence; shared article URLs do not identify subjects.
- Missing URL no longer creates a website-absence claim in default enrichment. Discovered URLs are preserved as contradictory evidence.
- Core returns execution plan/provider attempts and uses the explicit cancellation registry.

## Verification and open work
- Targeted and live verification pending worker completion.
- Previous checkpoint reported zero final founder rows despite browser activity; this remains an acceptance failure until a fresh live run proves otherwise.
- Existing broad typecheck errors were reported before this task; rerun and distinguish new errors.
- Next: integrate worker interfaces, run focused regressions, run live normal-input acceptance, independently review evidence and readiness.
