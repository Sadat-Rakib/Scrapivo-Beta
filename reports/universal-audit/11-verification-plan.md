# 11 — Verification plan (post-implementation)

**Date:** 2026-09-15 (amended)  
**Constitution:** [11-canonical-contract.md](11-canonical-contract.md)

## Proof ladder

code → unit → runtime → user-visible → persist → repeat

## Zero-FP + theorem

Any delivered row that fails the QualifiedLead theorem = **failure**.  
Honest typed empty (`NO_QUALIFIED_RESULTS`, `SOURCE_UNAVAILABLE`, …) = **pass**.

## Field-tier tests

| Case | Expect |
|------|--------|
| Job without salary, Spec=`React jobs Toronto` | May qualify if minimum Q met |
| Job without salary, Spec=`jobs paying $150k+` | Must **not** qualify |
| Person LinkedIn URL only, no identity evidence | Must **not** qualify |
| Missing public email after harvest | Must **not** reject solely for email |

## Claim + subject binding

| Adversarial | Expect |
|-------------|--------|
| C funding on developer need | not qualified |
| D job board as needer | not qualified |
| E list page as startup | fail entity_resolved / subject binding |
| “50 startups funded” page host | not funded entity |

`evidence.type` match alone is insufficient — subject must bind.

## Page-type before entity

Fixtures: aggregator, job board, institute, list, social group → classified; never inherit Spec.entity onto title.

## Run identity / cancel

| Case | Expect |
|------|--------|
| New chat mid-flight | abort and/or discard stale `run_id` |
| Late provider fallback after cancel | discarded |
| Double search race | only active run delivers |

## Typed outcomes

Battery asserts meta `outcome_code` ∈ locked set — never only `returned:0` without code.

## Coverage denominator

Per capability class, report stage metrics: Supported / Attempted / Successfully covered / Unknown (role extract → … → qualified delivery).

## Screenshot regression

SCR-01…12 must not reappear as qualified deliveries.

## Re-audit gate

Claim coverage only when: locked contract encoded; zero FP on C/D/E; entity_resolved gate live; run identity live; stage coverage harness reports denominators.
