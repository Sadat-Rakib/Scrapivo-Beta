# 11 — Entity contracts (people + jobs)

**Date:** 2026-09-15 (amended)  
**Mode:** Audit-only  
**Locked tiers:** [11-canonical-contract.md](11-canonical-contract.md)  
**Verdict:** Neither people nor jobs meet the locked QualifiedLead theorem today.

---

## Field tier legend

- **Q** = `required_for_qualification` (fail closed)  
- **A** = `required_when_available` (enrich; absence alone ≠ reject)  
- **O** = `optional`  
- **S** = becomes Q when SearchSpec demands it  

---

## People

### Qualification minimum (typical; Spec may add)

| Field | Tier | Today |
|-------|------|-------|
| entity identity + type=person | Q | Page title / query-kind inheritance — **FAIL** |
| name | Q | Often page/post title |
| role | Q when Spec asks role/founder | Mashed into title |
| company association | Q when Spec implies employment/founding | Mashed / absent |
| location | S / A | Partial country |
| identity evidence | Q | Weak |
| identity_confidence | Q | **MISSING** |
| role currentness (`current_role` \| former \| unknown) | Q when Spec implies current | **MISSING** (`GAP-ROLE-CURRENTNESS`) |
| contact | A (not Q solely) | URL alone wrongly passes completeness |
| requested need / signal | S | Spec-only; not on row |
| source + provenance | Q | key prefix only |
| freshness / role_observed_at | S / A | Partial on evidence |

Name-on-page / LinkedIn URL alone → **must not** qualify.

### Discovery paths today

S3 canonical (richer upstream, collapsed); SearXNG live (kind from query); Reddit social (post-as-person). Founder Institute = `GAP-INSTITUTE-AS-PERSON` + `GAP-ENTITY-INHERIT-KIND`.

---

## Jobs

### Minimum qualification (locked)

| Field | Tier |
|-------|------|
| job title | Q |
| employer | Q |
| job identity / source | Q |
| apply or source URL | Q |
| location/remote | A, or Q if Spec requests geo |
| evidence job exists (subject-bound) | Q |
| posting freshness | S if Spec temporal |

### Enrichment targets (not universal Q)

salary, employment type, summary, responsibilities, requirements, seniority, posting date, benefits, department, technologies — **A/O**, unless Spec makes them **S→Q** (e.g. `$150k+`).

### Today

| Field | Landed? | Status vs lock |
|-------|---------|----------------|
| Title @ company composite | yes | OK unstructured |
| Dedicated company / salary / seniority / description | mostly no | description **dropped** from JobPosting |
| Evidence on job rows | omitted | **FAIL** |
| Completeness title+url | yes | Too weak — matches anti-pattern company+URL |

UI “Open role” why + post-display enrich buttons = `GAP-ENRICH-POST-DISPLAY`.

---

## Businesses / companies (pointer)

Identity Q + Spec-driven need/opportunity/funding claims must be subject-bound. List hosts (Seedtable, ProjectStartups) fail entity_resolved + subject binding before any funding claim.

---

## Gap IDs

`GAP-PEOPLE-CONTRACT`, `GAP-JOB-CONTRACT`, `GAP-JOB-SPECROW-COLLAPSE`, `GAP-ROLE-CURRENTNESS`, `GAP-FIELD-TIERS`, `GAP-LIVE-PERSON-IS-PAGE`, `GAP-FREEHIRE-THIN`
