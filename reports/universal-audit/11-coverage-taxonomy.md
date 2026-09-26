# 11 — Coverage taxonomy (capability classes)

**Date:** 2026-09-15  
**Rule:** Do **not** measure “copywriter works.” Measure generalized classes.

| Class ID | Capability | Measure as |
|----------|------------|------------|
| CLS-ROLE-PERSON | Arbitrary role → person discovery | role resolve → source route → identity → evidence → enrich → qualify |
| CLS-NEED-SERVICE | Requested service/need → entity | need extract → claim evidence → not industry collision |
| CLS-OPP-NOWEB | Structural opportunity | OSM/DB no_website → qualify without SERP fiction |
| CLS-FUNDING | Funding/startup events | company identity grain ≠ list page |
| CLS-HIRING | Hiring signal | employer entity + role + claim-aligned hiring evidence |
| CLS-GEO | Location/proximity/nearby | arbitrary NL geo resolve; no city hardcode as “coverage” |
| CLS-INDUSTRY | Industry/niche/category | dictionary + unknown clarify; never guess claim |
| CLS-TEMPORAL | Temporal constraints | recent/this quarter parsed and enforced on evidence freshness |
| CLS-JOB | Job postings | full job contract fields before qualify |
| CLS-SOCIAL | Social ask | provider live + social_ask claim align |
| CLS-PAGE-TYPE | Entity vs page-type | reject aggregator/job-board/list/institute-as-person |
| CLS-ENRICH | Query-aware enrichment | before qualify/deliver; contact ≠ website URL |
| CLS-UI-TABLE | Complete-lead delivery | table/list columns by entity; no field drop |
| CLS-CANCEL | Search lifecycle cancel | UI→…→provider abort on Stop/New chat/new search |

## Stage denominators (measure every class)

For each class, report **Supported / Attempted / Successfully covered / Unknown** at least at:

role/need extract → resolve → source availability → identity resolution → Spec match → claim evidence (subject-bound) → enrichment → qualified delivery

Do not claim “people discovery supported” without these denominators.

## Anti-patterns (do not count as coverage)

- Hardcoded example cities/titles in tests as “supported geography/roles”
- Unit fixtures green while live C/D/E fail
- SearXNG success counted as lead success
- `complete:true` via LinkedIn URL alone counted as people coverage
- Universal mandatory salary/requirements counted as “job contract met”
