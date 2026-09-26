# Universal Lead Intelligence — Audit Index

| Doc | Phase |
|-----|-------|
| [01-current-system-map.md](./01-current-system-map.md) | A inventory |
| [02-legacy-map.md](./02-legacy-map.md) | A legacy |
| [03-geo-matrix.md](./03-geo-matrix.md) | B geo |
| [04-entity-matrices.md](./04-entity-matrices.md) | B entity |
| [05-gap-matrix.md](./05-gap-matrix.md) | C gaps |
| [06-solutions.md](./06-solutions.md) | D research |
| [07-verification.md](./07-verification.md) | F verify |
| [08-integrate-deferred.md](./08-integrate-deferred.md) | G defer |
| [09-post-implementation-reality-check.md](./09-post-implementation-reality-check.md) | post-impl |
| [10-phase1-verification.md](./10-phase1-verification.md) | Phase 1 verify |
| [11-full-capability-audit.md](./11-full-capability-audit.md) | **Hardened full audit (master)** |
| [11-canonical-contract.md](./11-canonical-contract.md) | **LOCKED** QualifiedLead / Spec / Evidence / Lifecycle |
| [11-qualified-lead-schema.md](./11-qualified-lead-schema.md) | Pass 0 schema vs lock |
| [11-lifecycle-states.md](./11-lifecycle-states.md) | Lifecycle map |
| [11-capability-matrix.md](./11-capability-matrix.md) | E2E spine matrix |
| [11-screenshot-reality-audit.md](./11-screenshot-reality-audit.md) | Screenshot evidence |
| [11-gap-register.md](./11-gap-register.md) | Systemic gaps P0–P3 |
| [11-coverage-taxonomy.md](./11-coverage-taxonomy.md) | Capability classes |
| [11-source-provider-matrix.md](./11-source-provider-matrix.md) | Sources |
| [11-entity-contracts.md](./11-entity-contracts.md) | People + jobs |
| [11-implementation-roadmap.md](./11-implementation-roadmap.md) | Dependency roadmap |
| [11-verification-plan.md](./11-verification-plan.md) | Post-impl harness |
| `inventory-index.json` / `geo-matrix-raw.json` | machine |
| `../../tmp/full-capability-audit-traces.jsonl` | audit traces |

**11-* verdict:** `AUDIT COMPLETE — SYSTEMATIC GAPS IDENTIFIED` — see master audit.  
**LOCKED constitution:** [11-canonical-contract.md](./11-canonical-contract.md) (theorem, field tiers, subject binding, entity gates, typed outcomes, run identity).  
**Hard law:** Prefer 0 correct QualifiedLeads over N false/incomplete. Source ≠ lead. Search success ≠ lead success.  
**Implementation:** Milestone 1 in progress — `src/lib/search/canonical-contract.ts` + theorem gate in `qualify.ts`. Next: phase 4 page/entity classification, then phase 5 run identity. No OSS/UI yet.
