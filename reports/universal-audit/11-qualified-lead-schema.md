# 11 — Qualified lead schema audit

**Date:** 2026-09-15 (amended)  
**Mode:** Audit-only  
**Verdict:** **fragmented** vs today’s code — **LOCKED target** is [11-canonical-contract.md](11-canonical-contract.md).

---

## Locked target (do not re-invent)

See the constitution: **QualifiedLead theorem**, field tiers (`required_for_qualification` / `required_when_available` / `optional`), subject-bound ClaimEvidence, source≠lead, entity-resolution hard gate.

Completeness is **query-aware**, not a universal mandatory bag. Jobs: minimum qualification ≠ “every possible job field.” Salary etc. become query-required only when Spec demands them.

---

## What exists today (unchanged findings)

### SpecRow (`src/lib/spec-search.functions.ts`)

Carries: `kind`, title/detail, contact, facets, `why_match`, `complete`/`missingFields`, `opportunity`, `evidence[]`, scores, `disposition`, `verification_status` (`discovered|normalized|verified|rejected`).

**Missing vs lock:** field tiers; `entity_id` / identity_confidence; structured role/company; claim subject; event_at; typed outcome; run_id.

### Evidence (`src/lib/search/evidence.ts`)

Types only; `hasQualifyingEvidence` = **any-of** — neither claim-aligned nor subject-bound (`GAP-CLAIM-TYPE-GATE`, `GAP-SUBJECT-BINDING`).

### Qualification (`src/lib/search/qualify.ts`)

- `!signal_required` → always `qualified` (directory auto-pass).  
- `signal_required` + any qualifying evidence type → `qualified`.  
Violates theorem steps 4–8.

### Completeness (`src/lib/search/completeness.ts`)

Static thin bags (person: name+contact; job: title+url). No query-required derivation; treats LinkedIn URL as sufficient person completeness (`GAP-FIELD-TIERS`).

### Persist / UI

Persist: no evidence/disposition/lifecycle columns; soft VERIFIED.  
UI `specRowToLead`: lossy projection — **forbidden** under lock (UI must derive from QualifiedLead).

---

## Gap: complete vs claim-verified vs enriched vs qualified

| Concept | Must mean | Today conflated with |
|---------|-----------|----------------------|
| Identity-complete | Identity-required fields present | `complete` (contact-or-url) |
| Claim-verified | Subject-bound claim evidence | any-of evidence type |
| Enriched | Query-aware fill **before** qualify | post-display buttons / skipped live |
| Qualified | Full theorem | disposition after weak gate |
| Delivered | UI/persist of QualifiedLead only | any SpecRow mapped to Lead |

---

## Schema verdict

| Layer | Status |
|-------|--------|
| Locked contract doc | **LOCKED** |
| Code SpecRow pipeline | Coherent but **weaker** than lock |
| Completeness vs law | **Misaligned** |
| Claim + subject binding | **Absent** |
| Lifecycle gates | **Fragmented** |
| Persist / UI | **Do not encode theorem** |

**Systemic finding unchanged:** no single QualifiedLead end-to-end. Implementation must start from the locked contract, not from SpecRow as truth.
