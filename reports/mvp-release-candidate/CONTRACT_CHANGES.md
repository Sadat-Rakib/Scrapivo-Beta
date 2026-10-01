# Understanding test-contract changes

The frozen corpus is never edited. Overrides live in `corpus-policy-overrides.json` and are applied only to the "policy adjusted" score.

| Case | Old expectation | New expectation | Policy file / function | Rationale |
| --- | --- | --- | --- | --- |
| h004a, h008a, h010, h011, c002a, c008a | `clarification: forbidden` | `clarification: required`, id `entity_purpose` | `src/lib/search/spec-clarification.ts` `decideSpecClarification` | Bare discovery with no stated purpose now asks the purpose question once (business/company/person/investor). Explicit purpose ("I sell SEO", "research only") suppresses it. |

No expectation was changed to hide a genuine miss. The five typo-place cases remain failing until Task 12.
