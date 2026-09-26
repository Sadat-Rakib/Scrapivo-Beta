# 11 — Full capability audit (qualified-lead contract)

**Date:** 2026-09-15 (amended — contract hierarchy lock)  
**Mode:** Audit-only — no product code changes  
**LOCKED constitution:** [11-canonical-contract.md](11-canonical-contract.md)  
**Traces:** [tmp/full-capability-audit-traces.jsonl](../../tmp/full-capability-audit-traces.jsonl)  
**Battery console:** [tmp/full-capability-audit-battery-console.txt](../../tmp/full-capability-audit-battery-console.txt)  
**Prior evidence:** [10-phase1-verification.md](10-phase1-verification.md), Discover screenshots 2026-09-14 (workspace assets)

---

## Final verdict

# `AUDIT COMPLETE — SYSTEMATIC GAPS IDENTIFIED`

**Capability level:** Phase 1 SPEC machinery is **real**. It is **not** a QualifiedLead system under the locked theorem.

**E2E acceptance (amended): FAIL.** The system cannot yet: resolve Spec → search → identify entities (not pages) → verify **subject-bound** claims → enrich before qualify → deliver only QualifiedLeads with typed empty/error/unsupported/cancelled outcomes and stale-run rejection.

**Hard law:** Prefer `0` correct qualified leads over `N` false/incomplete. Search success ≠ lead success. Source ≠ lead.

---

## Amendment (contract hierarchy)

Locked distinctions so they cannot be conflated again:

| Concept | Meaning |
|---------|---------|
| Identity-required | Almost always Q |
| Query-required | From SearchSpec (`queryRequiredFields`) |
| Enrichment (`required_when_available`) | Best-effort; missing public email ≠ auto-reject |
| Claim-verified | Type **and** subject binding **and** temporal when Spec asks |
| Entity-resolved | Hard gate after page-type; never query-kind inheritance |
| Qualified | Full theorem only |
| Delivered | UI/persist of QualifiedLead only |

Jobs: **minimum Q** vs enrichment targets (salary not universal). Cancel: AbortSignal **+** `search_run_id`. Coverage: stage denominators. Outcomes: typed codes.

---

## Executive answers

| Question | Answer |
|----------|--------|
| Locked QualifiedLead contract? | **Yes — LOCKED** ([11-canonical-contract.md](11-canonical-contract.md)); **code still fragmented** |
| Lifecycle with entity_resolved / page_classified? | **Target yes / code no** |
| Enrich before qualify all paths? | **No** for live SERP |
| Evidence claim-aligned + subject-bound? | **No** |
| Screenshots traced? | **Yes** |
| FP budget 0 met? | **No** when SearXNG hits |

---

## Biggest systemic gaps

| Area | Top gaps |
|------|----------|
| Contract | `GAP-QUAL-SCHEMA-FRAGMENT`, `GAP-FIELD-TIERS`, `GAP-SOURCE-NE-LEAD` |
| Entity | `GAP-ENTITY-RESOLVE-GATE`, `GAP-ENTITY-INHERIT-KIND`, `GAP-INSTITUTE-AS-PERSON` |
| Claims | `GAP-SUBJECT-BINDING`, `GAP-CLAIM-TYPE-GATE`, `GAP-TEMPORAL-CLAIM` |
| People | `GAP-PEOPLE-CONTRACT`, `GAP-ROLE-CURRENTNESS` |
| Enrichment | `GAP-LIVE-SKIP-ENRICH`, `GAP-ENRICH-POST-DISPLAY` |
| Source | `GAP-SPEC-NO-PAGE-TYPE`, flake, social 404 |
| UI | `GAP-UI-FIELD-DROP`, table/routing |
| Cancel | `GAP-RUN-IDENTITY`, `GAP-CANCEL-NO-ABORT`, `GAP-TYPED-OUTCOME` |

---

## Pass summaries

