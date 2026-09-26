# 11 — Implementation roadmap (dependency-ordered)

**Date:** 2026-09-15 (amended — wording lock + start implementation)  
**Constitution:** [11-canonical-contract.md](11-canonical-contract.md)  
**Hard law:** Prefer 0 correct QualifiedLeads over N false/incomplete. Search success ≠ lead success.

**Principle:** Do not make the current system “produce better leads” first. First make it **impossible for invalid leads to pass the qualification gate.** Displayed lead count dropping is progress.

---

## Critical path (Milestone 1 spine)

0. **Audit freeze / baseline** — 11-* artifacts + traces (**done**).  
1. **Canonical QualifiedLead + SearchSpec contracts** — field tiers; `queryRequiredFields(spec)`; identity-required set; provisional `entity_id` cannot qualify.  
2. **Lifecycle + qualification invariants** — gates; theorem checks; never conflate complete / claim-verified / enriched / qualified.  
3. **ClaimEvidence + subject binding** — ClaimEvidence model; kill any-of qualify; funding≠need structurally.  
4. **Entity / page-type / aggregator classification** — page classify **before** entity qualify; kill query-kind inheritance.  
5. **Cancellation foundation + run identity** — AbortSignal **and** `search_run_id` stale reject (correctness). Stop button UX can lag.  

**Do not skip phase 4.** Claim verification depends on entity/page classification.

After the spine:

6. **Semantic input / ontology / clarification** — unknown need → clarify; industry≠need; temporal Spec fields.  
7. **Generalized people discovery** — identity, role currentness, company association.  
8. **Jobs contract + extraction** — minimum Q + enrichment targets; map JobPosting fully.  
9. **Location / entity resolution** — arbitrary NL geo.  
10. **DB / live source routing** — source≠lead; host-key; free-first.  
11. **Query-aware enrichment** — before qualify; no post-display-as-default.  
12. **Verification / provenance / freshness** — event_at vs observed_at; temporal rule.  
13. **Persist contract** — store theorem fields or refuse.  
14. **UI / table delivery** — derive from QualifiedLead+Spec+type; count only qualified.  
15. **Social** — first-class social source model.  
16. **Coverage / randomized battery** — stage denominators Supported/Attempted/Covered/Unknown.  
17. **Full E2E re-audit** — acceptance criteria in canonical contract.

Parallelism allowed within layers that do not violate upstream gates, but **not** UI / OSS / “better search” before claim + page-type + run-identity foundations.

---

## Why cancel is phase 5 (after entity/page)

New chat → old request finishes → repaint is **wrong-data association**. Abort + run identity land after classification gates exist, before broad people/jobs/UI work. **Entity/page classification (phase 4) is never skipped** in favor of cancel.

---

## What must NOT change yet

- Product patches that invent a fifth lead shape without the locked contract  
- Universal mandatory salary/requirements on all jobs  
- Example hardcodes as “coverage”  
- OSS integration before reclaiming in-repo page-type classifier + claim gate  
- Showing `potential_match` / sources as qualified  
- UI polish ahead of theorem enforcement  

## Implement first (approved)

**Phases 1 → 2 → 3 → 4 → 5** (contracts → invariants → subject-bound claims → entity/page classification → cancel/run identity).

Then people / jobs / location / routing / enrichment → verification → persist → UI → social → coverage → E2E re-audit.
