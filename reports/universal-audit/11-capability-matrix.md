# 11 — Capability matrix (E2E spine)

**Date:** 2026-09-15  
**Spine:** Understand → Extract → Resolve → Match → Search → Discover → Verify → Enrich → Qualify → Deliver (+ persist + why-match)

Status legend: **PASS** | **PARTIAL** | **FAIL** | **MISSING** | **BLOCKED**

---

## By capability class (not example string)

| Capability class | Und | Ext | Res | Mat | Sea | Disc | Ver | Enr | Qual | Del | Overall |
|------------------|-----|-----|-----|-----|-----|------|-----|-----|------|-----|---------|
| Role→person discovery | PARTIAL | PARTIAL | FAIL | FAIL | PARTIAL | PARTIAL | FAIL | FAIL | FAIL | FAIL | **FAIL** |
| Service/need→company | PASS | PASS | PARTIAL | FAIL | PARTIAL | PARTIAL | FAIL | FAIL | FAIL | FAIL | **FAIL** |
| Opportunity no_website (local) | PASS | PASS | PASS | PARTIAL | PASS (OSM) | PASS | PARTIAL | N/A | PARTIAL | PARTIAL | **PARTIAL** |
| Funding/startup identity | PASS | PASS | FAIL | FAIL | PARTIAL | FAIL (lists) | FAIL | FAIL | FAIL | FAIL | **FAIL** |
| Hiring signal→employer | PASS | PASS | PARTIAL | PARTIAL | PARTIAL | PARTIAL | FAIL | FAIL | PARTIAL | FAIL | **FAIL** |
| Location resolution (arbitrary NL) | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | — | — | — | — | **PARTIAL** |
| Industry ≠ need separation | PASS | PASS | PASS | — | — | — | — | — | FAIL downstream | FAIL | **PARTIAL** |
| Aggregator/job-board rejection | — | — | **MISSING** on SPEC | FAIL | — | FAIL | FAIL | — | FAIL | FAIL | **FAIL** |
| Claim-aligned evidence | — | — | — | FAIL | — | — | FAIL | — | FAIL | FAIL | **FAIL** |
| Contact enrichment pre-delivery | — | — | — | — | — | — | — | PARTIAL (DB only) | — | FAIL | **FAIL** |
| Jobs complete lead | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PASS (fleet) | PARTIAL | FAIL | FAIL | FAIL | FAIL | **FAIL** |
| Social demand | PASS | PASS | — | — | BLOCKED (404) | FAIL | FAIL | — | — | — | **BLOCKED** |
| Clarify vs guess | PARTIAL | PARTIAL | — | — | — | — | — | — | — | — | **PARTIAL** |
| Cancel lifecycle | — | — | — | — | — | — | — | — | — | FAIL | **FAIL** |
| UI complete-lead table | — | — | — | — | — | — | — | — | — | FAIL | **FAIL** |
| Persist VERIFIED bar | — | — | — | — | — | — | FAIL (soft) | — | — | PARTIAL | **FAIL** |

---

## Ultimate E2E acceptance

> Can a user enter arbitrary NL and receive **only** complete, relevant, evidence-backed, enriched leads — DB when sufficient, live when necessary, explained in UI?

**Answer: NO.**  
A successful search that yields incomplete / weakly relevant / misclassified / unverified / evidence-less entities is a **product failure**. Observed both as FP pages when SearXNG hits (screenshots / report 10) and as empty or thin results when live fails (this battery).
