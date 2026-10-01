# Understanding stress classification (frozen corpus, seed 27491)

Corpus: `reports/understanding-forensic/CORPUS.json` (unchanged). Fair scorer: `stress.mts` (deterministic chain Discover uses with the provider off; clarification graded with `decideSpecClarification`). Raw scorer copy: `stress-raw.mts`.

| Score | Fully correct |
| --- | ---: |
| Raw (old scorer, checkpoint start) | 78/100 |
| Mechanics fixed (S1–S3) + product fix P1 | 89/100 |
| Policy adjusted (6 documented contract changes) | 95/100 |

## A. Genuine semantic misses (5)
Misspelled places: `c002b` fyetteville, `c016` vinlius, `c024` aberystwyyth, `c035` arequippa, `c036` lipzig. Scheduled for Task 12 (general typo repair, no hardcoding).

## B. Scorer bugs (fixed in the fair scorer)
- S1 `spec_entity` compared an array expectation with `===` (9 cases: h000b, h014, h020, h033, c006b, c010, c012, c014, c023). The frame-level check already accepted arrays.
- S2 OR locations: the canonical contract carries alternatives in `frame.locations` / `spec.locations`; the old scorer counted repeated `location` criteria (M10, M12, M16).
- S3 Clarification was graded against the legacy readiness/mode gates. The SPEC route applies only `decideSpecClarification` when a frame is attached (`spec-search.functions.ts` ~1219).

## C. Obsolete expectations (policy)
`h004a, h008a, h010, h011, c002a, c008a`: old holdout said clarification "forbidden" for bare fit-based discovery. The new canonical policy asks the purpose question once when no purpose is stated. See `CONTRACT_CHANGES.md` and `corpus-policy-overrides.json`.

## Product fixes found while scoring (P1, with tests)
- `to-search-spec.ts` SOCIAL_TOPIC read compound nouns as discussion topics ("grant writing agencies in Split" → topic "agencies in Split" + forced live). Now requires `about/on`, a relative clause, or a talking/discussing participle. Test: `src/lib/understanding/social-topic-modal.test.ts`.
- MODAL_NEED missed "could use X" (M20 asked an unreadable-relation question despite a stated purpose). Added `use`; offer is bounded at the clause edge and never overwrites an explicit "I sell X".
