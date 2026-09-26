# Master gap matrix

| Capability | Current | Status | Severity | Recommended solution | Verification |
|------------|---------|--------|----------|----------------------|--------------|
| Company/person live discovery | live-web | **PASS** (path) | CRITICAL→done path | SearXNG in live-gapfill | Battery + `09` D/G |
| Spec underuses sources.server | Social on SPEC (Reddit public) | **PASS (provider)** | CRITICAL→1E | `social-signal.ts` + SPEC gapfill | `phase1-acceptance` Test 7 |
| Live → DB write-back | VERIFIED → idx_* upsert | **PASS (path)** | CRITICAL→1D | `persist-live.server.ts` after stamp | `phase1-acceptance` Test 6 |
| Query-aware enrichment | evidence + hiring/funding/need | **PASS (exemplars)** | CRITICAL→1B/C | derive from semantic model + evidence | `phase1-acceptance` 4–5, 8–9 |
| Evidence-backed why-match | evidence[] only under signal | **PASS** | CRITICAL→1B | `evidence.ts` + qualify gate | `phase1-acceptance` 3–5 |
| Signal/opportunity parsing | need-phrase grammar | **PASS** | CRITICAL→1A | `need-phrase.ts`; plurals; no industry-from-help | `phase1-acceptance` 1–2 |
| Enrich-before-show businesses | contact\|site\|no_website | **PASS** | HIGH | completeness.ts | `pipeline-phases` |
| Why-match empty | templates exist | **PARTIAL** | HIGH | Not evidence-backed yet | `09` |
| Worldwide as geo | geo_scope=worldwide | **PASS** | HIGH | Stated scope; skip location missing | universal-audit-fills |
| Unicode geo (Medellín) | `\p{L}` extract | **PASS** | HIGH | Unicode in extractGeo | universal-audit-fills |
| Craft nouns | coffee/yoga expanded | **PASS** | HIGH | BUSINESS_NOUNS + category | battery biz-roasters/yoga |
| CTO plural role | ctos → cto | **PASS** | HIGH | ROLE_AFTER | universal-audit-fills |
| SIGNAL_HINT | SEO help yes; bare need no | **PASS** | HIGH | Require object after need(ing) | vague-co clarify unit |
| B2B+founders → person | person+role | **PASS** | HIGH | Prefer person when founder/CTO + model | universal-audit-fills |
| Duplicate phone/address | soft_duplicate flag | **PASS** | HIGH | markSoftDuplicates | universal-audit-fills |
| Place string redundancy | formatPlace | **PASS** | MEDIUM | Token dedupe | universal-audit-fills |
| Job HTML entities | &#x…; decode | **PASS** | HIGH | sanitizeJobText | universal-audit-fills |
| Researching status UI | removed | **PASS** | LOW | thinking-steps | thinking-steps.test |
| anon · 0 engagement | hidden for canonical | **PASS** | LOW | lead-detail-panel | manual/UI |
| Social→structured signal | weak | MISSING | HIGH | Evidence object + URL | deferred Phase G+ |
| Agentic browser | deferred | MISSING | MEDIUM | After live-web insufficient | LATER_WORK |
| OpenMagpie/Harken | absent | MISSING | MEDIUM | Research; prefer in-tree | solutions.md |
| Global geo COMPLETE claim | unproven | UNKNOWN | — | Never claim without test | matrix |
| Storage full dumps | ops | OPS | MEDIUM | S3 partition / prune | ops note |
