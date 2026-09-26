# 16 — Independent full capability re-audit (post M5–M15)

**Date:** 2026-09-15  
**Mode:** Audit-only — no product patches in this pass  
**Supersedes operational verdict in:** [11-full-capability-audit.md](11-full-capability-audit.md) (baseline gaps remain historically true; code has since closed the spine)  
**Constitution:** [11-canonical-contract.md](11-canonical-contract.md)  
**Hard law:** Prefer `0` correct QualifiedLeads over `N` false/incomplete. Search success ≠ lead success.

---

## Verdict

# `AUDIT COMPLETE — SPINE TESTED; RUNTIME NOT VERIFIED`

| Layer | Status | Evidence |
|-------|--------|----------|
| M1–M4 (theorem, page-type, run identity, entity resolve) | **VERIFIED** (prior) | unit + adversarial C/D/E |
| M5 Semantic / SearchSpec | **TESTED** | `m5-search-spec-semantics.test.ts` |
| M6 Location | **TESTED** | location-resolver + M12/M15 geo gates |
| M7 Source routing | **TESTED** | `buildSourcePlan` coverage in batteries |
| M8 Query-aware enrichment | **TESTED** | `m8-enrichment.test.ts` |
| M9 Verification / provenance / freshness | **TESTED** | `m9-verification.test.ts` |
| M10 Persistence (in-memory) | **TESTED** | persist/hydrate unit path |
| M10 Production DB | **NOT RUNTIME VERIFIED** | no live Postgres proof in this audit |
| M11 UI + run identity / cancel | **TESTED** | search-run + view projection batteries |
| M12 People | **TESTED** | `m12-people.test.ts` |
| M13 Jobs | **TESTED** | `m13-jobs.test.ts` |
| M14 Social | **TESTED** | `m14-social.test.ts` + phase1 social E2E |
| M15 Coverage + adversarial E2E | **TESTED** | `m15-coverage-adversarial.test.ts` |
| Live SERP / SearXNG end-to-end qualify | **NOT RUNTIME VERIFIED** | synthetic candidates only in M15 |

**Suite stamp (2026-09-15):** `npx vitest run src/lib/search` → **31 files / 457 tests passed**.

**E2E acceptance (synthetic spine):** **PASS** for theorem enforcement on hand-built and social-adapted candidates.  
**E2E acceptance (live web):** **OPEN** — do not promote M5–M15 to VERIFIED until a live battery exercises real SERP/social fetches under cancel + run identity.

---

## Class coverage (taxonomy denominators)

Per [11-coverage-taxonomy.md](11-coverage-taxonomy.md). Status = test-battery coverage, not production SLA.

| Class | Supported | Attempted | Covered (synthetic) | Unknown / open |
|-------|-----------|-----------|---------------------|----------------|
| CLS-ROLE-PERSON | Y | Y | Y (M12) | live LinkedIn grain |
| CLS-NEED-SERVICE | Y | Y | Y (M5/M12/M14) | live social provider volume |
| CLS-OPP-NOWEB | Y | Y | partial | OSM/DB live path |
| CLS-FUNDING | Y | Y | Y (M9/M15) | live news freshness |
| CLS-HIRING | Y | Y | Y (M13/M15) | board scrape live |
| CLS-GEO | Y | Y | Y (M6) | fuzzy/provisional geo UX |
| CLS-INDUSTRY | Y | Y | Y (adversarial ≠ need) | unknown niche clarify |
| CLS-TEMPORAL | Y | Y | Y (M9/M14/M15) | missing event_at at crawl scale |
| CLS-JOB | Y | Y | Y (M13) | salary enrichment optional |
| CLS-SOCIAL | Y | Y | Y (M14) | OSS adapters beyond Reddit shape |
| CLS-PAGE-TYPE | Y | Y | Y (M2/M15) | live SERP classify drift |
| CLS-ENRICH | Y | Y | Y (M8) | budget under live latency |
| CLS-UI-TABLE | Y | Y | Y (projection) | browser Stop/New-chat soak |
| CLS-CANCEL | Y | Y | Y (run id unit) | multi-tab soak |

---

## Adversarial outcomes (M15)

All of the following **must not** qualify — and did not (qualified_count = 0):

- Funding evidence on a need Spec  
- Hiring evidence on a funding Spec  
- Directory/list page as entity  
- Provisional / unresolved entity  
- Stale `event_at` under recent Spec  
- Location mismatch (Dallas ≠ Austin)  
- Subject-unbound claim  
- Identity-offer social text (`I'm a web designer`)  
- Seeded sabotage of a known-good funding lead (21 mutations)

Happy paths that **did** qualify under synthetic evidence:

- Recently funded startups in Berlin  
- Founders needing developers in SF  
- People recently asking for website help in Austin (SocialArtifact → resolve → verify → qualify → persist)

---

## Remaining systemic risks (do not reopen as features)

1. **Live SERP still the largest FP surface** — M15 did not re-run SearXNG. Promote to VERIFIED only after a live adversarial battery.  
2. **Production persistence** — in-memory M10 ≠ Postgres runtime.  
3. **Social real-world resolution** — platform_only correctly fails closed; product may later allow platform-identity leads **only** via explicit Spec, never by weakening M4.  
4. **OSS social collectors** — must keep adapting into `SocialArtifact`; never emit foreign "lead" objects.  
5. **Enrichment under load** — M8 timeouts previously needed 15s; watch live budgets.

---

## What this audit does **not** claim

- Production readiness / SLA  
- That every NL query returns leads  
- That live Reddit/LinkedIn volume is Covered  
- VERIFIED status for M5–M15  

---

## Recommended next step

**Live adversarial soak (VERIFICATION mode):** fixed query battery against real providers with FP budget = 0, cancel/run-id soak, then optionally promote individual milestones from TESTED → VERIFIED. No feature work until that pass fails with a systemic gap.