### Pass 0 — Contract
Fragmented schema; completeness too thin; UI strips contract; lifecycle incomplete. Enrich-before-qualify holds for DB incomplete only.

### Pass 1 — Tree / env
SPEC default ON → `runSpecSearchCore`. Legacy `runSearch` when flag off. freehire = jobs sibling only. Env: SearXNG+Supabase set; DATABASE_URL absent.

### Pass 2 — Screenshots
12 defects SCR-01…12 mapped to gaps and roadmap phases. Do not fix shots.

### Pass 3 — Semantics
Need≠industry extract VERIFIED for known vocab. Unknown need objects / HELP_SIGNAL partial / some guess paths remain.

### Pass 4 — Claim evidence
C/D/E failure classes confirmed in code + prior runtime; claim gate absent.

### Pass 5 — Page-type
`demand-classifier` not on SPEC live; kind inheritance creates institute-as-person.

### Pass 6 — Sources / enrich
Free-first SearXNG real; live skip enrich; URL-as-website; Reddit 404 fail-closed.

### Pass 7 — People/jobs contracts
Both FAIL hard contracts; upstream richer than SpecRow.

### Pass 8 — UI table
No complete-lead table; Lists thin; Spec→Posts routing; field drop.

### Pass 9 — Cancel
No AbortController; Clear/New chat soft UI only; in-flight can repaint; Understanding stall is pending pulse.

### Pass 10 — Live battery (this run)
| Case | Returned | Note |
|------|----------|------|
| A Toronto restaurants needing websites | **3** | OSM no_website — strongest honest path |
| B–G signal queries | **0** | SearXNG `result_count=0`; directory without evidence dropped |
| Social | 0 | HTTP 404, not fabricated |

Contrast report 10 (SearXNG hits): C=1 FP, D=2 FP, E=15 aggregators. Both regimes recorded.

### Pass 11 — Artifacts
This file + siblings listed below.

---

## Active vs legacy (short)

```
ACTIVE: discover → runSpecSearch → runSpecSearchCore
  extract → clarify/mode → pg/S3 → enrichIncomplete → live-gapfill/OSM/jobs/social
  → applyWhyMatchGate → stamp/persist → UI specRowToLead

LEGACY: SPEC_SEARCH_ENABLED=false → runSearch → searchAllSources
PARKED: browser-use, stealth on Spec path, embeddings (LATER_WORK)
```

---

## Dependency-ordered implementation (do next)

See [11-implementation-roadmap.md](11-implementation-roadmap.md) (amended: cancel/run-identity as phase 6).

**Implement first:** phases **1 → 2 → 3 → 4 → 6** (contract, invariants, subject-bound claims, page/entity gates, run identity) before UI/table or social polish.

**Must NOT change yet:** inventing another lead shape; universal mandatory job salary; example hardcodes as coverage; OSS before in-repo classifier + claim gate; incomplete rows as qualified.

---

## Artifact index

| Doc | Path |
|------|------|
| **LOCKED constitution** | [11-canonical-contract.md](11-canonical-contract.md) |
| Schema audit | [11-qualified-lead-schema.md](11-qualified-lead-schema.md) |
| Lifecycle | [11-lifecycle-states.md](11-lifecycle-states.md) |
| Capability matrix | [11-capability-matrix.md](11-capability-matrix.md) |
| Screenshots | [11-screenshot-reality-audit.md](11-screenshot-reality-audit.md) |
| Gaps | [11-gap-register.md](11-gap-register.md) |
| Taxonomy | [11-coverage-taxonomy.md](11-coverage-taxonomy.md) |
| Sources | [11-source-provider-matrix.md](11-source-provider-matrix.md) |
| People/jobs | [11-entity-contracts.md](11-entity-contracts.md) |
| Roadmap | [11-implementation-roadmap.md](11-implementation-roadmap.md) |
| Verification | [11-verification-plan.md](11-verification-plan.md) |
