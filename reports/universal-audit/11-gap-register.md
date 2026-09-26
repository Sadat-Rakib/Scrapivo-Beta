# 11 — Gap register (systemic)

**Date:** 2026-09-15 (amended)  
**Mode:** Audit-only  
**Constitution:** [11-canonical-contract.md](11-canonical-contract.md)  
**Priority:** P0 blocks QualifiedLead theorem; P1 blocks class coverage; P2 ops; P3 polish.

False-positive qualified lead tolerance: **0**. Prefer 0 correct over N wrong.

---

## P0

| ID | Gap | Evidence | Classes |
|----|-----|----------|---------|
| `GAP-QUAL-SCHEMA-FRAGMENT` | No end-to-end QualifiedLead | SpecRow ≠ UI ≠ persist | all |
| `GAP-FIELD-TIERS` | No Q / A / O tiers; universal bags | completeness.ts; jobs salary-as-required confusion | all |
| `GAP-SUBJECT-BINDING` | Evidence not bound to entity | list-page funding; C/D/E | claims |
| `GAP-CLAIM-TYPE-GATE` | Qualify any-of evidence types | hasQualifyingEvidence | need, funding, hiring |
| `GAP-SOURCE-NE-LEAD` | Source conflated with lead | URL→website; page→person | all |
| `GAP-ENTITY-RESOLVE-GATE` | No hard entity_resolved gate | inherit kind; institutes | identity |
| `GAP-FUNDING-SNIPPET-OR` | looksFunding \|\| funding | live-gapfill; C | funding≠need |
| `GAP-SPEC-NO-PAGE-TYPE` | No page-type on SPEC live | demand-classifier unused | page-type |
| `GAP-LIST-PAGE-AS-ENTITY` | List SERP as company | E Berlin / SCR-01 | funding |
| `GAP-ENTITY-INHERIT-KIND` | Row kind = query entity | live-gapfill | people |
| `GAP-INSTITUTE-AS-PERSON` | Founder Institute → person | SCR-04 | people |
| `GAP-LIVE-SKIP-ENRICH` | Live skip enrich before qualify | Phase order | enrich |
| `GAP-QUAL-INCOMPLETE-SHOWN` | Incomplete shown as results | SCR-01/04/12 | deliver |
| `GAP-UI-FIELD-DROP` | Contract fields stripped | specRowToLead | UI |
| `GAP-RUN-IDENTITY` | No search_run_id stale reject | New chat repaint | cancel |
| `GAP-CANCEL-NO-ABORT` | No AbortSignal UI→server | cancel matrix | cancel |
| `GAP-TYPED-OUTCOME` | Bare 0 collapses unavailable/unsupported/empty | battery returned:0 | ops |

## P1

| ID | Gap |
|----|-----|
| `GAP-PEOPLE-CONTRACT` | Missing structured person fields |
| `GAP-ROLE-CURRENTNESS` | No current/former/unknown role |
| `GAP-JOB-CONTRACT` | Job minimum vs enrichment not split in code |
| `GAP-JOB-SPECROW-COLLAPSE` | JobPosting description etc. dropped |
| `GAP-WHY-SERP-NOT-CLAIM` | why_match = evidence prose not Spec fit |
| `GAP-VERIFIED-SERP-SOFT` | Persist VERIFIED from SERP snippet+URL |
| `GAP-TEMPORAL-CLAIM` | observed_at used as if event freshness |
| `GAP-URL-AS-WEBSITE` / `GAP-HOST-KEY-COLLAPSE` | Platform URL as company; host keys |
| `GAP-UI-NO-TABLE-CONTRACT` / `GAP-UI-SPEC-ROUTING` | Lists/Posts lossy |
| `GAP-CANCEL-REPAINT` | setLeads after New chat |
| `GAP-ENRICH-POST-DISPLAY` | Enrich buttons after show |
| `GAP-SEM-UNKNOWN-NEED` / `GAP-JOBBOARD-AS-NEEDER` | Clarify / D quality |
| `GAP-COVERAGE-DENOM` | No Supported/Attempted/Covered/Unknown stages |
| `GAP-SOCIAL-MODEL` | Social not first-class beyond social_ask |

## P2

| ID | Gap |
|----|-----|
| `GAP-LIVE-PROVIDER-FLAKE` | SearXNG variance |
| `GAP-SOCIAL-404` | Reddit 404 |
| `GAP-UI-PROVENANCE-LIE` | canonical-db on live |
| `GAP-UI-UNDERSTANDING-STALL` / `GAP-UI-API-DIVERGENCE` / `GAP-UI-MOJIBAKE` | UX |
| `GAP-FREEHIRE-THIN` | salary null |
| `GAP-SEM-HELP-SIGNAL-PARTIAL` | HELP_SIGNAL without service |

## P3

| ID | Gap |
|----|-----|
| `GAP-DISPOSITION-DROPPED-DEAD` | dropped unused |
| `GAP-LIFECYCLE-VOCAB-SPLIT` | verification_status ≠ locked gates |

---

## OSS (confirmed P0/P1 — recommend only)

Prefer in-repo `demand-classifier` + deterministic claim/subject gate + AbortSignal/run_id before any external NER/NLI. Do not integrate OSS until phases 1–4 + 6 of the roadmap land.
